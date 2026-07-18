/**
 * S3 联动清单（MJ5 刀3）
 *
 * 给定改动文件列表，从 journey_step_links 拉出被影响的断言清单，
 * 分类为"可立即跑"（tests/ 或 manual:）和"待 nightly 覆盖"（其他）。
 *
 * 消费方：harness-evaluator（Step B-0.5）、POST /api/brain/cascade-list
 *
 * 输入端切换（MJ5 刀A2 radius-rerun-gate）：
 * - 优先路径：callRadius() → /api/brain/graph/radius 图引擎
 * - 回退路径：journey_step_links 格子查询（永久保留）
 * - radius 不可达（超时/错误/stale）→ WARN + 回退格子路径
 */

import pool from './db.js';
import { callRadius } from './lib/radius-client.js';

/**
 * 判断 assertion_ref 是否可立即运行（thin档判定规则）。
 *
 * - tests/ 路径：vitest / jest 测试文件，可直接跑
 * - manual: 前缀：白名单命令，可直接执行
 * - 其他（L3:真机/null）：待 nightly 覆盖
 *
 * @param {string|null} assertionRef
 * @returns {boolean}
 */
export function isRunnable(assertionRef) {
  if (!assertionRef) return false;
  return assertionRef.startsWith('tests/') || assertionRef.startsWith('manual:');
}

/**
 * 从 journey_step_links 格子查询获取改动文件影响的断言（回退路径，永久保留）。
 *
 * @param {string[]} changedFiles - 改动文件路径列表
 * @returns {Promise<Array<{assertion_ref: string|null, na_reason: string|null}>>}
 */
async function queryCellsFromJourneyStepLinks(changedFiles) {
  if (!changedFiles || changedFiles.length === 0) {
    return [];
  }
  const result = await pool.query(
    `SELECT DISTINCT jsl.assertion_ref, jsl.na_reason
     FROM journey_step_links jsl
     WHERE jsl.source_file = ANY($1::text[])`,
    [changedFiles]
  );
  return result.rows;
}

/**
 * 获取改动文件的联动清单。
 *
 * 优先使用 radius 图引擎；不可达时打 WARN 并回退到 journey_step_links 格子查询。
 *
 * @param {string[]} changedFiles - 改动文件路径列表
 * @returns {Promise<{
 *   source: 'radius' | 'journey_step_links',
 *   cells: Array<{assertion_ref: string|null, na_reason: string|null}>,
 *   radius_result: object|null,
 *   report: object,
 * }>}
 */
export async function getCascadeList(changedFiles) {
  // 优先路径：radius 图引擎
  const radiusResult = await callRadius(changedFiles);

  if (radiusResult !== null) {
    // radius 成功：将 affected_tests 映射为格子格式
    const cells = (radiusResult.affected_tests || []).map(t => ({
      assertion_ref: t,
      na_reason: null,
    }));
    return {
      source: 'radius',
      cells,
      radius_result: radiusResult,
      report: buildCascadeReport(cells),
    };
  }

  // 回退路径：radius 不可达（超时/错误/stale）
  console.warn('[WARN][rerun-gate] radius unavailable or stale — falling back to journey_step_links');
  const cells = await queryCellsFromJourneyStepLinks(changedFiles);
  return {
    source: 'journey_step_links',
    cells,
    radius_result: null,
    report: buildCascadeReport(cells),
  };
}

/**
 * 从格子列表生成 S3 联动清单摘要（thin档，不强制全跑）。
 *
 * @param {Array<{assertion_ref: string|null, na_reason: string|null}>} cells
 * @returns {{ total, runnable_count, nightly_pending_count, unregistered_count, runnable_cells, nightly_pending_cells, report_text }}
 */
export function buildCascadeReport(cells) {
  const runnable = cells.filter(c => isRunnable(c.assertion_ref));
  const nightly_pending = cells.filter(c => c.assertion_ref && !isRunnable(c.assertion_ref));
  const unregistered = cells.filter(c => !c.assertion_ref && !c.na_reason);

  const report_text =
    `本次改动波及 ${cells.length} 个步骤断言，` +
    `可立即跑 ${runnable.length} 个，` +
    `待 nightly 覆盖 ${nightly_pending.length} 个，` +
    `未登记断言 ${unregistered.length} 个`;

  return {
    total: cells.length,
    runnable_count: runnable.length,
    nightly_pending_count: nightly_pending.length,
    unregistered_count: unregistered.length,
    runnable_cells: runnable,
    nightly_pending_cells: nightly_pending,
    report_text,
  };
}
