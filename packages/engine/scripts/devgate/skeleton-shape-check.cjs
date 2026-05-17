#!/usr/bin/env node
/**
 * skeleton-shape-check.cjs
 * 触发条件：PR diff 中存在 contract-dod-ws0.md 且文件含 skeleton: true
 * 校验逻辑：读 journey_type header，检验测试文件 import/调用 pattern 匹配
 * Spec: docs/superpowers/specs/2026-05-06-harness-working-skeleton-design.md §5
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const BASE_REF = process.env.BASE_REF || 'origin/main';

// 找到 PR diff 中变动的 contract-dod-ws0.md
let changedFiles;
try {
  changedFiles = execSync(`git diff --name-only ${BASE_REF}...HEAD`, { encoding: 'utf8' })
    .split('\n').filter(Boolean);
} catch (e) {
  console.error('git diff failed:', e.message);
  process.exit(1);
}

const skeletonDods = changedFiles.filter(f => f.endsWith('contract-dod-ws0.md'));

if (skeletonDods.length === 0) {
  console.log('ℹ️  No contract-dod-ws0.md changed — skeleton check skipped');
  process.exit(0);
}

let failed = false;

for (const dodFile of skeletonDods) {
  if (!fs.existsSync(dodFile)) continue;
  const content = fs.readFileSync(dodFile, 'utf8');

  // 读 YAML frontmatter (--- ... ---)
  const headerMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!headerMatch) continue;
  const header = headerMatch[1];

  const isSkeletonLine = header.match(/^skeleton:\s*true\s*$/m);
  if (!isSkeletonLine) continue;

  const jtMatch = header.match(/^journey_type:\s*(\S+)\s*$/m);
  if (!jtMatch) {
    console.error(`ERROR: ${dodFile} has skeleton:true but missing journey_type header`);
    failed = true;
    continue;
  }
  const journeyType = jtMatch[1].trim();

  // 找对应测试目录（相对于 dodFile 所在目录）
  const sprintDir = path.dirname(dodFile);
  const testDir = path.join(sprintDir, 'tests', 'ws0');
  if (!fs.existsSync(testDir)) {
    console.error(`ERROR: skeleton test dir missing: ${testDir}`);
    failed = true;
    continue;
  }

  const testFiles = fs.readdirSync(testDir).filter(f => f.endsWith('.test.ts') || f.endsWith('.test.js'));
  if (testFiles.length === 0) {
    console.error(`ERROR: no test files in ${testDir}`);
    failed = true;
    continue;
  }

  const PATTERNS = {
    user_facing:  /playwright|chromium|chrome.?mcp/i,
    autonomous:   /await.*query|await.*db\b|pollDB/i,
    dev_pipeline: /pr_url|execution.callback|gh.*pr/i,
    agent_remote: /bridge|executed.*true|agent.*result/i,
  };

  const pattern = PATTERNS[journeyType];
  if (!pattern) {
    console.error(`ERROR: unknown journey_type "${journeyType}" in ${dodFile}`);
    failed = true;
    continue;
  }

  for (const tf of testFiles) {
    const testPath = path.join(testDir, tf);
    const testContent = fs.readFileSync(testPath, 'utf8');
    if (!pattern.test(testContent)) {
      const preview = testContent.split('\n').slice(0, 5).map(l => '    ' + l).join('\n');
      console.error(`ERROR: skeleton test shape mismatch
  journey_type=${journeyType} (from ${dodFile})
  expected pattern: ${pattern}
  test file: ${testPath}
  first 5 lines:
${preview}`);
      failed = true;
    } else {
      console.log(`✅ ${tf} matches shape for journey_type=${journeyType}`);
    }
  }
}

process.exit(failed ? 1 : 0);
