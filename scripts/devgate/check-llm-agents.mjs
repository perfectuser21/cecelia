#!/usr/bin/env node
/**
 * Fitness Function: LLM Agent 一致性检查
 *
 * 扫描 packages/brain/src/ 中所有 callLLM('xxx', ...) 调用，
 * 对比 model-registry.js 中注册的 AGENTS。
 * 发现未注册 agent → exit 1（CI 硬失败）。
 *
 * 为什么重要：每次新加 callLLM('new_agent', ...) 但忘记更新 model-registry，
 * 前端 LM配置 页面就会看不到这个 agent，用户无法配置模型。
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const SRC_DIR = join(ROOT, 'packages/brain/src');

// ─── 已知例外（有合理原因不在 model-registry 的 agentId）─────────────────────
// autumnrice: routes.js 的 /autumnrice/chat 已在本次 PR 改为 callLLM('mouth')
// 如需新增例外，在此注释说明原因，不要静默忽略
const EXCEPTIONS = new Set([]);

// ─── 扫描所有 .js 文件 ────────────────────────────────────────────────────────
function walkJs(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules') continue;
      walkJs(full, files);
    } else if (entry.endsWith('.js') && entry !== 'llm-caller.js') {
      files.push(full);
    }
  }
  return files;
}

// ─── 提取 callLLM('agentId') ─────────────────────────────────────────────────
function extractCallLLMAgents(files) {
  const found = new Map(); // agentId → [file, ...]
  const pattern = /callLLM(?:Fn|Stream)?\s*\(\s*['"]([a-z_]+)['"]/g;
  for (const file of files) {
    const content = readFileSync(file, 'utf-8');
    let m;
    while ((m = pattern.exec(content)) !== null) {
      const agentId = m[1];
      if (!found.has(agentId)) found.set(agentId, []);
      const rel = file.replace(ROOT + '/', '');
      if (!found.get(agentId).includes(rel)) found.get(agentId).push(rel);
    }
  }
  return found;
}

// ─── 读取 model-registry 中注册的 AGENTS ─────────────────────────────────────
function getRegisteredAgents() {
  const registryPath = join(SRC_DIR, 'model-registry.js');
  const content = readFileSync(registryPath, 'utf-8');
  const ids = new Set();
  const pattern = /id:\s*'([a-z_]+)'/g;
  let m;
  while ((m = pattern.exec(content)) !== null) {
    ids.add(m[1]);
  }
  return ids;
}

// ─── 主逻辑 ──────────────────────────────────────────────────────────────────
const files = walkJs(SRC_DIR);
const usedAgents = extractCallLLMAgents(files);
const registeredAgents = getRegisteredAgents();

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('  Fitness Check: LLM Agent 一致性');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`  扫描文件数: ${files.length}`);
console.log(`  发现 agentId: ${[...usedAgents.keys()].join(', ')}`);
console.log(`  已注册 agent: ${[...registeredAgents].join(', ')}`);
console.log('');

const missing = [];
for (const [agentId, usedIn] of usedAgents) {
  if (EXCEPTIONS.has(agentId)) {
    console.log(`  ⚠️  ${agentId}: 例外（已豁免，见 EXCEPTIONS 注释）`);
    continue;
  }
  if (!registeredAgents.has(agentId)) {
    missing.push({ agentId, usedIn });
  } else {
    console.log(`  ✅ ${agentId}: 已注册`);
  }
}

if (missing.length > 0) {
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  ❌ 发现未注册 LLM agent（CI 失败）');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  for (const { agentId, usedIn } of missing) {
    console.log(`  ❌ callLLM('${agentId}', ...) 未在 model-registry.js 注册`);
    console.log(`     使用位置: ${usedIn.join(', ')}`);
    console.log('');
    console.log(`  修复：在 packages/brain/src/model-registry.js AGENTS[] 添加：`);
    console.log(`  {`);
    console.log(`    id: '${agentId}',`);
    console.log(`    name: '显示名称',           // ← 在前端 LM配置 页面显示`);
    console.log(`    description: '职责描述',     // ← 一句话说明这个 agent 做什么`);
    console.log(`    layer: 'brain',              // ← 大脑内部用 'brain'，派发任务用 'executor'`);
    console.log(`    allowed_models: ['claude-haiku-4-5-20251001', 'claude-sonnet-4-6'],`);
    console.log(`    recommended_model: 'claude-haiku-4-5-20251001', // ← 快速任务用 Haiku`);
    console.log(`    fixed_provider: null,`);
    console.log(`  },`);
    console.log('');
  }
  process.exit(1);
}

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('  ✅ LLM Agent 一致性检查通过');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
