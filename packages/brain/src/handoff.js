/**
 * handoff.js — 任务终态交接单（诊断方案 B，2026-07-02）
 *
 * 任务终态自动产一份"给下一个大脑读"的结构化交接单：
 *   - DB SSOT：tasks.result.handoff（JSONB 覆盖写，天然幂等）
 *   - 人读镜像：<HANDOFF_DOCS_DIR>/<yyyymmddHHMM>-<task8>.md（best-effort，不 git commit）
 * 下一次规划（runPlannerNode）按 journey 拉最近 N 份注入 prompt。
 *
 * 与既有件分工：A3 promote-regression 沉淀"行为"（golden_path/回归契约）、
 * harness-report 是给人看的报告；handoff 沉淀"进度与意图"。
 * Spec: docs/superpowers/specs/2026-07-02-handoff-automation-design.md
 */
import fs from 'node:fs';
import path from 'node:path';

export const HANDOFF_SCHEMA_VERSION = 1;

const DEFAULT_DOCS_DIR = '/Users/administrator/perfect21/cecelia/docs/handoffs';
const MAX_ITEMS = 20;
const MAX_ITEM_LEN = 200;
const PROMPT_MAX_LEN = 2000;

// data_sources 固定基线：与 harness-planner Step 0.3/0.4 同源（A1）。
// 下一个大脑照单加载即可拿到本 line 的铁律 + 已验收行为 + 本单全文。
export const BASELINE_DATA_SOURCES = [
  'GET /api/brain/invariants?level=area',
  'GET /api/brain/invariants?target_type=journey_feature&target_id=<ability_id>',
  'GET /api/brain/journeys/<journey_id>/golden-paths',
  'GET /api/brain/tasks/<task_id>（result.handoff 本体）',
];

function clampList(list) {
  return (Array.isArray(list) ? list : [])
    .filter((x) => typeof x === 'string' && x.trim())
    .slice(0, MAX_ITEMS)
    .map((s) => (s.length > MAX_ITEM_LEN ? `${s.slice(0, MAX_ITEM_LEN)}…` : s));
}

export function buildHandoff(input = {}) {
  if (!input.task_id) throw new Error('buildHandoff: task_id is required');
  return {
    schema_version: HANDOFF_SCHEMA_VERSION,
    task_id: input.task_id,
    initiative_id: input.initiative_id ?? null,
    journey_id: input.journey_id ?? null,
    title: input.title || '',
    verdict: input.verdict ?? null,
    done: clampList(input.done),
    not_done: clampList(input.not_done),
    next_steps: clampList(input.next_steps),
    data_sources: clampList(input.data_sources?.length ? input.data_sources : BASELINE_DATA_SOURCES),
    decision_refs: clampList(input.decision_refs),
    artifacts: {
      pr_urls: clampList(input.artifacts?.pr_urls),
      sprint_dir: input.artifacts?.sprint_dir ?? null,
      branch: input.artifacts?.branch ?? null,
      docs: clampList(input.artifacts?.docs),
    },
    created_at: new Date().toISOString(),
  };
}

export function renderHandoffMarkdown(h) {
  const list = (arr, empty) => (arr.length ? arr.map((x) => `- ${x}`).join('\n') : `- （${empty}）`);
  return [
    `# Handoff：${h.title || h.task_id}`,
    '',
    `- task_id: ${h.task_id}`,
    `- initiative_id: ${h.initiative_id ?? 'N/A'}`,
    `- journey_id: ${h.journey_id ?? 'N/A'}`,
    `- verdict: ${h.verdict ?? 'N/A'}`,
    `- created_at: ${h.created_at}`,
    '',
    '## 完成了什么',
    list(h.done, '无'),
    '',
    '## 没完成什么',
    list(h.not_done, '无'),
    '',
    '## 下一步建议',
    list(h.next_steps, '无'),
    '',
    '## 数据源（下一个大脑要加载的）',
    list(h.data_sources, '无'),
    '',
    '## 关键决策引用',
    list(h.decision_refs, '无'),
    '',
    '## 产物指针',
    list(h.artifacts.pr_urls, '无 PR'),
    `- sprint_dir: ${h.artifacts.sprint_dir ?? 'N/A'}`,
    `- branch: ${h.artifacts.branch ?? 'N/A'}`,
    ...(h.artifacts.docs.length ? h.artifacts.docs.map((d) => `- doc: ${d}`) : []),
    '',
  ].join('\n');
}
