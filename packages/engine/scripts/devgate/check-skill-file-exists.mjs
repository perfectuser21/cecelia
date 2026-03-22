#!/usr/bin/env node
/**
 * Fitness Function: Skill 文件存在性检查（hard check — 仅新增条目）
 *
 * 检查 executor.js skillMap 中 PR 新增的 task_type 条目，
 * 验证对应的 packages/workflows/skills/<skill-name>/SKILL.md 是否存在。
 *
 * 只检查新增条目（diff-based），已有条目豁免，不破坏现状。
 * 若发现新增条目缺少对应 SKILL.md → exit 1，阻断 CI。
 *
 * 用法：
 *   node packages/engine/scripts/devgate/check-skill-file-exists.mjs
 *
 * 返回码：
 *   0 - 无新增条目，或新增条目均有对应 SKILL.md
 *   1 - 存在新增条目但缺少对应 SKILL.md
 */

import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../../..');

// ─── 颜色输出 ──────────────────────────────────────────────────────────────────
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

// ─── 从 git diff 提取新增的 skillMap 条目 ────────────────────────────────────
function getNewlyAddedSkillEntries() {
  let diffOutput = '';
  try {
    // PR 模式：diff against origin/main
    diffOutput = execSync(
      'git diff origin/main -- packages/brain/src/executor.js',
      { encoding: 'utf-8', cwd: ROOT }
    );
  } catch {
    try {
      // fallback：diff against main
      diffOutput = execSync(
        'git diff main -- packages/brain/src/executor.js',
        { encoding: 'utf-8', cwd: ROOT }
      );
    } catch {
      console.log(`  ${YELLOW}ℹ️  无法获取 git diff，跳过检查${RESET}`);
      return new Map();
    }
  }

  if (!diffOutput.trim()) {
    return new Map();
  }

  const newEntries = new Map(); // taskType → skillPath
  const lines = diffOutput.split('\n');

  // 只处理新增行（+ 开头，不是 +++）
  for (const line of lines) {
    if (!line.startsWith('+') || line.startsWith('+++')) continue;

    // 匹配 skillMap 条目格式：'task_type': '/skill-path' 或 null
    const match = line.match(/^\+\s*'([a-z_-]+)'\s*:\s*('(\/[^']+)'|null)/);
    if (!match) continue;

    const taskType = match[1];
    const rawSkill = match[3] || null; // null 表示纯代码执行

    if (rawSkill === null) continue; // skill=null 不需要 SKILL.md

    // 取第一个词（去掉参数，如 '/review init' → '/review'）
    const skillPath = rawSkill.split(' ')[0];
    newEntries.set(taskType, skillPath);
  }

  return newEntries;
}

// ─── 从 skill path 提取 skill 名称 ───────────────────────────────────────────
function extractSkillName(skillPath) {
  // '/dev' → 'dev', '/code-review' → 'code-review'
  return skillPath.startsWith('/') ? skillPath.slice(1) : skillPath;
}

// ─── 主逻辑 ──────────────────────────────────────────────────────────────────
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('  Fitness Check: Skill 文件存在性（新增条目硬检查）');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

const newEntries = getNewlyAddedSkillEntries();

if (newEntries.size === 0) {
  console.log(`  ${GREEN}✅ executor.js skillMap 无新增条目，无需检查${RESET}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  process.exit(0);
}

console.log(`  新增条目: ${newEntries.size} 个`);
console.log('');

const errors = [];

for (const [taskType, skillPath] of newEntries) {
  const skillName = extractSkillName(skillPath);
  const skillMdPath = join(ROOT, 'packages/workflows/skills', skillName, 'SKILL.md');
  const relPath = `packages/workflows/skills/${skillName}/SKILL.md`;

  if (existsSync(skillMdPath)) {
    console.log(`  ${GREEN}✅ ${taskType}: ${skillPath} → ${relPath} 已存在${RESET}`);
  } else {
    console.log(`  ${RED}❌ ${taskType}: ${skillPath} → ${relPath} 不存在${RESET}`);
    errors.push({ taskType, skillPath, relPath });
  }
}

console.log('');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

if (errors.length > 0) {
  console.log(`  ${RED}❌ 检查失败: ${errors.length} 个新增 task_type 缺少对应 SKILL.md${RESET}`);
  console.log('');
  console.log('  必须在合并前创建以下文件：');
  for (const { relPath } of errors) {
    console.log(`    - ${relPath}`);
  }
  console.log('');
  console.log('  参考：运行 /brain-register 获取 Skill 注册向导');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  process.exit(1);
}

console.log(`  ${GREEN}✅ 所有新增条目均有对应 SKILL.md${RESET}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
process.exit(0);
