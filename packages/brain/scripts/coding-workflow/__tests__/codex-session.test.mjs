import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { prepareCodexSession } from '../lib/codex-session.mjs';
import { runClaude, claudeFailure } from '../lib/claude.mjs';

const env = { CODING_WF_CODEX_HOME: '/configured/account', CODING_WF_CODEX_MODEL: 'gpt-6-astra' };
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-session-'));
const flags = ['-p', '写入规格', '--permission-mode', 'acceptEdits'];
describe('Codex 原生会话参数与权限', () => {
  it('spec 禁用所有 shell 执行入口，只开放 worktree 文件只读 MCP', () => {
    const s = prepareCodexSession({ args: [...flags, '--disallowedTools', 'Bash'], cwd, env });
    expect(s.bin).toBe('codex');
    expect(s.args.slice(0, 2)).toEqual(['exec', '--json']);
    expect(s.args).toContain('shell_tool');
    expect(s.args).toContain('unified_exec');
    expect(s.args).toContain('mcp_servers.coding_files.command=' + JSON.stringify(process.execPath));
    expect(s.env.CODEX_HOME).toBe('/configured/account');
    expect(s.args.join('\n')).toContain('"network"={"enabled"=false}');
    expect(s.args).not.toContain('--permission-mode');
    expect(s.args).not.toContain('--dangerously-bypass-approvals-and-sandbox');
  });
  it('build 只开放实际 gitdir 写权限，QA gitdir保持只读，均关闭命令网络', () => {
    fs.mkdirSync(path.join(cwd, '.git'), { recursive: true });
    const gitdir = fs.realpathSync(path.join(cwd, '.git'));
    const build = prepareCodexSession({ args: [...flags, '--allowedTools', 'Bash', '--disallowedTools', 'Bash(git push:*)', 'Bash(gh:*)'], cwd, env });
    expect(build.args.join('\n')).toContain(`${JSON.stringify(gitdir)}="write"`);
    const qa = prepareCodexSession({ args: [...flags, '--allowedTools', 'Bash', '--disallowedTools', 'Bash(git commit:*)', 'Bash(git reset:*)', 'Bash(git checkout:*)', 'Bash(git rebase:*)', 'Bash(git push:*)', 'Bash(gh:*)'], cwd, env });
    expect(qa.args.join('\n')).toContain(`${JSON.stringify(gitdir)}="read"`);
    expect(qa.args.join('\n')).toContain('"network"={"enabled"=false}');
  });
  it('未知权限参数、未知工具限制与需要预览网络的 QA 明确拒绝', () => {
    expect(() => prepareCodexSession({ args: [...flags, '--disallowedTools', 'Bash(rm:*)'], cwd, env })).toThrow(/unsupported/);
    expect(() => prepareCodexSession({ args: [...flags, '--mystery'], cwd, env })).toThrow(/unsupported/);
    expect(() => prepareCodexSession({ args: [...flags, '--disallowedTools', 'Bash', 'Read(//tmp/private)'], cwd, env })).toThrow(/unsupported/);
    expect(() => prepareCodexSession({ args: ['-p', 'PREVIEW_URL: http://localhost:5300'], cwd, env })).toThrow(/local_only/);
  });
  it('真实启动替身CLI：保持原生事件、隔离GitHub登录、费用未知、启动失败不伪装成功', async () => {
    const bin = path.join(cwd, 'native-codex.mjs');
    fs.writeFileSync(bin, '#!/usr/bin/env node\nconsole.log(JSON.stringify({type:"thread.started",thread_id:"native",args:process.argv.slice(2),token:!!process.env.GH_TOKEN}));\n');
    fs.chmodSync(bin, 0o755);
    const old = { ...process.env };
    try {
      Object.assign(process.env, { CODING_WF_PROVIDER: 'codex', CODING_WF_CODEX_BIN: bin, GH_TOKEN: 'isolated-test-token' });
      const r = await runClaude({ args: flags, cwd, timeoutMs: 1000, tag: 'native', transcriptPath: path.join(cwd, 'session.log') });
      const event = JSON.parse(r.stdout);
      expect(event.type).toBe('thread.started');
      expect(event.token).toBe(false);
      expect(event.args).toContain('--json');
      expect(event.args).not.toContain('opus');
      expect(r).toMatchObject({ code: 0, provider: 'codex', cost_usd: null });
      process.env.CODING_WF_CODEX_BIN = path.join(cwd, 'missing');
      const missing = await runClaude({ args: flags, cwd, timeoutMs: 1000, tag: 'missing' });
      expect(missing.code).not.toBe(0);
      expect(missing.cost_usd).toBeNull();
    } finally {
      for (const key of Object.keys(process.env)) if (!(key in old)) delete process.env[key];
      Object.assign(process.env, old);
    }
  });
  it('Codex工具输出里的业务鉴权字符串不冒充CLI鉴权失败', () => {
    const stdout = JSON.stringify({ type: 'item.completed', item: { type: 'command_execution', command: 'node test.mjs', aggregated_output: 'invalid api key in test fixture' } });
    const r = claudeFailure({ provider: 'codex', code: 1, stdout, output: stdout });
    expect(r.reason_code).toBe('claude_failed');
    expect(r.evidence).toContainEqual({ provider: 'codex' });
  });
});
