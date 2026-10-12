import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { prepareCodexSession } from '../lib/codex-session.mjs';

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
    expect(s.args.join('\n')).toContain('permissions.coding.network.enabled=false');
    expect(s.args).not.toContain('--permission-mode');
    expect(s.args).not.toContain('--dangerously-bypass-approvals-and-sandbox');
  });
  it('build 只开放实际 gitdir 写权限，QA gitdir保持只读，均关闭命令网络', () => {
    const gitdir = path.join(cwd, '.git'); fs.mkdirSync(gitdir, { recursive: true });
    const build = prepareCodexSession({ args: [...flags, '--allowedTools', 'Bash', '--disallowedTools', 'Bash(git push:*)', 'Bash(gh:*)'], cwd, env });
    expect(build.args.join('\n')).toContain(`permissions.coding.filesystem.${JSON.stringify(gitdir)}="write"`);
    const qa = prepareCodexSession({ args: [...flags, '--allowedTools', 'Bash', '--disallowedTools', 'Bash(git commit:*)', 'Bash(git reset:*)', 'Bash(git checkout:*)', 'Bash(git rebase:*)', 'Bash(git push:*)', 'Bash(gh:*)'], cwd, env });
    expect(qa.args.join('\n')).toContain(`permissions.coding.filesystem.${JSON.stringify(gitdir)}="read"`);
    expect(qa.args.join('\n')).toContain('permissions.coding.network.enabled=false');
  });
  it('未知权限参数、未知工具限制与需要预览网络的 QA 明确拒绝', () => {
    expect(() => prepareCodexSession({ args: [...flags, '--disallowedTools', 'Bash(rm:*)'], cwd, env })).toThrow(/unsupported/);
    expect(() => prepareCodexSession({ args: [...flags, '--mystery'], cwd, env })).toThrow(/unsupported/);
    expect(() => prepareCodexSession({ args: ['-p', 'PREVIEW_URL: http://localhost:5300'], cwd, env })).toThrow(/local_only/);
  });
});
