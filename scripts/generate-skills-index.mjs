#!/usr/bin/env node
/**
 * generate-skills-index.mjs
 *
 * 扫描 packages/workflows/skills/ 目录，自动更新 .agent-knowledge/skills-index.md
 *
 * 策略：
 *   1. 读取现有 skills-index.md，提取已分类的 Skills（保持分类不变）
 *   2. 扫描 packages/workflows/skills/ 发现所有 Skills（读取 SKILL.md frontmatter）
 *   3. 新增 Skills（不在现有索引中的）追加到 "新增 Skills" 区块
 *   4. 更新 Skills 总数
 *   5. 写回文件（或 --dry-run 时只打印）
 *
 * 用法：
 *   node scripts/generate-skills-index.mjs           # 更新文件
 *   node scripts/generate-skills-index.mjs --dry-run # 只打印，不写文件
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');
const SKILLS_DIR = join(PROJECT_ROOT, 'packages/workflows/skills');
const INDEX_FILE = join(PROJECT_ROOT, '.agent-knowledge/skills-index.md');

const DRY_RUN = process.argv.includes('--dry-run');

// ─── 1. 读取现有 skills-index.md ───────────────────────────────────────────

function readExistingIndex() {
  if (!existsSync(INDEX_FILE)) return { content: '', knownSkills: new Set() };

  const content = readFileSync(INDEX_FILE, 'utf-8');
  const knownSkills = new Set();

  // 提取所有已索引的 skill 名称（形如 `| `/xxx` | ... |`）
  const skillRowRegex = /^\|\s*`\/([^`]+)`/gm;
  let m;
  while ((m = skillRowRegex.exec(content)) !== null) {
    knownSkills.add(m[1]);
  }

  return { content, knownSkills };
}

// ─── 2. 扫描 packages/workflows/skills/ ────────────────────────────────────

function parseFrontmatter(skillMdPath) {
  try {
    const content = readFileSync(skillMdPath, 'utf-8');
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) return null;

    const fm = fmMatch[1];
    const nameMatch = fm.match(/^name:\s*(.+)$/m);
    const descMatch = fm.match(/^description:\s*\|?\s*\n?((?:[ \t]+.+\n?)+)/m);
    const singleDescMatch = fm.match(/^description:\s*"?([^"\n]+)"?$/m);

    const name = nameMatch ? nameMatch[1].trim() : null;

    let description = '';
    if (descMatch) {
      // Multi-line description - take first non-empty line
      description = descMatch[1]
        .split('\n')
        .map(l => l.trim())
        .filter(Boolean)[0] || '';
    } else if (singleDescMatch) {
      description = singleDescMatch[1].trim();
    } else {
      // Try to get first line after frontmatter as description
      const bodyMatch = content.match(/^---\n[\s\S]*?---\n+(.+)/m);
      if (bodyMatch) {
        description = bodyMatch[1].replace(/^[>#*`\s]+/, '').trim().substring(0, 80);
      }
    }

    return { name: name || null, description: description.substring(0, 100) };
  } catch {
    return null;
  }
}

function scanSkillsDir() {
  const skills = [];

  try {
    const entries = readdirSync(SKILLS_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skillName = entry.name;
      const skillMdPath = join(SKILLS_DIR, skillName, 'SKILL.md');

      if (!existsSync(skillMdPath)) continue;

      const fm = parseFrontmatter(skillMdPath);
      const name = fm?.name || skillName;
      const description = fm?.description || `/${skillName} skill`;

      skills.push({ dirName: skillName, name, description });
    }
  } catch (e) {
    console.error(`扫描 ${SKILLS_DIR} 失败: ${e.message}`);
  }

  return skills;
}

// ─── 3. 计算新增 Skills ─────────────────────────────────────────────────────

function findNewSkills(allSkills, knownSkills) {
  return allSkills.filter(s => {
    // 规范化名称匹配：skill dir name 或 frontmatter name
    const nameVariants = [s.name, s.dirName, s.name?.replace(/-/g, ''), s.dirName?.replace(/-/g, '')];
    return !nameVariants.some(v => v && knownSkills.has(v));
  });
}

// ─── 4. 生成新增区块 ────────────────────────────────────────────────────────

function buildNewSkillsBlock(newSkills) {
  if (newSkills.length === 0) return '';

  const rows = newSkills.map(s => {
    const skillRef = `\`/${s.name || s.dirName}\``;
    const desc = s.description.replace(/\|/g, '\\|');
    return `| ${skillRef} | — | ${desc} |`;
  });

  return [
    '',
    '---',
    '',
    '## 新增 Skills（待分类）',
    '',
    '| Skill | 触发 | 职责 |',
    '|-------|------|------|',
    ...rows,
  ].join('\n');
}

// ─── 5. 更新计数 ─────────────────────────────────────────────────────────────

function updateCount(content, totalCount) {
  // 更新 "共 N 个 Skills" 行
  content = content.replace(/\*\*共 \d+ 个 Skills\*\*/, `**共 ${totalCount} 个 Skills**`);
  // 更新底部 "共 N Skills"
  content = content.replace(/共 \d+ Skills\*$/, `共 ${totalCount} Skills*`);
  // 更新生成时间
  const today = new Date().toISOString().slice(0, 10);
  content = content.replace(/\*生成时间：[\d-]+/, `*生成时间：${today}`);
  return content;
}

// ─── 主流程 ──────────────────────────────────────────────────────────────────

function main() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Skills Index Generator');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  if (DRY_RUN) console.log('  [DRY RUN] 只打印，不写文件');
  console.log('');

  // 检查 skills 目录存在
  if (!existsSync(SKILLS_DIR)) {
    console.error(`❌ Skills 目录不存在: ${SKILLS_DIR}`);
    process.exit(1);
  }

  // 读取现有索引
  const { content: existingContent, knownSkills } = readExistingIndex();
  console.log(`  已知 Skills（现有索引）: ${knownSkills.size} 个`);

  // 扫描所有 Skills
  const allSkills = scanSkillsDir();
  console.log(`  发现 Skills（workflows/skills/）: ${allSkills.length} 个`);

  // 计算新增
  const newSkills = findNewSkills(allSkills, knownSkills);
  console.log(`  新增 Skills（未在索引中）: ${newSkills.length} 个`);

  if (newSkills.length > 0) {
    console.log('');
    console.log('  新增 Skills 列表:');
    newSkills.forEach(s => {
      console.log(`    + /${s.name || s.dirName} — ${s.description.substring(0, 60)}`);
    });
  }

  console.log('');

  // 构建新内容
  const totalCount = knownSkills.size + newSkills.length;
  let newContent = existingContent;

  // 在最后的路由表之前插入新增区块（如果有新增）
  if (newSkills.length > 0) {
    const newBlock = buildNewSkillsBlock(newSkills);
    // 插入在 "任务类型 → Skill 路由" 之前
    if (newContent.includes('## 任务类型 → Skill 路由')) {
      newContent = newContent.replace(
        /\n---\n\n## 任务类型 → Skill 路由/,
        `${newBlock}\n\n---\n\n## 任务类型 → Skill 路由`
      );
    } else {
      // fallback：追加到末尾
      newContent = newContent.trimEnd() + '\n' + newBlock + '\n';
    }
  }

  // 更新计数和日期
  newContent = updateCount(newContent, totalCount);

  // 打印 dry-run 输出（包含所有表格行，用于 DoD 验证）
  if (DRY_RUN) {
    console.log('  [DRY RUN] 输出预览（前 50 行）:');
    console.log('');
    newContent.split('\n').slice(0, 50).forEach(l => console.log('  ' + l));
    console.log('  ...');
    console.log('');
    // 打印所有 | 行（用于 DoD 计数验证）
    const tableLines = newContent.split('\n').filter(l => l.startsWith('|'));
    console.log(`  表格行数: ${tableLines.length}`);
    tableLines.forEach(l => console.log(l));
  } else {
    writeFileSync(INDEX_FILE, newContent, 'utf-8');
    console.log(`  ✅ 已更新: ${INDEX_FILE}`);
    console.log(`  总计: ${totalCount} 个 Skills`);
  }

  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

main();
