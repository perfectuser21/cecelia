/**
 * 执行体类型 coding-workflow-runner（coding workflow 第四刀 C1）：
 * runner 在执行机上认领 task_type=data 的开关任务，进程不在 Brain 本机。
 * 若按默认 headed-session 处理，Brain 重启时 startup-sync 会把 in_progress 打回 queued、
 * 60 分钟后清 claim，runner 再认领就会重跑出第二个 PR。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CODING_WORKFLOW_RUNNER_EXECUTOR_KIND,
  VALID_EXECUTOR_KINDS,
  EXECUTOR_CONTRACTS,
  isExternallyExecuted,
  assessTaskLiveness,
} from '../executor-contracts.js';

const MIG = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations');

describe('coding-workflow-runner 执行体类型', () => {
  it('登记为合法 executor_kind', () => {
    expect(CODING_WORKFLOW_RUNNER_EXECUTOR_KIND).toBe('coding-workflow-runner');
    expect(VALID_EXECUTOR_KINDS).toContain('coding-workflow-runner');
  });

  it('属外部执行体：按持久化 executor_kind 判定，不影响普通 data 任务', () => {
    expect(isExternallyExecuted({ task_type: 'data', executor_kind: 'coding-workflow-runner' })).toBe(true);
    expect(isExternallyExecuted({ task_type: 'data', executor_kind: 'headed-session' })).toBe(false);
    expect(isExternallyExecuted({ task_type: 'data', executor_kind: null })).toBe(false);
  });

  it('探活恒 unknown 且无超时处置：Brain 不替 runner 判生死（收尾与对账由 runner 自己做）', async () => {
    const contract = EXECUTOR_CONTRACTS['coding-workflow-runner'];
    expect(contract).toBeTruthy();
    expect(contract.staleMinutes).toBeNull();
    expect(contract.onStale).toBe('none');
    const r = await assessTaskLiveness({ id: 't1', task_type: 'data', executor_kind: 'coding-workflow-runner' }, {});
    expect(r.verdict).toBe('unknown');
    expect(r.onStale).toBe('none');
  });

  it('迁移 535 在既有 tasks_executor_kind_check 上追加 coding-workflow-runner', () => {
    const sql = readFileSync(join(MIG, '535_coding_workflow_runner_executor_kind.sql'), 'utf8');
    expect(sql).toContain("conname='tasks_executor_kind_check'");
    expect(sql).toContain('CHECK ((%s) OR executor_kind=%L)');
    expect(sql).toContain("substring(definition FROM 8 FOR length(definition)-8),'coding-workflow-runner'");
  });
});
