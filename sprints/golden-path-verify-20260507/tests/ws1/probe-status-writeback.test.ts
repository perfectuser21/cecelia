/**
 * Workstream 1 — 端到端探针：harness_initiative 完成后 tasks.status 自动回写 [BEHAVIOR]
 *
 * Round 1 — 这是 ARTIFACT 校验 + 探针脚本 schema 校验层。
 * 真正的端到端 PG 真实运行由 scripts/probe-harness-initiative-writeback.sh 触发，
 * 本测试守护"脚本结构合同"——脚本必须含 4 步硬阈值断言，且每步都用时间窗口防造假。
 *
 * 测试故意先红（probe 脚本尚未创建）。
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');
const PROBE_SCRIPT = resolve(REPO_ROOT, 'scripts/probe-harness-initiative-writeback.sh');

function readProbe(): string {
  if (!existsSync(PROBE_SCRIPT)) {
    throw new Error(`probe script not found: ${PROBE_SCRIPT}`);
  }
  return readFileSync(PROBE_SCRIPT, 'utf8');
}

describe('WS1 — probe-harness-initiative-writeback 脚本合同 [BEHAVIOR]', () => {
  it('Step 1: 脚本注入 fresh harness_initiative 任务（不复用 84075973-... 防自指）', () => {
    const c = readProbe();
    // 必须 INSERT 一条新 task
    expect(c).toMatch(/INSERT\s+INTO\s+tasks/i);
    expect(c).toContain("'harness_initiative'");
    expect(c).toContain("'queued'");
    // 显式标记 _probe，便于事后清理 + 防误识为真任务
    expect(c).toContain('"_probe":true');
    // 不允许把 hardcoded 84075973 当目标 task（自指会永远 in_progress）
    expect(c).not.toMatch(/WHERE\s+id\s*=\s*'?84075973-/);
  });

  it('Step 2: 脚本检查 graph_node_update event 至少 1 条 + 静默 5min（防死循环假绿）', () => {
    const c = readProbe();
    expect(c).toContain('graph_node_update');
    // 必须带时间窗口 — 防止历史 event 污染计数
    expect(c).toMatch(/created_at\s*>\s*NOW\(\)\s*-\s*interval\s*'\d+\s*minutes?'/i);
    // 必须有"最近 5min 静默"判定（不能只看历史 count）
    expect(c).toMatch(/interval\s*'5\s*minutes?'/i);
  });

  it('Step 3: 终态断言用 SQL 比时间戳，不用 shell 字符串', () => {
    const c = readProbe();
    // 终态枚举
    expect(c).toMatch(/completed\|failed/);
    // completed_at 非空判定
    expect(c).toContain('completed_at');
    // 时间戳比对必须是 SQL `(completed_at >= started_at)`，不能是 shell 字符串比较
    expect(c).toMatch(/SELECT\s*\(\s*completed_at\s*>=\s*started_at\s*\)/i);
  });

  it('Step 4: anti-requeue 观察窗 ≥ 10min 且检查 tick_decisions / run_events 双源', () => {
    const c = readProbe();
    // 观察窗 ≥ 10min（覆盖至少 2 个 5min tick 周期）
    expect(c).toMatch(/sleep\s+(600|900|1200)/);
    // 检查 run_events 没有新活跃 run
    expect(c).toMatch(/run_events/i);
    expect(c).toMatch(/status\s+IN\s*\(\s*'running'\s*,\s*'queued'\s*\)/i);
    // 检查 tick_decisions 没有 requeue/reschedule
    expect(c).toMatch(/tick_decisions/i);
    expect(c).toMatch(/'(requeue|reschedule|executor_failed)'/);
  });
});
