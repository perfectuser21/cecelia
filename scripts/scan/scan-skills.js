#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const pg = require('pg');

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL || 'postgresql://localhost/cecelia' });

const SKILL_DIRS = [
  path.join(process.env.HOME, '.claude', 'skills'),
  path.join(process.env.HOME, '.claude-account1', 'plugins', 'cache', 'superpowers-marketplace', 'superpowers', '5.0.7', 'skills'),
];

function scanSkillDir(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillMd = path.join(dir, entry.name, 'SKILL.md');
    if (!fs.existsSync(skillMd)) continue;
    const content = fs.readFileSync(skillMd, 'utf8');
    const nameMatch = content.match(/^name:\s*(.+)$/m);
    const descMatch = content.match(/^description:\s*([\s\S]+?)(?=\n---|\n##)/m);
    results.push({
      name: nameMatch ? nameMatch[1].trim() : entry.name,
      location: skillMd,
      description: descMatch ? descMatch[1].trim().slice(0, 500) : '',
    });
  }
  return results;
}

async function main() {
  const skills = [];
  for (const dir of SKILL_DIRS) skills.push(...scanSkillDir(dir));
  console.log(`扫描到 ${skills.length} 个 skill`);

  for (const s of skills) {
    await pool.query(
      `INSERT INTO system_registry (type, name, location, description, status)
       VALUES ('skill', $1, $2, $3, 'active')
       ON CONFLICT (type, name) DO UPDATE
         SET location=$2, description=$3, updated_at=NOW()`,
      [s.name, s.location, s.description],
    );
  }
  console.log('skill_registry (system_registry) 填充完成');
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
