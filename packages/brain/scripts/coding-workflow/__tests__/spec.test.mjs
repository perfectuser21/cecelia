import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFrontmatter } from '../lib/md-chain.mjs';
import { runActivityProcess } from './helpers/run-activity.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENTRY = path.join(HERE, '../activities/spec.mjs');
const FAKE_CLAUDE = path.join(HERE, 'fixtures/fake-claude.mjs');
const TASK_ID = '11111111-2222-3333-4444-555555555555';

describe('spec 活动（子进程 + 假 claude）', () => {
  let worktree;

  beforeAll(() => {
    fs.chmodSync(FAKE_CLAUDE, 0o755);
  });
  beforeEach(() => {
    worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-test-'));
  });
  afterEach(() => {
    fs.rmSync(worktree, { recursive: true, force: true });
  });

  const input = (patch = {}) => ({
    run_tag: 'rt-1',
    task_id: TASK_ID,
    worktree,
    sprint_dir: 'sprints/s1',
    intent_file: '01-intent.md',
    intent_ids: ['I-1', 'I-2'],
    ...patch,
  });
  const run = (mode, patch) =>
    runActivityProcess(ENTRY, input(patch), { CODING_WF_CLAUDE_BIN: FAKE_CLAUDE, FAKE_CLAUDE_MODE: mode });
  const specFile = () => path.join(worktree, 'sprints/s1/02-spec.md');

  it('ok：completed，写出合法 02-spec.md，stdout 整体可解析为单个结果 JSON', async () => {
    const r = await run('ok');
    expect(r.exitCode).toBe(0);
    expect(r.result).not.toBeNull();
    expect(r.result.failure_class).toBeNull();
    expect(r.result.run_tag).toBe('rt-1');
    expect(r.result.outputs).toEqual({ spec_file: '02-spec.md' });
    expect(r.stdout.trim().split('\n')).toHaveLength(1);

    const md = fs.readFileSync(specFile(), 'utf8');
    const fm = parseFrontmatter(md);
    expect(fm.data).toEqual({
      task_id: TASK_ID,
      step: 'spec',
      upstream: ['01-intent.md#I-1', '01-intent.md#I-2'],
    });
    expect(md).toContain('### S-1');
    expect(md).toContain('### S-2');
  });

  it('ok：子进程输出转写到 stderr，参数与 cwd 正确', async () => {
    const r = await run('ok');
    expect(r.stderr).toContain('fake claude log line 199');
    expect(r.stderr).toContain('FAKE_ARGS: -p --permission-mode acceptEdits');
    expect(r.stderr).toContain(`FAKE_CWD: ${fs.realpathSync(worktree)}`);
  });

  it('退出 0 但没写文件 -> fatal spec_missing', async () => {
    const r = await run('nofile');
    expect(r.exitCode).toBe(2);
    expect(r.result.failure_class).toBe('fatal');
    expect(r.result.reason_code).toBe('spec_missing');
    expect(r.stdout.trim().split('\n')).toHaveLength(1);
  });

  it('认证失败 -> needs_human claude_auth', async () => {
    const r = await run('auth');
    expect(r.exitCode).toBe(2);
    expect(r.result.failure_class).toBe('needs_human');
    expect(r.result.reason_code).toBe('claude_auth');
  });

  it('其他非 0 退出 -> retryable claude_failed', async () => {
    const r = await run('fail');
    expect(r.exitCode).toBe(2);
    expect(r.result.failure_class).toBe('retryable');
    expect(r.result.reason_code).toBe('claude_failed');
  });

  it('claude 可执行文件不存在 -> retryable claude_failed', async () => {
    const r = await runActivityProcess(ENTRY, input(), { CODING_WF_CLAUDE_BIN: '/nonexistent/claude-bin' });
    expect(r.exitCode).toBe(2);
    expect(r.result.failure_class).toBe('retryable');
    expect(r.result.reason_code).toBe('claude_failed');
  });

  it('sprint_dir 为绝对路径 -> fatal sprint_dir_invalid，不启动 claude', async () => {
    const r = await run('ok', { sprint_dir: '/abs' });
    expect(r.exitCode).toBe(2);
    expect(r.result.failure_class).toBe('fatal');
    expect(r.result.reason_code).toBe('sprint_dir_invalid');
    expect(r.stderr).not.toContain('FAKE_CWD');
  });

  it('intent_ids 缺失或为空 -> fatal intent_ids_missing', async () => {
    const r = await run('ok', { intent_ids: [] });
    expect(r.exitCode).toBe(2);
    expect(r.result.failure_class).toBe('fatal');
    expect(r.result.reason_code).toBe('intent_ids_missing');
  });

  it('task_id 与 sprint_dir 同时非法 -> 先报 task_id_missing', async () => {
    const r = await run('ok', { task_id: '', sprint_dir: '/abs' });
    expect(r.result.reason_code).toBe('task_id_missing');
    expect(r.stderr).not.toContain('FAKE_CWD');
  });
});
