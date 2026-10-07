import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runActivityProcess } from './helpers/run-activity.mjs';

const ENTRY = path.join(path.dirname(fileURLToPath(import.meta.url)), '../activities/chain-check.mjs');
const TASK_ID = 'task-chain-1';

function fm(taskId, step, upstream) {
  return `---\ntask_id: ${taskId}\nstep: ${step}\nupstream: ${JSON.stringify(upstream)}\n---\n`;
}

describe('chain_check 活动（子进程）', () => {
  let worktree;
  let sprintAbs;

  beforeEach(() => {
    worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'chain-check-test-'));
    sprintAbs = path.join(worktree, 'sprints/s1');
    fs.mkdirSync(sprintAbs, { recursive: true });
    fs.writeFileSync(
      path.join(sprintAbs, '01-intent.md'),
      `${fm(TASK_ID, 'intent', [])}\n# 意图\n\n### I-1\n第一条\n\n### I-2\n第二条\n`,
    );
  });

  afterEach(() => {
    fs.rmSync(worktree, { recursive: true, force: true });
  });

  const input = (patch = {}) => ({
    run_tag: 'rt-1',
    task_id: TASK_ID,
    worktree,
    sprint_dir: 'sprints/s1',
    ...patch,
  });
  const writeSpec = (upstream) => fs.writeFileSync(
    path.join(sprintAbs, '02-spec.md'),
    `${fm(TASK_ID, 'spec', upstream)}\n# 规格\n\n### S-1\n内容\n`,
  );

  it('合法链 -> completed，outputs 只含 chain_files', async () => {
    writeSpec(['01-intent.md#I-1', '01-intent.md#I-2']);
    const r = await runActivityProcess(ENTRY, input());
    expect(r.exitCode).toBe(0);
    expect(r.result.status).toBe('completed');
    expect(r.result.failure_class).toBeNull();
    expect(r.result.run_tag).toBe('rt-1');
    expect(r.result.outputs).toEqual({ chain_files: ['01-intent.md', '02-spec.md'] });
  });

  it('伪造锚点 -> failed fatal md_chain_invalid，evidence[0].errors 含错误码', async () => {
    writeSpec(['01-intent.md#I-1', '01-intent.md#I-2', '01-intent.md#I-9']);
    const r = await runActivityProcess(ENTRY, input());
    expect(r.exitCode).toBe(2);
    expect(r.result.status).toBe('failed');
    expect(r.result.failure_class).toBe('fatal');
    expect(r.result.reason_code).toBe('md_chain_invalid');
    expect(r.result.evidence[0].errors).toContain('upstream_anchor_missing:01-intent.md#I-9');
  });

  it('sprint_dir 非法 -> fatal sprint_dir_invalid', async () => {
    const r = await runActivityProcess(ENTRY, input({ sprint_dir: '../x' }));
    expect(r.exitCode).toBe(2);
    expect(r.result.failure_class).toBe('fatal');
    expect(r.result.reason_code).toBe('sprint_dir_invalid');
  });

  it('缺 task_id -> fatal task_id_missing', async () => {
    const r = await runActivityProcess(ENTRY, input({ task_id: '' }));
    expect(r.exitCode).toBe(2);
    expect(r.result.failure_class).toBe('fatal');
    expect(r.result.reason_code).toBe('task_id_missing');
  });
});
