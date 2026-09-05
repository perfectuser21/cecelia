#!/usr/bin/env node
/**
 * 回放最近 30 个真实任务 → 分格完备准确率报告
 *
 * 口径（见 contract-draft.md Step 5）：当前无外部人工标注 ground truth，
 * 「分格准确率」= 分格完备准确率 = 命中且仅命中一格的任务数 / 总任务数，
 * 直接验证 PRD 边界「四格互斥完备」不变量于真实数据上。
 *
 * artifact_kind 用规则判定（无 LLM，确定）；answer_known 用任务 payload 已持久化值，
 * 缺失时用确定性兜底（false）——回放为确定性、可复跑，不为 30 任务各烧一次 LLM。
 *
 * 输出：JSON 到 stdout（{ total, per_lane, hit_exactly_one_lane, completeness_rate }）。
 */
import pool from '../../packages/brain/src/db.js';
import { classifyArtifactKind, routeFourQuadrant } from '../../packages/brain/src/task-router.js';

const VALID_LANES = ['dev', 'prototype_dev', 'canvas_skill', 'skill_explore'];

async function main() {
  const { rows } = await pool.query(
    `SELECT id, title, description, task_type, payload
       FROM tasks
      WHERE title NOT ILIKE '%smoke%'
      ORDER BY created_at DESC
      LIMIT 30`,
  );

  const per_lane = { dev: 0, prototype_dev: 0, canvas_skill: 0, skill_explore: 0 };
  let hitExactlyOne = 0;

  for (const t of rows) {
    const artifact_kind = classifyArtifactKind({
      task_type: t.task_type,
      change_kind: t.payload?.change_kind,
      title: t.title,
      description: t.description,
    });
    const answer_known = typeof t.payload?.answer_known === 'boolean'
      ? t.payload.answer_known
      : false; // 确定性兜底（回放无 LLM）
    const lane = routeFourQuadrant(artifact_kind, answer_known);
    // 命中且仅命中一格：lane 必为合法枚举之一（routeFourQuadrant 全函数保证唯一）
    if (VALID_LANES.includes(lane)) {
      per_lane[lane] += 1;
      hitExactlyOne += 1;
    }
  }

  const total = rows.length;
  const report = {
    total,
    per_lane,
    hit_exactly_one_lane: hitExactlyOne,
    completeness_rate: total === 0 ? 0 : hitExactlyOne / total,
    generated_at: new Date().toISOString(),
    metric: 'partition_completeness (命中且仅命中一格 / 总数)',
  };
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  await pool.end();
}

main().catch((err) => {
  console.error('replay failed:', err.message);
  process.exit(1);
});
