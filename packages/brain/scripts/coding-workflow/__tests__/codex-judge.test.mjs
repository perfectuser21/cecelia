import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { callJudge, resolveJudgeConfig, parseJudge, decideJudge } from '../lib/judge.mjs';
import { runClaude, claudeFailure } from '../lib/claude.mjs';

const prompt = { system: '独立裁判，只返回JSON', user: '检查完整需求与证据' };
const answer = { coverage: [{ intent: 'I-1', satisfied: true, evidence: '真实证据' }], issues: [], summary: '满足' };
function fixture(script) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-native-judge-test-'));
  const bin = path.join(dir, 'codex');
  fs.writeFileSync(bin, '#!/usr/bin/env node\n' + script);
  fs.chmodSync(bin, 0o755);
  return { dir, bin, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}
describe('独立原生Codex裁判', () => {
  it('明确选择Codex时不读取API凭据，冻结独立模型与账号路径', () => {
    const cfg = resolveJudgeConfig({ CODING_WF_JUDGE_PROVIDER: 'codex', CODING_WF_CODEX_HOME: '/account', CODING_WF_CODEX_BIN: '/bin/codex', CODING_WF_JUDGE_MODEL: 'judge-model' });
    expect(cfg).toMatchObject({ provider: 'codex', model: 'judge-model', codexHome: '/account', codexBin: '/bin/codex' });
    expect(cfg.key).toBeUndefined();
    expect(() => resolveJudgeConfig({ CODING_WF_JUDGE_PROVIDER: 'unknown' })).toThrow('judge_provider_unsupported');
  });
  it('真实子进程只接收stdin完整prompt，保留原生事件并走原有严格判定', async () => {
    const f = fixture(`import fs from 'node:fs';
const p = fs.readFileSync(0,'utf8');
if(!p.includes('独立裁判') || p.length < 200000) process.exit(4);
const a=process.argv.slice(2);
if(!a.includes('-') || !a.includes('--ephemeral') || !a.includes('judge-model')) process.exit(5);
if(process.env.DEPLOY_TOKEN || process.env.CECELIA_INTERNAL_TOKEN || process.env.TOAPIS_API_KEY || process.env.OPENAI_API_KEY || process.env.CODEX_API_KEY || process.env.CODEX_ACCESS_TOKEN || process.env.OPENAI_ACCESS_TOKEN) process.exit(6);
console.log(JSON.stringify({type:'thread.started',thread_id:'judge-only'}));
fs.writeFileSync(a[a.indexOf('--output-last-message')+1], ${JSON.stringify(JSON.stringify(answer))});
console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:${JSON.stringify(JSON.stringify(answer))}}}));
console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:3,output_tokens:4}}));`);
    const old = { ...process.env };
    try {
      Object.assign(process.env, { CODING_WF_PROVIDER: 'claude', DEPLOY_TOKEN: 'fake-deploy', CECELIA_INTERNAL_TOKEN: 'fake-brain', TOAPIS_API_KEY: 'fake-judge', OPENAI_API_KEY: 'fake-api', CODEX_API_KEY: 'fake-api', CODEX_ACCESS_TOKEN: 'fake-access', OPENAI_ACCESS_TOKEN: 'fake-access' });
      const transcriptPath = path.join(f.dir, 'judge.jsonl');
      const r = await callJudge({ ...prompt, user: 'x'.repeat(250000) }, { provider: 'codex', model: 'judge-model', codexHome: f.dir, codexBin: f.bin, transcriptPath, timeoutMs: 3000 });
      expect(JSON.parse(r.content)).toEqual(answer);
      expect(r).toMatchObject({ provider: 'codex', cost_usd: null, usage: { input_tokens: 3, output_tokens: 4 } });
      expect(fs.readFileSync(transcriptPath, 'utf8')).toContain('judge-only');
      const parsed = parseJudge(r.content, { intentIds: ['I-1'] });
      expect(parsed.errors).toEqual([]);
      expect(decideJudge(parsed).verdict).toBe('PASS');
    } finally { for (const key of Object.keys(process.env)) if (!(key in old)) delete process.env[key]; Object.assign(process.env, old); f.cleanup(); }
  });
  it.each([
    ['failed', "console.log(JSON.stringify({type:'turn.failed',error:{message:'quota exceeded'}}));", 'judge_codex_auth'],
    ['partial', "console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'{}'}}));", 'judge_codex_incomplete'],
    ['tool-text', "console.log(JSON.stringify({type:'item.completed',item:{type:'command_execution',aggregated_output:'{}'}}));console.log(JSON.stringify({type:'turn.completed'}));", 'judge_codex_tool_used'],
    ['only-commentary', "console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'正在分析'}}));console.log(JSON.stringify({type:'turn.completed'}));", 'judge_empty'],
    ['two-turns', "console.log(JSON.stringify({type:'turn.completed'}));console.log(JSON.stringify({type:'turn.completed'}));", 'judge_codex_incomplete'],
    ['output-mismatch', "const fs=require('fs');const a=process.argv.slice(2);fs.writeFileSync(a[a.indexOf('--output-last-message')+1],'{}');console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'unrelated'}}));console.log(JSON.stringify({type:'turn.completed'}));", 'judge_codex_output_unverified'],
  ])('%s 不能伪装成功或退回API', async (_, script, error) => {
    const f = fixture(script);
    try { await expect(callJudge(prompt, { provider: 'codex', codexBin: f.bin, codexHome: f.dir, model: 'judge-model', timeoutMs: 3000 })).rejects.toThrow(error); }
    finally { f.cleanup(); }
  });
  it('适配器拒绝保留明确配置失败；额度错误只来自CLI事件', async () => {
    const f = fixture('process.exit(99)');
    try {
      const previous = process.env.CODING_WF_PROVIDER;
      process.env.CODING_WF_PROVIDER = 'codex';
      const run = await runClaude({ provider: 'codex', args: ['-p','x','--mystery'], cwd:f.dir, timeoutMs:1000, tag:'invalid' });
      if (previous === undefined) delete process.env.CODING_WF_PROVIDER; else process.env.CODING_WF_PROVIDER = previous;
      expect(run.stderr).toContain('codex_argument_unsupported');
      expect(claudeFailure(run)).toMatchObject({ status:'failed', failure_class:'needs_human', reason_code:'codex_configuration' });
      expect(claudeFailure({ provider:'codex', code:1, stdout:JSON.stringify({type:'turn.failed',error:{message:'usage limit reached'}}), stderr:'' })).toMatchObject({ failure_class:'needs_human',reason_code:'codex_auth' });
    } finally { f.cleanup(); }
  });
});
