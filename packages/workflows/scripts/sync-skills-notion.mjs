#!/usr/bin/env node
/**
 * sync-skills-notion.mjs
 *
 * 扫描本机所有 skill 目录，与 Notion Skill Registry 同步。
 * Skill ID 是唯一键（不重复插入，只 upsert）。
 *
 * 用法：
 *   node packages/workflows/scripts/sync-skills-notion.mjs          # 全量同步
 *   node packages/workflows/scripts/sync-skills-notion.mjs --dry-run # 只打印差异
 *   node packages/workflows/scripts/sync-skills-notion.mjs --skill device-transfer # 单个
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '../../..');
const HOME = process.env.HOME;

const DRY_RUN = process.argv.includes('--dry-run');
const SINGLE = process.argv.includes('--skill')
  ? process.argv[process.argv.indexOf('--skill') + 1]
  : null;

// ─── Notion 配置 ───────────────────────────────────────────────────────────
const NOTION_API_KEY = process.env.NOTION_API_KEY;
const DB_ID = '353c40c2-ba63-81bf-ae3e-f0e6fa3753d7'; // Skill Registry

if (!NOTION_API_KEY) {
  console.error('❌ NOTION_API_KEY 未设置，请先 source ~/.credentials/notion.env');
  process.exit(1);
}

async function notionRequest(path, method = 'GET', body = null) {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${NOTION_API_KEY}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return res.json();
}

// ─── 扫描 skill 目录 ────────────────────────────────────────────────────────
function parseSkillFrontmatter(skillMdPath) {
  try {
    const content = readFileSync(skillMdPath, 'utf8');
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return null;

    const frontmatter = match[1];
    const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
    const descMatch = frontmatter.match(/^description:\s*[|>]?\s*\n?([\s\S]*?)(?=\n\w|\n---|\n$|$)/m);

    const name = nameMatch ? nameMatch[1].trim() : null;
    let description = '';
    if (descMatch) {
      description = descMatch[1]
        .split('\n')
        .map(l => l.trim())
        .filter(Boolean)
        .join(' ')
        .slice(0, 300);
    }

    return { name, description };
  } catch {
    return null;
  }
}

function scanSkillDirs(baseDir, source) {
  if (!existsSync(baseDir)) return [];
  const skills = [];

  for (const entry of readdirSync(baseDir)) {
    if (entry.startsWith('.')) continue;
    const skillDir = join(baseDir, entry);
    if (!statSync(skillDir).isDirectory()) continue;

    const skillMd = join(skillDir, 'SKILL.md');
    if (!existsSync(skillMd)) continue;

    const fm = parseSkillFrontmatter(skillMd);
    if (!fm || !fm.name) continue;

    skills.push({
      skillId: entry,          // 目录名作为唯一 ID
      name: fm.name,
      description: fm.description,
      source,
    });
  }

  return skills;
}

// ─── 查 Notion 现有记录 ──────────────────────────────────────────────────────
async function fetchAllNotionSkills() {
  const skills = new Map(); // skillId → { pageId, name, status }
  let cursor = undefined;

  do {
    const body = { page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) };
    const data = await notionRequest(`/databases/${DB_ID}/query`, 'POST', body);

    for (const page of data.results || []) {
      const p = page.properties;
      const skillId = p['Skill ID']?.rich_text?.[0]?.plain_text;
      if (!skillId) continue;
      skills.set(skillId, {
        pageId: page.id,
        name: p['Name']?.title?.[0]?.plain_text || '',
        status: p['Status']?.select?.name || 'active',
      });
    }

    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);

  return skills;
}

// ─── 写入 Notion ─────────────────────────────────────────────────────────────
function toDisplayName(skillId) {
  return skillId.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function buildProperties(skill) {
  return {
    'Name': { title: [{ text: { content: toDisplayName(skill.skillId) } }] },
    'Skill ID': { rich_text: [{ text: { content: skill.skillId } }] },
    'Description': { rich_text: [{ text: { content: skill.description } }] },
    'Status': { select: { name: 'active' } },
    'Source': { select: { name: skill.source } },
  };
}

async function createSkill(skill) {
  return notionRequest('/pages', 'POST', {
    parent: { database_id: DB_ID },
    properties: buildProperties(skill),
  });
}

async function updateSkill(pageId, skill) {
  return notionRequest(`/pages/${pageId}`, 'PATCH', {
    properties: buildProperties(skill),
  });
}

// ─── 主流程 ───────────────────────────────────────────────────────────────────
async function main() {
  console.log(`🔄 扫描 skill 目录...`);

  const localSkills = scanSkillDirs(join(HOME, '.claude/skills'), 'custom');
  const workflowSkills = scanSkillDirs(join(PROJECT_ROOT, 'packages/workflows/skills'), 'custom');

  // 合并，优先 workflows（正式），local 补充
  const allSkillsMap = new Map();
  for (const s of [...localSkills, ...workflowSkills]) {
    allSkillsMap.set(s.skillId, s); // workflows 会覆盖 local（后写）
  }

  let skills = [...allSkillsMap.values()];
  if (SINGLE) {
    skills = skills.filter(s => s.skillId === SINGLE);
    if (!skills.length) {
      console.error(`❌ 没找到 skill: ${SINGLE}`);
      process.exit(1);
    }
  }

  console.log(`📦 本地共 ${allSkillsMap.size} 个 skill（工作流 ${workflowSkills.length} + 本地 ${localSkills.length}）`);
  console.log(`🌐 查询 Notion Skill Registry...`);

  const notionSkills = await fetchAllNotionSkills();
  console.log(`📋 Notion 现有 ${notionSkills.size} 条记录`);

  let created = 0, updated = 0, skipped = 0;

  for (const skill of skills) {
    const existing = notionSkills.get(skill.skillId);

    if (!existing) {
      console.log(`  ➕ 新增: ${skill.skillId} (${skill.name})`);
      if (!DRY_RUN) await createSkill(skill);
      created++;
    } else {
      // 只在 name 或 description 有变化时更新
      const nameChanged = existing.name !== skill.name;
      const descChanged = false; // description 不做 change-detect（避免 API 多查一次）

      if (nameChanged) {
        console.log(`  ✏️  更新: ${skill.skillId} (${existing.name} → ${toDisplayName(skill.skillId)})`);
        if (!DRY_RUN) await updateSkill(existing.pageId, skill);
        updated++;
      } else {
        skipped++;
      }
    }
  }

  console.log('');
  console.log(`✅ 同步完成${DRY_RUN ? ' (dry-run，未实际写入)' : ''}`);
  console.log(`   新增: ${created}  更新: ${updated}  跳过: ${skipped}`);
}

main().catch(err => {
  console.error('❌', err.message);
  process.exit(1);
});
