// 真实runJudge→prompt→Codex适配器→本地CLI stdin；仅来源事实供应接缝可控。
// 本文件不证明来源事实本身真实，不访问模型、网络、数据库或运行仓。
import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { buildJudgePrompt } from '../../lib/judge.mjs';

const supply = vi.hoisted(() => ({ facts: null }));
vi.mock('../lib/source-provenance.mjs', () => ({
  sourceContext: () => null,
  judgeSourceFacts: () => supply.facts,
}));
import { runJudge } from '../lib/judge-gate.mjs';
import { withRecordProvenance, controllerIdentity, verifyPendingStageEvidence } from '../../lib/record-provenance.mjs';

const answer = JSON.stringify({ coverage: [{ intent: 'I-1', satisfied: true, evidence: '本地传输测试，不是产品验收' }], issues: [], summary: 'fixture' });
const roots = [];
afterEach(() => {
  supply.facts = null;
  for (const r of roots.splice(0)) {
    // 可选测试证据输出，永不作为生产封存或模型消费ACK。
    if (process.env.CW_JUDGE_TEST_ARTIFACT_DIR) {
      const target = path.join(process.env.CW_JUDGE_TEST_ARTIFACT_DIR, path.basename(r)); fs.mkdirSync(target, { recursive: true });
      fs.writeFileSync(path.join(target, 'test-name.json'), JSON.stringify({ test: expect.getState().currentTestName, claim: 'CLI观察原件，仅传输测试，不是生产封存或消费ACK' }));
      for (const name of ['actual-stdin', 'logs', 'protected']) {
        const from = path.join(r, name); if (fs.existsSync(from)) fs.cpSync(from, path.join(target, name), { recursive: true });
      }
    }
    fs.rmSync(r, { recursive: true, force: true });
  }
});
const sha = b => createHash('sha256').update(b).digest('hex');
function setup({ intent = '需求', spec = '规格', qa = '报告', prior = [], code = 'export const value = 1;\n' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-judge-input-')); roots.push(dir);
  const repo = path.join(dir, 'repo'); fs.mkdirSync(repo);
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 'test@localhost', GIT_COMMITTER_NAME: 'test', GIT_COMMITTER_EMAIL: 'test@localhost' } });
  git('init', '-qb', 'cp-10171320-cw-088c3431'); git('remote', 'add', 'origin', 'https://github.com/perfectuser21/cecelia.git'); git('config', 'core.hooksPath', path.join(dir, 'no-hooks'));
  fs.writeFileSync(path.join(repo, 'feature.mjs'), 'export const value = 0;\n');
  git('add', '.'); git('commit', '-qm', 'test: base'); git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  fs.writeFileSync(path.join(repo, 'feature.mjs'), code);
  const sprintDir = 'sprints/10171320-cw-088c3431'; fs.mkdirSync(path.join(repo, sprintDir), { recursive: true });
  for (const [name, bytes] of [['01-intent.md', intent], ['02-spec.md', spec], ['05-qa-report-r7.md', qa], ...prior.map((text, i) => [`06-judge-r${i + 1}.md`, text])]) fs.writeFileSync(path.join(repo, sprintDir, name), bytes);
  git('add', '.'); git('commit', '-qm', 'test: candidate');
  const captured = path.join(dir, 'actual-stdin'); const bin = path.join(dir, 'codex');
  fs.writeFileSync(bin, `#!/usr/bin/env node\nconst fs=require('node:fs'); const a=process.argv.slice(2); const p=fs.readFileSync(0); fs.writeFileSync(${JSON.stringify(captured)},p); console.log(JSON.stringify({type:'thread.started',thread_id:'stub-transport'})); fs.writeFileSync(a[a.indexOf('--output-last-message')+1],${JSON.stringify(answer)}); console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:${JSON.stringify(answer)}}})); console.log(JSON.stringify({type:'turn.completed'}));\n`); fs.chmodSync(bin, 0o755);
  const cfg = { repoSlug: 'local/test', logDir: path.join(dir, 'logs'), judgeTimeoutMs: 5000, judgeConn: { provider: 'codex', model: 'local-stub', codexHome: dir, codexBin: bin } };
  const id = { taskId: '088c3431-57ca-4f2a-8a50-14601518e2a2', sprintDir, intentIds: ['I-1'] };
  const options = { round: 7, reportRel: `${sprintDir}/05-qa-report-r7.md` };
  const diff = git('diff', 'origin/main...HEAD', '--', '.', ':(exclude)sprints');
  const p = buildJudgePrompt({ intent, spec, qaReport: qa, diff, round: 7, intentIds: ['I-1'], qaReportFile: '05-qa-report-r7.md', priorRulings: prior.map((text, i) => ({ round: i + 1, text })) });
  return { dir, repo, git, cfg, id, options, captured, prompt: p, go: () => runJudge(cfg, repo, id, options) };
}

describe('裁判最终受控stdin完整传输及总字节预算', () => {
  it('真实上游材料超过旧单项cap仍逐字到达CLI，包括最早裁决和每项尾部', async () => {
    const materials = { intent: '需'.repeat(22000) + 'INTENT-END', spec: '规'.repeat(42000) + 'SPEC-END', qa: '验'.repeat(48000) + 'QA-END', prior: Array.from({ length: 6 }, (_, i) => `R${i + 1}-` + '史'.repeat(15000) + `PRIOR-${i + 1}-END`), code: '// ' + 'd'.repeat(100000) + 'DIFF-END\n' };
    const f = setup(materials); supply.facts = { current_qa: { records: [] }, diagnostic: '源'.repeat(30000) + 'SOURCE-FACTS-END' };
    const result = await f.go(); expect(result.error).toBeUndefined();
    const stdin = fs.readFileSync(f.captured, 'utf8');
    for (const text of [materials.intent, materials.spec, materials.qa, ...materials.prior, 'd'.repeat(100000) + 'DIFF-END', JSON.stringify(supply.facts)]) expect(stdin.includes(text), `missing complete material ending ${text.slice(-24)}`).toBe(true);
    expect(stdin).not.toContain('已截断'); expect(stdin).not.toContain('轮裁决略');
  });

  it('最终UTF8 stdin恰好预算N通过，追加一字节后不spawn（不是字符预算）', async () => {
    const f = setup({ qa: '汉'.repeat(24000) });
    const exact = Buffer.from(`${f.prompt.system}\n\n${f.prompt.user}`);
    expect(exact.byteLength).toBeGreaterThan(65536); expect(exact.byteLength).toBeLessThan(1048576);
    f.cfg.judgeConn.maxInputBytes = exact.byteLength;
    expect((await f.go()).error).toBeUndefined(); expect(fs.readFileSync(f.captured)).toEqual(exact);
    fs.rmSync(f.captured); fs.appendFileSync(path.join(f.repo, f.options.reportRel), 'x');
    const failed = await f.go();
    expect(failed).toMatchObject({ error: 'judge_input_budget_exceeded', escalate: true });
    expect(fs.existsSync(f.captured)).toBe(false);
  });

  it('来源事实在prompt构造后追加也计入默认1MiB，无spawn且明确infra错误', async () => {
    const f = setup(); supply.facts = { current_qa: { records: [] }, diagnostic: '源'.repeat(360000) + 'FACTS-OVER-END' };
    const result = await f.go();
    expect(result).toMatchObject({ error: 'judge_input_budget_exceeded', escalate: true });
    expect(fs.existsSync(f.captured)).toBe(false);
  });

  it.each([NaN, -1, 0, 65535, 8388609, Infinity, 'not-a-number'])('无效或越界显式预算%s关闭且不spawn', async maxInputBytes => {
    const f = setup(); f.cfg.judgeConn.maxInputBytes = maxInputBytes;
    expect(await f.go()).toMatchObject({ error: 'judge_input_budget_invalid', escalate: true });
    expect(fs.existsSync(f.captured)).toBe(false);
  });

  it('diff超过150000仍明确升级，不截断后继续裁判', async () => {
    const f = setup({ code: '// ' + 'd'.repeat(150001) + '\n' });
    const result = await f.go();
    expect(result).toMatchObject({ error: 'judge_input_truncated', escalate: true });
    expect(result.diff_chars).toBeGreaterThan(150000); expect(fs.existsSync(f.captured)).toBe(false);
  });

  it('实际stdin哈希独立于JSON材料哈希，不能把planned JSON hash当stdin hash', async () => {
    const f = setup(); const result = await f.go(); const actual = fs.readFileSync(f.captured);
    expect(sha(actual)).not.toBe(sha(JSON.stringify(f.prompt)));
    expect(result).toMatchObject({ stdin_sha256: sha(actual), materials_sha256: sha(JSON.stringify(f.prompt)), stdin_bytes: actual.byteLength });
  });
  function protectedCall(f, root) {
    return withRecordProvenance({ worktree: f.repo, root, ...f.id, stage: 'judge', round: 7, controller: controllerIdentity(new URL('../lib/judge-gate.mjs', import.meta.url)) }, f.go);
  }
  it('protected完整冻结可重建materials与实际stdin，native和stage关联同一input事件', async () => {
    const f = setup({ qa: '完整报告\r\n```\n汉字尾部' }); const root = path.join(f.dir, 'protected');
    const result = await protectedCall(f, root); expect(result.error).toBeUndefined();
    const events = fs.readdirSync(path.join(root, f.id.taskId)).filter(n => n.endsWith('.json')).map(n => JSON.parse(fs.readFileSync(path.join(root, f.id.taskId, n))));
    const inputs = events.filter(e => e.kind === 'judge_input'); expect(inputs).toHaveLength(1);
    const event = inputs[0], actual = fs.readFileSync(f.captured);
    expect(event).toMatchObject({ round: 7, stage: 'judge', sprint_dir: f.id.sprintDir, stdin_sha256: sha(actual), materials_sha256: sha(JSON.stringify(f.prompt)), stdin_bytes: actual.byteLength });
    expect(fs.readFileSync(event.stdin_path)).toEqual(actual);
    expect(JSON.parse(fs.readFileSync(event.materials_path))).toEqual(f.prompt);
    const natives = events.filter(e => e.kind === 'native'), stages = events.filter(e => e.kind === 'stage');
    expect(natives).toHaveLength(1); expect(stages).toHaveLength(1);
    expect(natives[0]).toMatchObject({ judge_input_event_id: event.id, stdin_sha256: event.stdin_sha256 });
    expect(stages[0]).toMatchObject({ judge_input_event_id: event.id, stdin_sha256: event.stdin_sha256 });
  });
  it('保护封存不可写时必须在CLI启动前失败，不能仅保留计划hash继续执行', async () => {
    const f = setup(); const root = path.join(f.dir, 'protected'); fs.writeFileSync(root, 'blocks-protected-write');
    const result = await protectedCall(f, root);
    expect(result.error).toBeTruthy(); expect(fs.existsSync(f.captured)).toBe(false);
  });

  it.each(['delete-stage-input', 'alter-stage-stdin-sha', 'alter-native-stdin-sha', 'delete-both-input-markers'])('新真实judge producer凭证拒绝%s降级/改写', async mutation => {
    const f = setup(); const root = path.join(f.dir, 'protected');
    expect((await protectedCall(f, root)).error).toBeUndefined();
    const dir = path.join(root, f.id.taskId);
    const events = fs.readdirSync(dir).filter(n => n.endsWith('.json')).map(n => JSON.parse(fs.readFileSync(path.join(dir, n))));
    const stage = events.find(e => e.kind === 'stage'), native = events.find(e => e.kind === 'native');
    const selected = { root, worktree: f.repo, ...f.id, head: f.git('rev-parse', 'HEAD').trim() };
    const file = `${f.id.sprintDir}/06-judge-r7.md`;
    expect(verifyPendingStageEvidence(selected, [file]).status).toBe('sealed_not_registered');
    const persist = event => {
      const { digest, ...payload } = event;
      fs.writeFileSync(path.join(dir, `${event.id}.json`), JSON.stringify({ ...payload, digest: sha(JSON.stringify(payload)) }) + '\n');
    };
    if (mutation === 'delete-stage-input' || mutation === 'delete-both-input-markers') delete stage.judge_input_event_id;
    if (mutation === 'alter-stage-stdin-sha') stage.stdin_sha256 = 'f'.repeat(64);
    if (mutation === 'alter-native-stdin-sha') native.stdin_sha256 = 'e'.repeat(64);
    if (mutation === 'delete-both-input-markers') delete native.judge_input_event_id;
    persist(stage);persist(native);
    expect(() => verifyPendingStageEvidence(selected, [file])).toThrow(/judge_input/);
  });

});
