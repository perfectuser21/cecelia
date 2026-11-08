// status.mjs：扫 logDir 回执，按修改时间倒序列出每任务状态。
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { collectStatus, formatStatus } from '../status.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STATUS_PATH = path.join(HERE, '../status.mjs');
const COMPLETED_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const PARTIAL_ID = 'bbbbbbbb-0000-0000-0000-000000000002';
const PR_URL = 'https://github.com/perfectuser21/cecelia/pull/1';
const CIFIX_ID = 'eeeeeeee-0000-0000-0000-000000000077';

let dirs = [];
afterEach(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
  dirs = [];
});

function makeLogDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-status-'));
  dirs.push(dir);
  const completed = path.join(dir, `${COMPLETED_ID}.json`);
  const partial = path.join(dir, `${PARTIAL_ID}.json`);
  fs.writeFileSync(completed, JSON.stringify({
    schema_version: 1, workflow: 'coding_spec', run_tag: 'cw-aaaaaaaa-10080705',
    status: 'completed',
    outputs: { pr_url: PR_URL },
    activities: [{ key: 'intent', status: 'completed' }],
  }));
  fs.writeFileSync(partial, JSON.stringify({
    schema_version: 1, workflow: 'coding_spec', run_tag: 'cw-bbbbbbbb-10080705',
    status: 'partial',
    activities: [
      { key: 'intent', status: 'completed' },
      { key: 'build', status: 'failed', attempts: [{ reason_code: 'tests_failed' }] },
    ],
  }));
  fs.writeFileSync(path.join(dir, `${COMPLETED_ID}.log`), 'some log\n');
  fs.utimesSync(completed, new Date('2026-10-01T00:00:00Z'), new Date('2026-10-01T00:00:00Z'));
  fs.utimesSync(partial, new Date('2026-10-02T00:00:00Z'), new Date('2026-10-02T00:00:00Z'));
  return dir;
}

describe('collectStatus / formatStatus', () => {
  it('completed 回执含 pr_url', () => {
    const rows = collectStatus(makeLogDir());
    const row = rows.find((r) => r.task_id === COMPLETED_ID);
    expect(row.status).toBe('completed');
    expect(row.pr_url).toBe(PR_URL);
    expect(row.mtime).toBe('2026-10-01T00:00:00.000Z');
    expect(formatStatus(rows)).toContain(PR_URL);
  });

  it('partial 回执含 failed_activity 与 reason_code', () => {
    const rows = collectStatus(makeLogDir());
    const row = rows.find((r) => r.task_id === PARTIAL_ID);
    expect(row.status).toBe('partial');
    expect(row.failed_activity).toBe('build');
    expect(row.reason_code).toBe('tests_failed');
    const text = formatStatus(rows);
    expect(text).toContain('failed_activity=build');
    expect(text).toContain('reason_code=tests_failed');
  });

  it('按修改时间倒序（函数与 CLI 文本输出）', () => {
    const dir = makeLogDir();
    expect(collectStatus(dir).map((r) => r.task_id)).toEqual([PARTIAL_ID, COMPLETED_ID]);
    const res = spawnSync(process.execPath, [STATUS_PATH, '--log-dir', dir], { encoding: 'utf8' });
    expect(res.status).toBe(0);
    expect(res.stdout.indexOf(PARTIAL_ID)).toBeGreaterThanOrEqual(0);
    expect(res.stdout.indexOf(PARTIAL_ID)).toBeLessThan(res.stdout.indexOf(COMPLETED_ID));
  });

  it('--json 输出可解析的数组', () => {
    const dir = makeLogDir();
    const res = spawnSync(process.execPath, [STATUS_PATH, '--log-dir', dir, '--json'], { encoding: 'utf8' });
    expect(res.status).toBe(0);
    expect(JSON.parse(res.stdout).map((r) => r.task_id)).toEqual([PARTIAL_ID, COMPLETED_ID]);
  });

  it('非任务文件即使含 completed 也不能展示成任务完成', () => {
    const dir = makeLogDir();
    fs.writeFileSync(path.join(dir, 'unrelated.json'), JSON.stringify({ schema_version: 1, workflow: 'coding_spec', run_tag: 'cw-eeeeeeee-10080705', activities: [], status: 'completed', outputs: { pr_url: 'https://example.invalid/pull/77' } }));
    expect(collectStatus(dir).some((r) => r.task_id === 'unrelated' && r.status === 'completed')).toBe(false);
  });

  it('UUID 文件名仍需有效回执结构与匹配的运行前缀', () => {
    const dir = makeLogDir();
    fs.writeFileSync(path.join(dir, `${CIFIX_ID}.json`), JSON.stringify({ status: 'completed' }));
    expect(collectStatus(dir).find((r) => r.task_id === CIFIX_ID).status).toBe('unreadable');
    fs.writeFileSync(path.join(dir, `${CIFIX_ID}.json`), JSON.stringify({ schema_version: 1, workflow: 'coding_spec', run_tag: 'cw-ffffffff-10080705', activities: [], status: 'completed' }));
    expect(collectStatus(dir).find((r) => r.task_id === CIFIX_ID).status).toBe('unreadable');
  });

  it('CI 修复记录按注册仓库隔离，未知仓库不关联', () => {
    const dir = makeLogDir();
    fs.writeFileSync(path.join(dir, 'cifix-77.json'), JSON.stringify({ attempts: [{ result: 'wrong-repo' }] }));
    fs.writeFileSync(path.join(dir, `${CIFIX_ID}.json`), JSON.stringify({ schema_version: 1, workflow: 'coding_spec', run_tag: 'cw-eeeeeeee-10080705', activities: [], status: 'completed', outputs: { pr_url: 'https://github.com/other/repo/pull/77' } }));
    expect(collectStatus(dir).find((r) => r.task_id === CIFIX_ID).ci_fix).toBeNull();
    fs.mkdirSync(path.join(dir, 'zenithjoy-workspace'));
    fs.writeFileSync(path.join(dir, 'zenithjoy-workspace', 'cifix-77.json'), JSON.stringify({ attempts: [{ result: 'correct-repo' }] }));
    fs.writeFileSync(path.join(dir, `${CIFIX_ID}.json`), JSON.stringify({ schema_version: 1, workflow: 'coding_spec', run_tag: 'cw-eeeeeeee-10080705', activities: [], status: 'completed', outputs: { pr_url: 'https://github.com/perfectuser21/zenithjoy-workspace/pull/77' } }));
    expect(collectStatus(dir).find((r) => r.task_id === CIFIX_ID).ci_fix).toEqual({ attempts: 1, last_result: 'correct-repo' });
  });

  it('非 GitHub 链接不能关联同编号的 CI 修复记录', () => {
    const dir = makeLogDir();
    fs.writeFileSync(path.join(dir, `${CIFIX_ID}.json`), JSON.stringify({ schema_version: 1, workflow: 'coding_spec', run_tag: 'cw-eeeeeeee-10080705', activities: [], status: 'completed', outputs: { pr_url: 'https://example.invalid/pull/77' } }));
    fs.writeFileSync(path.join(dir, 'cifix-77.json'), JSON.stringify({ attempts: [{ result: 'pushed' }] }));
    expect(collectStatus(dir).find((r) => r.task_id === CIFIX_ID).ci_fix).toBeNull();
  });

  it.each([
    'https://github.com.example.invalid/perfectuser21/cecelia/pull/77',
    'http://github.com/perfectuser21/cecelia/pull/77',
    'https://user@github.com/perfectuser21/cecelia/pull/77',
    'https://github.com/perfectuser21/cecelia/pull/77/extra',
  ])('拒绝非标准 GitHub PR 地址 %s', (url) => {
    const dir = makeLogDir();
    fs.writeFileSync(path.join(dir, `${CIFIX_ID}.json`), JSON.stringify({ schema_version: 1, workflow: 'coding_spec', run_tag: 'cw-eeeeeeee-10080705', activities: [], status: 'completed', outputs: { pr_url: url } }));
    fs.writeFileSync(path.join(dir, 'cifix-77.json'), JSON.stringify({ attempts: [{ result: 'pushed' }] }));
    expect(collectStatus(dir).find((r) => r.task_id === CIFIX_ID).ci_fix).toBeNull();
  });

  it('--log-dir 后缺参数时拒绝而不是吞掉 --json', () => {
    const res = spawnSync(process.execPath, [STATUS_PATH, '--log-dir', '--json'], { encoding: 'utf8' });
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain('--log-dir');
  });

  it('--log-dir 位于末尾时也返回错误', () => {
    const res = spawnSync(process.execPath, [STATUS_PATH, '--log-dir'], { encoding: 'utf8' });
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain('--log-dir');
  });

  it('忽略非 json 文件', () => {
    const rows = collectStatus(makeLogDir());
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => !r.task_id.endsWith('.log'))).toBe(true);
  });

  it('进度快照记为 running，坏 JSON 记为 unreadable 且不影响其他条目', () => {
    const dir = makeLogDir();
    fs.writeFileSync(path.join(dir, 'cccccccc-0000-0000-0000-000000000003.json'), JSON.stringify({ schema_version: 1, workflow: 'coding_spec', run_tag: 'cw-cccccccc-10080705', activities: [], status: 'partial', last_event: 'x' }));
    fs.writeFileSync(path.join(dir, 'dddddddd-0000-0000-0000-000000000004.json'), '{not json');
    const rows = collectStatus(dir);
    expect(rows).toHaveLength(4);
    expect(rows.find((r) => r.task_id === 'cccccccc-0000-0000-0000-000000000003')).toMatchObject({ status: 'running', failed_activity: null, reason_code: null, pr_url: null });
    expect(rows.find((r) => r.task_id === 'dddddddd-0000-0000-0000-000000000004')).toMatchObject({ status: 'unreadable', failed_activity: null, reason_code: null, pr_url: null });
    expect(rows.find((r) => r.task_id === COMPLETED_ID).status).toBe('completed');
  });

  it('有 cifix 状态文件的任务带 ci_fix 摘要，状态文件本身不成为任务行', () => {
    const dir = makeLogDir();
    fs.writeFileSync(path.join(dir, `${CIFIX_ID}.json`), JSON.stringify({
      schema_version: 1, workflow: 'coding_spec', run_tag: 'cw-eeeeeeee-10080705', activities: [],
      status: 'completed',
      outputs: { pr_url: 'https://github.com/perfectuser21/cecelia/pull/77' },
    }));
    fs.writeFileSync(path.join(dir, 'cifix-77.json'), JSON.stringify({
      attempts: [{ pr: 77, result: 'push_failed' }, { pr: 77, result: 'pushed' }],
    }));
    const rows = collectStatus(dir);
    expect(rows.find((r) => r.task_id === CIFIX_ID).ci_fix).toEqual({ attempts: 2, last_result: 'pushed' });
    expect(rows.some((r) => r.task_id === 'cifix-77')).toBe(false);
    const line = formatStatus(rows).split('\n').find((l) => l.includes(CIFIX_ID));
    expect(line).toContain('ci_fix=2次');
    expect(line).toContain('pushed');
  });

  it('没有 cifix 状态文件的任务 ci_fix 为 null 且文本行不含 ci_fix', () => {
    const dir = makeLogDir();
    const lineOf = (text, id) => text.split('\n').find((l) => l.includes(id));
    let rows = collectStatus(dir);
    expect(rows.find((r) => r.task_id === COMPLETED_ID).ci_fix).toBeNull();
    let text = formatStatus(rows);
    expect(lineOf(text, COMPLETED_ID)).not.toContain('ci_fix');
    expect(lineOf(text, PARTIAL_ID)).not.toContain('ci_fix');

    fs.writeFileSync(path.join(dir, `${CIFIX_ID}.json`), JSON.stringify({
      schema_version: 1, workflow: 'coding_spec', run_tag: 'cw-eeeeeeee-10080705', activities: [],
      status: 'completed',
      outputs: { pr_url: 'https://github.com/perfectuser21/cecelia/pull/77' },
    }));
    fs.writeFileSync(path.join(dir, 'cifix-77.json'), JSON.stringify({ attempts: [{ pr: 77, result: 'pushed' }] }));
    rows = collectStatus(dir);
    expect(rows.find((r) => r.task_id === COMPLETED_ID).ci_fix).toBeNull();
    text = formatStatus(rows);
    expect(lineOf(text, COMPLETED_ID)).not.toContain('ci_fix');
    expect(lineOf(text, CIFIX_ID)).toContain('ci_fix=1次');
  });

  it('目录不存在：collectStatus 返回 []，CLI 退出 0 且提示没有运行记录', () => {
    const missing = path.join(os.tmpdir(), `cw-status-not-exist-${process.pid}-${Date.now()}`);
    expect(collectStatus(missing)).toEqual([]);
    expect(formatStatus([])).toContain('没有运行记录');
    const res = spawnSync(process.execPath, [STATUS_PATH, '--log-dir', missing], { encoding: 'utf8' });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('没有运行记录');
  });
});
