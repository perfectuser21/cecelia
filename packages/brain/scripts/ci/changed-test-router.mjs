#!/usr/bin/env node
/**
 * changed-test-router.mjs
 *
 * 给定一组变更文件路径（--files），输出需要补跑的 fs 依赖型测试文件。
 * 解决问题：vitest --changed 只感知 .test.ts 文件本身的变更，
 * 当 SKILL.md 被改但 .test.ts 未改时，--changed 看不到 → latent 红漏测。
 *
 * 机制：扫描 packages/engine/tests/skills/*.test.ts 中的 readFileSync 路径，
 * 建立 skill 文件 → 测试文件映射，再结合命名约定补全。
 *
 * 用法：node changed-test-router.mjs --files path/to/SKILL.md[,path2,...]
 *   非 skill 路径 → 输出空行（退出码 0）
 *   skill 路径  → 输出对应测试文件路径（换行分隔）
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
// 路径：packages/brain/scripts/ci/ → 4 层 → repo root
const REPO_ROOT = resolve(__dirname, '../../../..');
const SKILLS_TEST_DIR = join(REPO_ROOT, 'packages/engine/tests/skills');

// Parse --files argument（支持逗号分隔多文件）
const filesIdx = process.argv.indexOf('--files');
if (filesIdx === -1 || !process.argv[filesIdx + 1]) {
  process.exit(0);
}
const inputFiles = process.argv[filesIdx + 1]
  .split(',')
  .map(f => f.trim())
  .filter(Boolean);

/**
 * 扫描所有 .test.ts 文件中的 readFileSync 调用，
 * 提取 ~/.claude/skills/<skill>/SKILL.md 路径，
 * 建立 skillName → Set<testFilePath> 映射。
 * 同时用命名约定（harness-evaluator.test.ts → harness-evaluator）补全。
 */
function buildSkillToTestMap() {
  const map = new Map();
  if (!existsSync(SKILLS_TEST_DIR)) return map;

  const testFiles = readdirSync(SKILLS_TEST_DIR).filter(f => f.endsWith('.test.ts'));

  for (const testFile of testFiles) {
    const filePath = join(SKILLS_TEST_DIR, testFile);
    const content = readFileSync(filePath, 'utf8');

    // 命名约定：harness-evaluator.test.ts → skill name = harness-evaluator
    const conventionSkillName = testFile.replace('.test.ts', '');
    if (!map.has(conventionSkillName)) map.set(conventionSkillName, new Set());
    map.get(conventionSkillName).add(filePath);

    // readFileSync 扫描：匹配 ~/.claude/skills/<skill>/SKILL.md 模式
    const skillRefPattern = /['"](?:[^'"]*[\\/])?\.claude[\\/]skills[\\/]([^'"\/\\]+)[\\/]SKILL\.md['"]/g;
    let match;
    while ((match = skillRefPattern.exec(content)) !== null) {
      const skillName = match[1];
      if (!map.has(skillName)) map.set(skillName, new Set());
      map.get(skillName).add(filePath);
    }

    // 也匹配 packages/workflows/skills/<skill>/SKILL.md（repo 内引用）
    const repoSkillPattern = /['"](?:[^'"]*[\\/])?packages[\\/]workflows[\\/]skills[\\/]([^'"\/\\]+)[\\/]SKILL\.md['"]/g;
    while ((match = repoSkillPattern.exec(content)) !== null) {
      const skillName = match[1];
      if (!map.has(skillName)) map.set(skillName, new Set());
      map.get(skillName).add(filePath);
    }
  }

  return map;
}

const skillToTests = buildSkillToTestMap();
const results = new Set();

for (const inputFile of inputFiles) {
  // 仅处理 packages/workflows/skills/<skill>/SKILL.md 格式
  const skillMatch = inputFile.match(/packages[\\/]workflows[\\/]skills[\\/]([^\/\\]+)[\\/]SKILL\.md/);
  if (!skillMatch) continue; // 非 skill 路径 → 忽略

  const skillName = skillMatch[1];
  const tests = skillToTests.get(skillName);
  if (tests) {
    for (const t of tests) results.add(t);
  }
}

if (results.size > 0) {
  process.stdout.write(Array.from(results).join('\n') + '\n');
}
