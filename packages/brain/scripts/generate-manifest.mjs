#!/usr/bin/env node
/**
 * generate-manifest.mjs
 *
 * 静态扫描 Brain 源码，自动生成 brain-manifest.generated.json
 *
 * 扫描来源：
 *   - src/brain-manifest.js          → 模块注册表（块/模块结构）
 *   - src/thalamus.js                → ACTION_WHITELIST（动作列表）
 *   - src/desire/perception.js       → 感知信号名列表
 *   - src/executor.js                → skillMap（技能映射）
 *   - src/task-router.js             → SKILL_WHITELIST
 *
 * 用法：
 *   node packages/brain/scripts/generate-manifest.mjs
 *   node packages/brain/scripts/generate-manifest.mjs --dry-run   # 仅打印，不写文件
 *   node packages/brain/scripts/generate-manifest.mjs --check     # CI 模式：与已提交的 JSON 对比
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = join(__dirname, '../src');
const outputPath = join(srcDir, 'brain-manifest.generated.json');

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const isCheck = args.includes('--check');

// ============================================================
// 1. 从 brain-manifest.js 提取模块结构（动态 import）
// ============================================================
async function loadManifestBase() {
  const { BRAIN_MANIFEST } = await import('../src/brain-manifest.js');
  return BRAIN_MANIFEST;
}

// ============================================================
// 2. 从 thalamus.js 提取 ACTION_WHITELIST
// ============================================================
function extractActions(code) {
  const match = code.match(/const ACTION_WHITELIST\s*=\s*\{([\s\S]*?)\n\};/);
  if (!match) return {};

  const block = match[1];
  const actions = {};

  // 匹配：'action_name': { dangerous: true/false, description: '...' }
  const re = /'([^']+)':\s*\{\s*dangerous:\s*(true|false),\s*description:\s*'([^']+)'/g;
  let m;
  while ((m = re.exec(block)) !== null) {
    actions[m[1]] = {
      dangerous: m[2] === 'true',
      description: m[3],
    };
  }
  return actions;
}

// ============================================================
// 3. 从 desire/perception.js 提取信号名列表
// ============================================================
function extractSignals(code) {
  const signals = new Set();
  const re = /signal:\s*'([^']+)'/g;
  let m;
  while ((m = re.exec(code)) !== null) {
    // 过滤掉注释行中的 signal（//...）
    signals.add(m[1]);
  }
  return Array.from(signals);
}

// ============================================================
// 4. 从 executor.js 提取 skillMap
// ============================================================
function extractSkillMap(code) {
  const match = code.match(/const skillMap\s*=\s*\{([\s\S]*?)\n\s*\};/);
  if (!match) return {};

  const block = match[1];
  const skillMap = {};

  // 匹配：'task_type': '/skill' 或 'task_type': null
  const re = /'([^']+)':\s*(?:'([^']*)'|null)/g;
  let m;
  while ((m = re.exec(block)) !== null) {
    skillMap[m[1]] = m[2] || null;
  }
  return skillMap;
}

// ============================================================
// 5. 从 task-router.js 提取 SKILL_WHITELIST
// ============================================================
function extractSkillWhitelist(code) {
  const match = code.match(/const SKILL_WHITELIST\s*=\s*\{([\s\S]*?)\n\};/);
  if (!match) return {};

  const block = match[1];
  const whitelist = {};

  const re = /'([^']+)':\s*'([^']*)'/g;
  let m;
  while ((m = re.exec(block)) !== null) {
    whitelist[m[1]] = m[2];
  }
  return whitelist;
}

// ============================================================
// 主流程
// ============================================================
async function main() {
  // --- 读取源文件 ---
  const thalamusCode = readFileSync(join(srcDir, 'thalamus.js'), 'utf8');
  const perceptionCode = readFileSync(join(srcDir, 'desire/perception.js'), 'utf8');
  const executorCode = readFileSync(join(srcDir, 'executor.js'), 'utf8');
  const taskRouterCode = readFileSync(join(srcDir, 'task-router.js'), 'utf8');

  // --- 提取数据 ---
  const allActions = extractActions(thalamusCode);
  const allSignals = extractSignals(perceptionCode);
  const allSkills = extractSkillMap(executorCode);
  const skillWhitelist = extractSkillWhitelist(taskRouterCode);

  // --- 加载 manifest 基础结构 ---
  const base = await loadManifestBase();

  // --- 为特定模块注入提取的数据 ---
  const enrichedBlocks = base.blocks.map(block => ({
    ...block,
    modules: block.modules.map(mod => {
      const enriched = { ...mod };

      // thalamus 模块 → 注入所有动作
      if (mod.id === 'thalamus') {
        enriched.actions = Object.entries(allActions).map(([name, cfg]) => ({
          name,
          description: cfg.description,
          dangerous: cfg.dangerous,
        }));
      }

      // perception_signals 模块 → 注入所有信号
      if (mod.id === 'perception_signals') {
        enriched.signals = allSignals.map(name => ({ name }));
      }

      // executor 模块 → 注入技能映射
      if (mod.id === 'executor') {
        enriched.skills = Object.entries(allSkills).map(([taskType, skill]) => ({
          taskType,
          skill,
        }));
      }

      return enriched;
    }),
  }));

  // --- 构建生成结果 ---
  const generated = {
    ...base,
    blocks: enrichedBlocks,
    // 全局提取列表（便于前端展示和 CI 对比）
    allActions,
    allSignals,
    allSkills,
    skillWhitelist,
    // 元信息
    generatedAt: new Date().toISOString(),
    generatedBy: 'packages/brain/scripts/generate-manifest.mjs',
    sourceFiles: [
      'src/brain-manifest.js',
      'src/thalamus.js',
      'src/desire/perception.js',
      'src/executor.js',
      'src/task-router.js',
    ],
  };

  const output = JSON.stringify(generated, null, 2);

  // --- dry-run 模式：只打印统计 ---
  if (isDryRun) {
    console.log('✅ generate-manifest --dry-run');
    console.log(`   actions: ${Object.keys(allActions).length}`);
    console.log(`   signals: ${allSignals.length}`);
    console.log(`   skills:  ${Object.keys(allSkills).length}`);
    console.log(`   skill_whitelist: ${Object.keys(skillWhitelist).length}`);
    console.log(`   blocks:  ${generated.blocks.length}`);
    console.log(`   output size: ${output.length} bytes`);
    process.exit(0);
  }

  // --- check 模式（CI 用）：与已提交的 JSON 对比 ---
  if (isCheck) {
    if (!existsSync(outputPath)) {
      console.error('❌ brain-manifest.generated.json 不存在，请先运行 generate-manifest.mjs 生成');
      process.exit(1);
    }

    const committed = readFileSync(outputPath, 'utf8');

    // 对比时忽略 generatedAt（每次生成时间不同）
    const normalize = (json) => {
      const obj = JSON.parse(json);
      delete obj.generatedAt;
      return JSON.stringify(obj, null, 2);
    };

    if (normalize(output) !== normalize(committed)) {
      console.error('❌ brain-manifest.generated.json 已过期，请运行 generate-manifest.mjs 更新后提交');
      console.error('   运行：node packages/brain/scripts/generate-manifest.mjs');
      process.exit(1);
    }

    console.log('✅ brain-manifest.generated.json 与源码同步');
    process.exit(0);
  }

  // --- 写入文件 ---
  writeFileSync(outputPath, output, 'utf8');
  console.log(`✅ brain-manifest.generated.json 已生成`);
  console.log(`   actions: ${Object.keys(allActions).length}`);
  console.log(`   signals: ${allSignals.length}`);
  console.log(`   skills:  ${Object.keys(allSkills).length}`);
  console.log(`   输出: ${outputPath}`);
}

main().catch(err => {
  console.error('❌ generate-manifest 失败:', err.message);
  process.exit(1);
});
