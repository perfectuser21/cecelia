#!/usr/bin/env node
/**
 * ci-inventory-audit.mjs — CI Inventory Audit v1
 *
 * 扫描全仓库测试文件，输出 CI Coverage Report，回答：
 *   1. 每个子系统有哪些测试文件，分配到哪个 CI 层？
 *   2. 有测试但无 taxonomy 分类的盲区文件（历史欠账）
 *   3. 在 routing-map 注册但零测试的子系统（路由孤岛）
 *   4. 不在 routing-map 任何子系统下的孤立测试
 *
 * Usage:
 *   node scripts/ci-inventory-audit.mjs
 *   node scripts/ci-inventory-audit.mjs --json   # JSON 格式输出
 *
 * Exit codes:
 *   0 = 审计完成（仅报告，不阻塞）
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { resolve, dirname, relative } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const JSON_MODE = process.argv.includes('--json');

// ─── YAML 解析（复用 evolution-check 风格）─────────────────────────────────

function parseRoutingMap(content) {
  const lines = content.split('\n');
  const subsystems = {};
  let inSubsystems = false;
  let current = null;
  let inRootsList = false;

  for (const line of lines) {
    if (/^subsystems:\s*$/.test(line)) { inSubsystems = true; continue; }
    if (inSubsystems && /^[a-zA-Z]/.test(line) && !line.startsWith(' ')) { inSubsystems = false; continue; }
    if (!inSubsystems) continue;

    const entry = line.match(/^  ([a-zA-Z][a-zA-Z0-9_-]+):\s*$/);
    if (entry) {
      current = entry[1];
      subsystems[current] = { roots: [], layers: [], ci_exempt: false, deploy: false };
      inRootsList = false;
      continue;
    }
    if (!current) continue;

    // root: single
    const rootM = line.match(/^\s{4,}root:\s+(.+)$/);
    if (rootM) { subsystems[current].roots.push(rootM[1].trim()); inRootsList = false; continue; }

    // roots: [a, b]
    const rootsInline = line.match(/^\s{4,}roots:\s*\[(.+)\]\s*$/);
    if (rootsInline) {
      rootsInline[1].split(',').map(s => s.trim()).filter(Boolean)
        .forEach(r => subsystems[current].roots.push(r));
      inRootsList = false; continue;
    }

    // roots: (block)
    if (/^\s{4,}roots:\s*$/.test(line)) { inRootsList = true; continue; }
    if (inRootsList) {
      const item = line.match(/^\s{6,}-\s+(.+)$/);
      if (item) { subsystems[current].roots.push(item[1].trim()); continue; }
      if (line.trim()) inRootsList = false;
    }

    // layers: [l2, l3, l4]
    const layersM = line.match(/^\s{4,}layers:\s*\[(.+)\]/);
    if (layersM) {
      subsystems[current].layers = layersM[1].split(',').map(s => s.trim().replace(/['"]/g, '')).filter(Boolean);
    }

    if (/^\s{4,}ci_exempt:\s+true/.test(line)) subsystems[current].ci_exempt = true;
    if (/^\s{4,}deploy:\s+true/.test(line)) subsystems[current].deploy = true;
  }
  return subsystems;
}

function parseTestTaxonomy(content) {
  const lines = content.split('\n');
  const types = {};
  let inTypes = false;
  let current = null;
  let inPatterns = false;

  for (const line of lines) {
    if (/^test_types:\s*$/.test(line)) { inTypes = true; continue; }
    if (inTypes && /^[a-zA-Z]/.test(line) && !line.startsWith(' ')) { inTypes = false; continue; }
    if (!inTypes) continue;

    const entry = line.match(/^  ([a-zA-Z][a-zA-Z0-9_-]+):\s*$/);
    if (entry) { current = entry[1]; types[current] = { patterns: [], layer: null }; inPatterns = false; continue; }
    if (!current) continue;

    if (/^\s{4,}patterns:\s*$/.test(line)) { inPatterns = true; continue; }
    if (inPatterns) {
      const item = line.match(/^\s{6,}-\s+"?(.+?)"?\s*$/);
      if (item) { types[current].patterns.push(item[1].trim()); continue; }
      if (line.trim()) inPatterns = false;
    }
    const layerM = line.match(/^\s{4,}layer:\s+(\S+)/);
    if (layerM) types[current].layer = layerM[1].trim();
  }
  return types;
}

// ─── 模式匹配 ────────────────────────────────────────────────────────────────

function globToRegex(pattern) {
  const s = pattern
    .replace(/\./g, '\\.')
    .replace(/\*\*\//g, '___GLOBSTAR_SEP___')
    .replace(/\*\*/g, '___GLOBSTAR___')
    .replace(/\*/g, '[^/]*')
    .replace(/___GLOBSTAR_SEP___/g, '(?:.+/)?')
    .replace(/___GLOBSTAR___/g, '.*');
  return new RegExp(`^${s}$`);
}

function classifyFile(relPath, taxonomy) {
  for (const [typeName, entry] of Object.entries(taxonomy)) {
    for (const pattern of entry.patterns) {
      const rx = globToRegex(pattern);
      if (rx.test(relPath)) return { type: typeName, layer: entry.layer };
      // 也尝试去掉 /** 后缀匹配目录前缀
      const dirPattern = pattern.replace(/\/\*\*$/, '').replace(/\*\*$/, '');
      if (relPath.startsWith(dirPattern + '/') || relPath === dirPattern) {
        const rx2 = globToRegex(dirPattern + '/**');
        if (rx2.test(relPath)) return { type: typeName, layer: entry.layer };
        return { type: typeName, layer: entry.layer };
      }
    }
  }
  return null;
}

function findSubsystem(relPath, subsystems) {
  for (const [name, entry] of Object.entries(subsystems)) {
    for (const root of entry.roots) {
      if (relPath.startsWith(root + '/') || relPath === root) {
        return name;
      }
    }
  }
  return null;
}

// ─── 文件扫描 ─────────────────────────────────────────────────────────────────

const TEST_EXTS = /\.(test|spec)\.(js|ts|mjs|cjs|tsx)$/;
const IGNORE_DIRS = new Set(['node_modules', '.git', '.claude', 'dist', 'build', '.next', 'coverage']);

function scanTestFiles(dir) {
  const results = [];
  function recurse(d) {
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (IGNORE_DIRS.has(e.name)) continue;
      const full = resolve(d, e.name);
      if (e.isDirectory()) { recurse(full); continue; }
      if (TEST_EXTS.test(e.name)) results.push(full);
    }
  }
  recurse(dir);
  return results;
}

// ─── 主逻辑 ──────────────────────────────────────────────────────────────────

function main() {
  const routingPath = resolve(ROOT, 'ci/routing-map.yml');
  const taxonomyPath = resolve(ROOT, 'ci/test-taxonomy.yml');

  if (!existsSync(routingPath) || !existsSync(taxonomyPath)) {
    console.error('❌ ci/routing-map.yml 或 ci/test-taxonomy.yml 不存在');
    console.error('   先运行 CI Evolution Gate 确认注册表文件存在');
    process.exit(1);
  }

  const subsystems = parseRoutingMap(readFileSync(routingPath, 'utf8'));
  const taxonomy = parseTestTaxonomy(readFileSync(taxonomyPath, 'utf8'));
  const allFiles = scanTestFiles(ROOT).map(f => relative(ROOT, f).replace(/\\/g, '/'));

  // ── 分类每个文件 ──────────────────────────────────────────────────────────

  const report = {
    total: allFiles.length,
    bySubsystem: {},      // name → { files, covered, blind, layers }
    orphan: [],           // 不属于任何子系统的测试文件
    byTaxonomy: {},       // type → count
    unclassified: [],     // 无 taxonomy 匹配
    subsystemsNoTests: [], // routing-map 注册但零测试
  };

  // 初始化子系统槽位
  for (const name of Object.keys(subsystems)) {
    report.bySubsystem[name] = { files: [], covered: [], blind: [], layers: new Set() };
  }
  for (const t of Object.keys(taxonomy)) report.byTaxonomy[t] = 0;

  for (const f of allFiles) {
    const subsName = findSubsystem(f, subsystems);
    const classification = classifyFile(f, taxonomy);

    if (classification) {
      report.byTaxonomy[classification.type] = (report.byTaxonomy[classification.type] || 0) + 1;
    } else {
      report.unclassified.push(f);
    }

    if (subsName) {
      const slot = report.bySubsystem[subsName];
      slot.files.push(f);
      if (classification) {
        slot.covered.push(f);
        slot.layers.add(classification.layer);
      } else {
        slot.blind.push(f);
      }
    } else {
      report.orphan.push(f);
    }
  }

  // 转 Set → Array
  for (const s of Object.values(report.bySubsystem)) {
    s.layers = [...s.layers].sort();
  }

  // 零测试的子系统
  for (const [name, slot] of Object.entries(report.bySubsystem)) {
    if (slot.files.length === 0 && !subsystems[name].ci_exempt) {
      report.subsystemsNoTests.push(name);
    }
  }

  // ── JSON 输出 ──────────────────────────────────────────────────────────────

  if (JSON_MODE) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  // ── 人类可读报告 ──────────────────────────────────────────────────────────

  const LINE = '━'.repeat(60);
  const THIN = '─'.repeat(60);

  console.log('');
  console.log(LINE);
  console.log('  CI Coverage Report — Cecelia Monorepo');
  console.log(`  Generated: ${new Date().toISOString()}`);
  console.log(LINE);

  // 汇总
  console.log('');
  console.log('## 汇总');
  console.log('');
  console.log(`  测试文件总数   : ${report.total}`);
  console.log(`  已分类（taxonomy）: ${report.total - report.unclassified.length}`);
  console.log(`  未分类（盲区）  : ${report.unclassified.length}`);
  console.log(`  无子系统归属   : ${report.orphan.length}`);
  console.log('');

  // Taxonomy 分布
  console.log(THIN);
  console.log('## Taxonomy 分类分布');
  console.log('');
  const taxonomyEntries = Object.entries(report.byTaxonomy).sort((a, b) => b[1] - a[1]);
  for (const [type, count] of taxonomyEntries) {
    const layer = taxonomy[type]?.layer ?? '?';
    const bar = '█'.repeat(Math.min(Math.round(count / 5), 30));
    console.log(`  ${type.padEnd(18)} [${layer}]  ${String(count).padStart(4)}  ${bar}`);
  }
  if (report.unclassified.length > 0) {
    const bar = '░'.repeat(Math.min(Math.round(report.unclassified.length / 5), 30));
    console.log(`  ${'(unclassified)'.padEnd(18)} [-]   ${String(report.unclassified.length).padStart(4)}  ${bar}`);
  }

  // 逐子系统
  console.log('');
  console.log(THIN);
  console.log('## 子系统覆盖详情');
  console.log('');

  for (const [name, slot] of Object.entries(report.bySubsystem)) {
    const sub = subsystems[name];
    const exempt = sub.ci_exempt ? ' [ci_exempt]' : '';
    const totalFiles = slot.files.length;
    const blindCount = slot.blind.length;
    const layers = slot.layers.length > 0 ? slot.layers.join(', ') : '—';
    const declaredLayers = sub.layers.length > 0 ? sub.layers.join(', ') : '—';
    const status = totalFiles === 0 ? '🔴 零测试' :
                   blindCount > 0  ? '🟡 有盲区' : '🟢 覆盖良好';

    console.log(`  ${status}  ${name}${exempt}`);
    console.log(`         测试文件: ${totalFiles}  |  已分类: ${totalFiles - blindCount}  |  盲区: ${blindCount}`);
    console.log(`         实际覆盖层: ${layers}  |  routing-map 声明层: ${declaredLayers}`);

    // 缺口：routing-map 声明了但实际没覆盖的层
    const missing = sub.layers.filter(l => !slot.layers.includes(l));
    if (missing.length > 0) {
      console.log(`         ⚠️  声明层缺口: ${missing.join(', ')} — 无对应测试文件`);
    }

    if (blindCount > 0 && blindCount <= 5) {
      for (const f of slot.blind) console.log(`         │  盲区: ${f}`);
    } else if (blindCount > 5) {
      for (const f of slot.blind.slice(0, 3)) console.log(`         │  盲区: ${f}`);
      console.log(`         │  ... 及另外 ${blindCount - 3} 个文件`);
    }

    console.log('');
  }

  // 孤立测试（无子系统归属）
  if (report.orphan.length > 0) {
    console.log(THIN);
    console.log('## 孤立测试（不在任何注册子系统下）');
    console.log('');
    // 按目录分组
    const orphanByDir = {};
    for (const f of report.orphan) {
      const dir = f.split('/').slice(0, 2).join('/');
      orphanByDir[dir] = (orphanByDir[dir] || []);
      orphanByDir[dir].push(f);
    }
    for (const [dir, files] of Object.entries(orphanByDir).sort()) {
      console.log(`  📁 ${dir}  (${files.length} 个测试文件)`);
      if (files.length <= 3) {
        files.forEach(f => console.log(`     ${f}`));
      } else {
        files.slice(0, 2).forEach(f => console.log(`     ${f}`));
        console.log(`     ... 及另外 ${files.length - 2} 个`);
      }
    }
    console.log('');
    console.log('  ⚡ 建议：将上述目录注册到 ci/routing-map.yml');
  }

  // 零测试子系统
  if (report.subsystemsNoTests.length > 0) {
    console.log('');
    console.log(THIN);
    console.log('## 路由孤岛（routing-map 注册但零测试）');
    console.log('');
    for (const name of report.subsystemsNoTests) {
      const sub = subsystems[name];
      console.log(`  🔴 ${name}  (声明层: ${sub.layers.join(', ') || '—'})`);
      console.log(`       根路径: ${sub.roots.join(', ')}`);
    }
    console.log('');
    console.log('  ⚡ 建议：为上述子系统补充测试文件，或更新 routing-map.yml 声明');
  }

  // 未分类文件摘要（最多显示 10 个）
  if (report.unclassified.length > 0) {
    console.log('');
    console.log(THIN);
    console.log(`## 盲区文件摘要（共 ${report.unclassified.length} 个，无 taxonomy 匹配）`);
    console.log('');
    const shown = report.unclassified.slice(0, 10);
    shown.forEach(f => console.log(`  ⬜ ${f}`));
    if (report.unclassified.length > 10) {
      console.log(`  ... 及另外 ${report.unclassified.length - 10} 个（使用 --json 查看完整列表）`);
    }
    console.log('');
    console.log('  ⚡ 建议：在 ci/test-taxonomy.yml 为上述文件路径添加 pattern 分类');
  }

  // 最终总结
  console.log('');
  console.log(LINE);
  const healthScore = Math.round(((report.total - report.unclassified.length) / Math.max(report.total, 1)) * 100);
  console.log(`  CI Coverage Score: ${healthScore}%`);
  console.log(`  （已分类 ${report.total - report.unclassified.length} / 总计 ${report.total} 个测试文件）`);
  if (report.subsystemsNoTests.length > 0) {
    console.log(`  ⚠️  ${report.subsystemsNoTests.length} 个子系统零测试`);
  }
  if (report.orphan.length > 0) {
    console.log(`  ⚠️  ${report.orphan.length} 个测试文件不在任何注册子系统下`);
  }
  console.log(LINE);
  console.log('');
}

main();
