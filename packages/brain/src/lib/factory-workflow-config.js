/**
 * 技能工厂 workflow 配置（任务 a5f42455 / 2231ecc0，决策 cc008b7e）。
 * 来源 config/factory-workflows.json，按 workflows.key 取并与 defaults 合并；没登记的 workflow 返回 null（推进器据此标 resource 卡点，不猜）。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const CONFIG_PATH = fileURLToPath(new URL('../../config/factory-workflows.json', import.meta.url));
let cached = null;

export function loadFactoryConfig(path = CONFIG_PATH) {
  if (path === CONFIG_PATH && cached) return cached;
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  const out = { defaults: raw.defaults || {}, workflows: raw.workflows || {} };
  if (path === CONFIG_PATH) cached = out;
  return out;
}

/** 取一条 workflow 的合并配置；未登记返回 null。dev / stage_skills / anchor 浅合并。 */
export function resolveWorkflowConfig(workflowKey, config = loadFactoryConfig()) {
  const wf = config.workflows?.[workflowKey];
  if (!wf) return null;
  const d = config.defaults || {};
  return {
    ...d,
    ...wf,
    workflow_key: workflowKey,
    stage_skills: { ...(d.stage_skills || {}), ...(wf.stage_skills || {}) },
    dev: { ...(d.dev || {}), ...(wf.dev || {}) },
    anchor: wf.anchor || d.anchor || null,
  };
}
