/**
 * harness-promote-regression.js — A3 冻结登记（harness 验证模型重构）。
 *
 * evaluator PASS 后把判官的一次性判断固化成常驻卡片：
 *   ① golden_path 表覆盖写（结构化事实：这条路径已被验收）
 *   ② regression-contract.yaml 追加 golden_paths 条目（读卡机卡片，B1 无条件复跑）
 *   ③ commit 校验拒假卡（引用物必须已被 git 跟踪）
 *
 * yaml schema 对齐 B1 消费方 scripts/ci/run-core-regression.sh（yq 读
 * golden_paths[].id/.trigger[]/.test_command）——不是 A3 方案文档里的 checks[] 数组。
 * yaml 上 main 走本模块自开的 auto-merge PR（reportNode 时 sub-task PR 已全 merge，
 * 没有别的顺风车）。
 *
 * Spec: docs/superpowers/specs/2026-07-02-a3-promote-regression-design.md
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile as nodeExecFile } from 'node:child_process';
import { promisify } from 'node:util';
import yaml from 'js-yaml';
import pool from './db.js';

const defaultExecFile = promisify(nodeExecFile);

// yaml dump 会丢注释头 → 抽成常量重贴（保持与现存文件头一致）
export const CONTRACT_HEADER = `# ============================================================================
# Regression Contract - cecelia-core
# ============================================================================
# 全量回归的唯一合法定义来源
#
# Trigger 规则：
#   - PR:      跑 trigger 包含 PR 的条目
#   - Release: 跑 trigger 包含 Release 的条目
# ============================================================================

`;

/**
 * 解析 contract-dod.md 的 [BEHAVIOR] 条目。
 * 格式：`- [ ] [BEHAVIOR] <desc>` 下一行（允许隔缩进）`Test: manual:<cmd>`。
 * 没有 manual: 命令的条目跳过（不产半卡）。
 * @returns {Array<{desc: string, cmd: string}>}
 */
export function parseBehaviorEntries(text) {
  const out = [];
  const lines = String(text || '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*-\s*\[[ x]\]\s*\[BEHAVIOR\]\s*(.+)$/);
    if (!m) continue;
    const desc = m[1].trim();
    // 向下找最近的 Test: manual: 行（下一个 BEHAVIOR 条目前）
    for (let j = i + 1; j < lines.length; j++) {
      if (/^\s*-\s*\[[ x]\]\s*\[BEHAVIOR\]/.test(lines[j])) break;
      const t = lines[j].match(/^\s*Test:\s*manual:(.+)$/);
      if (t) {
        out.push({ desc, cmd: t[1].trim() });
        break;
      }
    }
  }
  return out;
}

/**
 * 解析 sprint-prd.md 的 ## Golden Path 段编号列表。
 * 格式（harness-planner SKILL 模板，已验证 3 个现存样本一致）：
 *   ## Golden Path（核心场景）
 *   ...
 *   1. <步骤>
 * @returns {Array<{order_no: number, note: string}>}
 */
export function parseGoldenPathSteps(text) {
  const src = String(text || '');
  const sec = src.match(/^##\s*Golden Path[^\n]*\n([\s\S]*?)(?=^##\s|\n*$(?![\s\S]))/m);
  if (!sec) return [];
  const out = [];
  for (const line of sec[1].split('\n')) {
    const m = line.match(/^\s*(\d+)[.、)]\s*(.+)$/);
    if (m) out.push({ order_no: parseInt(m[1], 10), note: m[2].trim() });
  }
  return out;
}

/**
 * 把 [BEHAVIOR] 条目构建成 regression-contract.yaml golden_paths 条目。
 * schema 对齐 run-core-regression.sh：id/trigger/test_command 是消费字段，
 * owner_task_id/journey_id/source 是溯源附加（yq 按需取，多余无害）。
 */
export function buildGoldenPathEntries({ taskId, journeyId, behaviors, prUrl, sprintDir, now }) {
  const prefix = `GP-${String(taskId).slice(0, 8)}-`;
  return (behaviors || []).map((b, i) => ({
    id: `${prefix}${String(i + 1).padStart(3, '0')}`,
    name: b.desc,
    priority: 'P0',
    trigger: ['PR', 'Release'],
    method: 'auto',
    test_command: b.cmd,
    owner_task_id: taskId,
    journey_id: journeyId || null,
    source: { pr_url: prUrl || null, sprint_dir: sprintDir, frozen_at: now },
  }));
}

/**
 * 幂等合并：滤掉同 task 前缀的旧条目再追加 fresh（同 ability 二次 PASS 覆盖不叠加）。
 */
export function mergeGoldenPaths(existing, fresh, taskPrefix) {
  const kept = (existing || []).filter((g) => !String(g?.id || '').startsWith(taskPrefix));
  return [...kept, ...fresh];
}

export default { parseBehaviorEntries, parseGoldenPathSteps, buildGoldenPathEntries, mergeGoldenPaths };
