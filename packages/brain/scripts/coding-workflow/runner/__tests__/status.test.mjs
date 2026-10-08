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
const PR_URL = 'https://github.com/x/y/pull/1';
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
    status: 'completed',
    outputs: { pr_url: PR_URL },
    activities: [{ key: 'intent', status: 'completed' }],
  }));
  fs.writeFileSync(partial, JSON.stringify({
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

  it('忽略非 json 文件', () => {
    const rows = collectStatus(makeLogDir());
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => !r.task_id.endsWith('.log'))).toBe(true);
  });

  it('进度快照记为 running，坏 JSON 记为 unreadable 且不影响其他条目', () => {
    const dir = makeLogDir();
    fs.writeFileSync(path.join(dir, 'cccccccc.json'), JSON.stringify({ status: 'partial', last_event: 'x' }));
    fs.writeFileSync(path.join(dir, 'dddddddd.json'), '{not json');
    const rows = collectStatus(dir);
    expect(rows).toHaveLength(4);
    expect(rows.find((r) => r.task_id === 'cccccccc')).toMatchObject({ status: 'running', failed_activity: null, reason_code: null, pr_url: null });
    expect(rows.find((r) => r.task_id === 'dddddddd')).toMatchObject({ status: 'unreadable', failed_activity: null, reason_code: null, pr_url: null });
    expect(rows.find((r) => r.task_id === COMPLETED_ID).status).toBe('completed');
  });

  it('有 cifix 状态文件的任务带 ci_fix 摘要，状态文件本身不成为任务行', () => {
    const dir = makeLogDir();
    fs.writeFileSync(path.join(dir, `${CIFIX_ID}.json`), JSON.stringify({
      status: 'completed',
      outputs: { pr_url: 'https://github.com/x/y/pull/77' },
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
      status: 'completed',
      outputs: { pr_url: 'https://github.com/x/y/pull/77' },
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
