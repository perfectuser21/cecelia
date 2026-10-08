import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFrontmatter } from '../lib/md-chain.mjs';
import { runActivityProcess } from './helpers/run-activity.mjs';
import { gitPlain } from './helpers/git.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENTRY = path.join(HERE, '../activities/spec-review.mjs');
const FAKE_CLAUDE = path.join(HERE, 'fixtures/fake-claude.mjs');
const TASK_ID = '11111111-2222-3333-4444-555555555555';

const INTENT_MD = `---
task_id: ${TASK_ID}
step: intent
upstream: []
---
# 验收条目

### I-1
能评审。

### I-2
能改写。
`;
const SPEC_MD = `---
task_id: ${TASK_ID}
step: spec
upstream: ["01-intent.md#I-1", "01-intent.md#I-2"]
---
# spec

### S-1
对应 I-1：改 foo.js，验证 npm test

### S-2
对应 I-2：改 bar.js，验证 npm test
`;

const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');
const count = (text, needle) => text.split(needle).length - 1;

describe('spec_review 活动（子进程 + 假 claude）', () => {
  let worktree;

  beforeAll(() => {
    fs.chmodSync(FAKE_CLAUDE, 0o755);
  });
  beforeEach(() => {
    worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-review-test-'));
    gitPlain('init', '-q', worktree);
    fs.mkdirSync(path.join(worktree, 'sprints/s1'), { recursive: true });
    fs.writeFileSync(path.join(worktree, 'sprints/s1/01-intent.md'), INTENT_MD);
    fs.writeFileSync(path.join(worktree, 'sprints/s1/02-spec.md'), SPEC_MD);
  });
  afterEach(() => {
    fs.rmSync(worktree, { recursive: true, force: true });
  });

  const input = (patch = {}) => ({
    run_tag: 'rt-1',
    task_id: TASK_ID,
    worktree,
    sprint_dir: 'sprints/s1',
    intent_ids: ['I-1', 'I-2'],
    intent_sha256: sha256(INTENT_MD),
    ...patch,
  });
  const run = ({ review, revise = 'revise-ok' }, patch, extraEnv = {}) =>
    runActivityProcess(ENTRY, input(patch), {
      CODING_WF_CLAUDE_BIN: FAKE_CLAUDE,
      FAKE_CLAUDE_MODE_REVIEW: review,
      FAKE_CLAUDE_MODE_REVISE: revise,
      ...extraEnv,
    });
  const sprintFile = (name) => path.join(worktree, 'sprints/s1', name);

  it('一次通过：completed，outputs 记录评审文件/轮数/02 哈希，只起一次评审会话', async () => {
    const r = await run({ review: 'review-approve' });
    expect(r.exitCode).toBe(0);
    expect(r.result.status).toBe('completed');
    expect(r.result.failure_class).toBeNull();
    expect(r.stdout.trim().split('\n')).toHaveLength(1);
    expect(r.result.outputs).toEqual({ review_file: '02-review.md', review_rounds: 1, spec_sha256: sha256(SPEC_MD) });
    expect(count(r.stderr, 'FAKE_ROLE: spec_review')).toBe(1);
    expect(count(r.stderr, 'FAKE_ROLE: spec_revise')).toBe(0);
    expect(r.stderr).toContain('FAKE_ARGS: -p --permission-mode acceptEdits --disallowedTools Bash --model opus\n');
    expect(r.stderr).toContain('FAKE_GH_CONFIG_DIR: ');
    expect(r.stderr).not.toContain('FAKE_GH_CONFIG_DIR: <unset>');
    expect(r.stderr).toContain(`FAKE_CWD: ${fs.realpathSync(worktree)}`);

    const fm = parseFrontmatter(fs.readFileSync(sprintFile('02-review.md'), 'utf8'));
    expect(fm.data.step).toBe('spec_review');
    expect(fm.data.upstream).toEqual(['02-spec.md#S-1', '02-spec.md#S-2']);
  });

  it('改写一轮后通过：review_rounds=2，spec_sha256 为改写后 02 的哈希', async () => {
    const r = await run({ review: 'review-until-fixed', revise: 'revise-ok' });
    expect(r.exitCode).toBe(0);
    expect(r.result.status).toBe('completed');
    const spec = fs.readFileSync(sprintFile('02-spec.md'), 'utf8');
    expect(spec).not.toBe(SPEC_MD);
    expect(spec).toContain('已按评审修改 R-1');
    expect(r.result.outputs.review_rounds).toBe(2);
    expect(r.result.outputs.spec_sha256).toBe(sha256(spec));
    expect(r.result.outputs.spec_sha256).not.toBe(sha256(SPEC_MD));
    expect(count(r.stderr, 'FAKE_ROLE: spec_review')).toBe(2);
    expect(count(r.stderr, 'FAKE_ROLE: spec_revise')).toBe(1);
  });

  it('两轮改写后仍 REVISE -> fatal spec_review_unresolved，列出最后一次评审的问题', async () => {
    const r = await run({ review: 'review-revise', revise: 'revise-ok' });
    expect(r.exitCode).toBe(2);
    expect(r.result.failure_class).toBe('fatal');
    expect(r.result.reason_code).toBe('spec_review_unresolved');
    expect(r.result.evidence).toEqual([{ unresolved_issues: ['R-1'] }]);
    expect(count(r.stderr, 'FAKE_ROLE: spec_review')).toBe(3);
    expect(count(r.stderr, 'FAKE_ROLE: spec_revise')).toBe(2);
  });

  it('评审会话改了 01-intent.md -> fatal chain_tampered', async () => {
    const r = await run({ review: 'review-approve' }, {}, { FAKE_TAMPER_FILE: 'sprints/s1/01-intent.md' });
    expect(r.exitCode).toBe(2);
    expect(r.result.failure_class).toBe('fatal');
    expect(r.result.reason_code).toBe('chain_tampered');
    expect(r.result.evidence).toEqual([{ tampered_files: ['01-intent.md'] }]);
  });

  it('REVISE 评审会话改了 01-intent.md -> chain_tampered，不再起改写会话', async () => {
    const r = await run({ review: 'review-revise', revise: 'revise-ok' }, {}, { FAKE_TAMPER_FILE: 'sprints/s1/01-intent.md' });
    expect(r.result.reason_code).toBe('chain_tampered');
    expect(count(r.stderr, 'FAKE_ROLE: spec_revise')).toBe(0);
  });

  it('入参 intent_sha256 与现存 01 不符 -> chain_tampered，不启动 claude', async () => {
    const r = await run({ review: 'review-approve' }, { intent_sha256: sha256('other') });
    expect(r.exitCode).toBe(2);
    expect(r.result.failure_class).toBe('fatal');
    expect(r.result.reason_code).toBe('chain_tampered');
    expect(r.result.evidence).toEqual([{ tampered_files: ['01-intent.md'] }]);
    expect(r.stderr).not.toContain('FAKE_CWD');
  });

  it('评审会话越界写 -> fatal spec_review_out_of_scope_write', async () => {
    const r = await run({ review: 'review-outside' });
    expect(r.exitCode).toBe(2);
    expect(r.result.failure_class).toBe('fatal');
    expect(r.result.reason_code).toBe('spec_review_out_of_scope_write');
    expect(r.result.evidence).toEqual([{ out_of_scope_changes: ['stray.txt'] }]);
  });

  it('评审文档无 verdict 行 -> retryable review_invalid', async () => {
    const r = await run({ review: 'review-badformat' });
    expect(r.exitCode).toBe(2);
    expect(r.result.failure_class).toBe('retryable');
    expect(r.result.reason_code).toBe('review_invalid');
    expect(JSON.stringify(r.result.evidence)).toContain('verdict_missing');
  });

  it('评审会话退出 0 但没写评审文档 -> retryable review_invalid', async () => {
    const r = await run({ review: 'nofile' });
    expect(r.result.failure_class).toBe('retryable');
    expect(r.result.reason_code).toBe('review_invalid');
    expect(JSON.stringify(r.result.evidence)).toContain('review_missing');
  });

  it('旧 02-review.md 残留 + 评审会话没写新文件 -> 不把旧文档当新结论', async () => {
    fs.writeFileSync(sprintFile('02-review.md'), `---\ntask_id: ${TASK_ID}\nstep: spec_review\nupstream: ["02-spec.md#S-1", "02-spec.md#S-2"]\n---\nverdict: APPROVE\n`);
    const r = await run({ review: 'nofile' });
    expect(r.result.reason_code).toBe('review_invalid');
    expect(fs.existsSync(sprintFile('02-review.md'))).toBe(false);
  });

  it('改写后 02 不合格（删了 S-n）-> retryable spec_invalid', async () => {
    // noids 模式按 INTENT_IDS 重写 02 但没有 S-n 标题
    const r = await run({ review: 'review-revise', revise: 'noids' });
    expect(r.result.failure_class).toBe('retryable');
    expect(r.result.reason_code).toBe('spec_invalid');
    expect(JSON.stringify(r.result.evidence)).toContain('spec_ids_missing');
  });

  it('改写会话删了 02 -> fatal spec_missing', async () => {
    const r = await run({ review: 'review-revise', revise: 'revise-delete' });
    expect(r.result.failure_class).toBe('fatal');
    expect(r.result.reason_code).toBe('spec_missing');
  });

  it('02-spec.md 不存在 -> fatal spec_missing，不启动 claude', async () => {
    fs.rmSync(sprintFile('02-spec.md'));
    const r = await run({ review: 'review-approve' });
    expect(r.result.failure_class).toBe('fatal');
    expect(r.result.reason_code).toBe('spec_missing');
    expect(r.stderr).not.toContain('FAKE_CWD');
  });

  it('intent_ids 非法 -> fatal intent_ids_invalid，不启动 claude', async () => {
    const r = await run({ review: 'review-approve' }, { intent_ids: ['i-1'] });
    expect(r.result.failure_class).toBe('fatal');
    expect(r.result.reason_code).toBe('intent_ids_invalid');
    expect(r.stderr).not.toContain('FAKE_CWD');
  });

  it('认证失败 -> needs_human claude_auth', async () => {
    const r = await run({ review: 'auth' });
    expect(r.result.failure_class).toBe('needs_human');
    expect(r.result.reason_code).toBe('claude_auth');
  });

  it('评审会话卡死 -> retryable claude_timeout（CODING_WF_SPEC_REVIEW_TIMEOUT_MS 生效）', async () => {
    const started = Date.now();
    const r = await run({ review: 'sleep' }, {}, { CODING_WF_SPEC_REVIEW_TIMEOUT_MS: '1500' });
    expect(r.result.failure_class).toBe('retryable');
    expect(r.result.reason_code).toBe('claude_timeout');
    expect(Date.now() - started).toBeLessThan(10000);
  });
});
