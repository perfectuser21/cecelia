#!/usr/bin/env node
/**
 * Fitness Function: Executor Agent 一致性检查（软警告）
 *
 * 扫描 executor.js 中的 skillMap 键（任务类型），
 * 对比 model-registry.js 的 executor layer AGENTS。
 * 有 skill 路径但未在 model-registry 注册 → 输出警告（不阻断 CI）。
 *
 * 为什么是软警告：executor task type 没有在 model-registry 注册，
 * 不影响运行，但前端 LM配置 的执行层 tab 看不到该类型，
 * 无法通过 UI 调整其模型。
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');

// ─── 解析 executor.js skillMap ────────────────────────────────────────────────
function getSkillMapKeys() {
  const content = readFileSync(join(ROOT, 'packages/brain/src/executor.js'), 'utf-8');
  const skillMapMatch = content.match(/const skillMap\s*=\s*\{([\s\S]*?)\};/);
  if (!skillMapMatch) return new Map();

  const block = skillMapMatch[1];
  const keys = new Map(); // taskType → skill path or null
  const linePattern = /^\s*'([a-z_]+)'\s*:\s*(null|'[^']*')/gm;
  let m;
  while ((m = linePattern.exec(block)) !== null) {
    const taskType = m[1];
    const skill = m[2] === 'null' ? null : m[2].replace(/'/g, '');
    keys.set(taskType, skill);
  }
  return keys;
}

// ─── 读取 model-registry executor layer agents ────────────────────────────────
function getExecutorAgents() {
  const content = readFileSync(join(ROOT, 'packages/brain/src/model-registry.js'), 'utf-8');
  const ids = new Set();
  // Find executor layer entries
  const executorSection = content.match(/\/\/ ---- 执行层 ----([\s\S]*?)(?:\/\/.*?---|$)/);
  if (executorSection) {
    const pattern = /id:\s*'([a-z_]+)'/g;
    let m;
    while ((m = pattern.exec(executorSection[1])) !== null) {
      ids.add(m[1]);
    }
  }
  // Fallback: get all agents and filter by layer
  if (ids.size === 0) {
    const pattern = /id:\s*'([a-z_]+)'/g;
    let m;
    while ((m = pattern.exec(content)) !== null) {
      ids.add(m[1]);
    }
  }
  return ids;
}

// ─── 主逻辑 ──────────────────────────────────────────────────────────────────
const skillMap = getSkillMapKeys();
const executorAgents = getExecutorAgents();

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('  Fitness Check: Executor Agent 一致性（软警告）');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

const warnings = [];
for (const [taskType, skill] of skillMap) {
  if (skill === null) {
    console.log(`  ⏭️  ${taskType}: skill=null，跳过（已禁用）`);
    continue;
  }
  if (executorAgents.has(taskType)) {
    console.log(`  ✅ ${taskType}: 已注册（skill: ${skill}）`);
  } else {
    warnings.push({ taskType, skill });
  }
}

if (warnings.length > 0) {
  console.log('');
  console.log('  ⚠️  以下 executor 任务类型有 skill 但未在 model-registry 注册：');
  for (const { taskType, skill } of warnings) {
    console.log(`     - '${taskType}' → ${skill}（前端无法配置模型）`);
  }
  console.log('');
  console.log('  建议：在 model-registry.js executor layer 补充对应条目。');
  console.log('  （软警告：CI 不会因此失败，但前端 LM配置 看不到这些类型）');
} else {
  console.log('');
}

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`  ${warnings.length === 0 ? '✅' : '⚠️ '} Executor Agent 检查完成（警告: ${warnings.length}）`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
// 软警告：始终 exit 0
process.exit(0);
