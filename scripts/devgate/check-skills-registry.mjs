#!/usr/bin/env node
/**
 * Fitness Function: Skill 注册一致性检查（软警告）
 *
 * 读取 executor.js skillMap 中用到的 skill 路径（如 /dev、/decomp），
 * 对比 brain-manifest.generated.json 中的 allSkills。
 * 有 skill 路径但未出现在 manifest → 输出警告（不阻断 CI）。
 *
 * 为什么是软警告：skill 未在 manifest 注册不影响运行，
 * 但 Brain 的 manifest API 和相关 UI 会看不到该 skill。
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');

// ─── 解析 executor.js skillMap 中使用的 skill 路径 ───────────────────────────
function getSkillPaths() {
  const content = readFileSync(join(ROOT, 'packages/brain/src/executor.js'), 'utf-8');
  const skillMapMatch = content.match(/const skillMap\s*=\s*\{([\s\S]*?)\};/);
  if (!skillMapMatch) return new Set();

  const block = skillMapMatch[1];
  const paths = new Set();
  const pattern = /:\s*'(\/[^']+)'/g;
  let m;
  while ((m = pattern.exec(block)) !== null) {
    // 取第一个词（/dev、/decomp、/decomp-check、/code-review 等）
    const skillPath = m[1].split(' ')[0];
    paths.add(skillPath);
  }
  return paths;
}

// ─── 读取 brain-manifest.generated.json 中的 allSkills ───────────────────────
function getManifestSkills() {
  const manifestPath = join(ROOT, 'packages/brain/src/brain-manifest.generated.json');
  if (!existsSync(manifestPath)) {
    console.log('  ℹ️  brain-manifest.generated.json 不存在，跳过检查');
    return null;
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  const skills = new Set();
  const allSkills = manifest.allSkills || {};
  // allSkills 格式: { taskType: skillPath } 如 { dev: '/dev', review: '/code-review' }
  for (const skillPath of Object.values(allSkills)) {
    if (skillPath) {
      const normalized = skillPath.split(' ')[0]; // 取第一个词（去掉参数如 /review init）
      if (normalized) skills.add(normalized.startsWith('/') ? normalized : `/${normalized}`);
    }
  }
  return skills;
}

// ─── 主逻辑 ──────────────────────────────────────────────────────────────────
const skillPaths = getSkillPaths();
const manifestSkills = getManifestSkills();

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('  Fitness Check: Skill 注册一致性（软警告）');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`  executor skillMap 中的 skill 路径: ${[...skillPaths].join(', ')}`);

if (manifestSkills === null) {
  console.log('  ⏭️  跳过（manifest 文件不存在）');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  process.exit(0);
}

console.log(`  manifest 中的 skills: ${manifestSkills.size > 0 ? [...manifestSkills].join(', ') : '（空）'}`);
console.log('');

const warnings = [];
for (const skillPath of skillPaths) {
  if (manifestSkills.has(skillPath)) {
    console.log(`  ✅ ${skillPath}: 已在 manifest 注册`);
  } else {
    warnings.push(skillPath);
    console.log(`  ⚠️  ${skillPath}: 未在 manifest 注册`);
  }
}

console.log('');
if (warnings.length > 0) {
  console.log('  建议：运行 node packages/brain/scripts/generate-manifest.mjs 重新生成 manifest，');
  console.log('  或在 manifest 的 allSkills 中补充以下 skill:');
  for (const p of warnings) console.log(`     - ${p}`);
  console.log('');
  console.log('  （软警告：CI 不会因此失败）');
}

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`  ${warnings.length === 0 ? '✅' : '⚠️ '} Skill 注册检查完成（警告: ${warnings.length}）`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
process.exit(0);
