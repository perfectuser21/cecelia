#!/usr/bin/env node
/**
 * Registry Auto-Sync Phase 0 — 只读检查 + CI block
 *
 * 6 项检查:
 * 1. entry_files 存在性：features/*.yml 每个 feature 的 code.entry_files 必须全部存在
 * 2. 测试文件存在性：tests.unit/integration/e2e/regression 列出的文件必须存在
 * 3. skill 文件存在性：skills[].entry_file 非 null 时必须存在
 * 4. maturity 诚实性：maturity 等级与文档/测试覆盖一致
 * 5. feature_count 一致性：system-registry.yml 的 feature_count 和实际数量一致
 * 6. schema_version 一致性：features/*.yml 注释中的版本和 system-registry.yml 一致
 *
 * 零外部依赖，纯 Node.js 实现
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const REGISTRY_DIR = join(ROOT, 'docs', 'registry');
const FEATURES_DIR = join(REGISTRY_DIR, 'features');

let errors = 0;
let warnings = 0;
let passed = 0;

function fail(msg) {
  console.error(`  FAIL  ${msg}`);
  errors++;
}

function warn(msg) {
  console.warn(`  WARN  ${msg}`);
  warnings++;
}

function ok(msg) {
  console.log(`  PASS  ${msg}`);
  passed++;
}

// ─── 辅助：检查路径是否存在 ────────────────────────────────────

function pathExists(relPath) {
  const fullPath = join(ROOT, relPath);
  if (relPath.endsWith('/')) {
    return existsSync(fullPath) && statSync(fullPath).isDirectory();
  }
  return existsSync(fullPath);
}

// ─── 简易 YAML 提取工具 ────────────────────────────────────────
// 针对 registry 特定格式，不是通用 YAML parser

function extractScalar(content, key) {
  // 用 word boundary 避免 feature_id 匹配到 id
  const regex = new RegExp(`^[\\s-]*\\b${key}:\\s*(.+)$`, 'gm');
  const match = regex.exec(content);
  if (!match) return null;
  let val = match[1].trim();
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    val = val.slice(1, -1);
  }
  if (val === 'null' || val === '~') return null;
  return val;
}

function extractAllScalars(content, key) {
  const results = [];
  const regex = new RegExp(`^\\s*${key}:\\s*(.+)$`, 'gm');
  let match;
  while ((match = regex.exec(content)) !== null) {
    let val = match[1].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (val && val !== 'null' && val !== '~') {
      results.push(val);
    }
  }
  return results;
}

/**
 * 提取 YAML inline array: [a, b, c] 或 [a]
 */
function parseInlineArray(str) {
  if (!str) return [];
  str = str.trim();
  if (str.startsWith('[') && str.endsWith(']')) {
    const inner = str.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(',').map(s => {
      s = s.trim();
      if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
        s = s.slice(1, -1);
      }
      return s;
    }).filter(Boolean);
  }
  return [];
}

/**
 * 提取 system-registry.yml 中的 systems 列表
 * 返回 [{id, features_file, feature_count}, ...]
 */
function parseSystems(content) {
  const systems = [];
  // 按 "- id:" 分割
  const blocks = content.split(/^  - id:/m);
  blocks.shift(); // 去掉 systems: 之前的部分

  for (const block of blocks) {
    const fullBlock = '  - id:' + block;
    const id = extractScalar(fullBlock, 'id');
    const featuresFile = extractScalar(fullBlock, 'features_file');
    const fcStr = extractScalar(fullBlock, 'feature_count');
    const featureCount = fcStr ? parseInt(fcStr, 10) : null;
    systems.push({ id, features_file: featuresFile, feature_count: featureCount });
  }
  return systems;
}

/**
 * 从 feature YAML 文件解析所有 features
 * 每个 feature 返回:
 * { feature_id, maturity, entry_files[], tests{unit,integration,e2e,regression}, skills[{skill_id, entry_file}], docs{prd,dod,adr,api_doc,runbook} }
 */
function parseFeatures(content) {
  const features = [];

  // 按 "  - feature_id:" 分割（顶层 feature 缩进 2 空格 + "- "）
  const blocks = content.split(/^  - feature_id:/m);
  blocks.shift(); // 去掉 header

  for (const block of blocks) {
    const fullBlock = '  - feature_id:' + block;
    const featureId = extractScalar(fullBlock, 'feature_id');
    const matStr = extractScalar(fullBlock, 'maturity');
    const maturity = matStr ? parseInt(matStr, 10) : 0;

    // entry_files: [path1, path2]
    const entryFilesLine = fullBlock.match(/^\s*entry_files:\s*(.+)$/m);
    const entryFiles = entryFilesLine ? parseInlineArray(entryFilesLine[1]) : [];

    // docs 字段
    const docs = {};
    for (const docKey of ['prd', 'dod', 'adr', 'api_doc', 'runbook']) {
      const val = extractScalar(fullBlock, docKey);
      docs[docKey] = val;
    }

    // tests — 需要提取 unit/integration/e2e/regression 下的列表项
    const tests = { unit: [], integration: [], e2e: [], regression: [] };
    for (const category of ['unit', 'integration', 'e2e', 'regression']) {
      // 找到 "category:" 行后面的 "- path" 行
      const catRegex = new RegExp(`^\\s+${category}:\\s*$`, 'm');
      const catMatch = catRegex.exec(fullBlock);
      if (catMatch) {
        const afterCat = fullBlock.slice(catMatch.index + catMatch[0].length);
        const lines = afterCat.split('\n');
        for (const line of lines) {
          const itemMatch = line.match(/^\s+-\s+(.+)$/);
          if (itemMatch) {
            let val = itemMatch[1].trim();
            if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
              val = val.slice(1, -1);
            }
            tests[category].push(val);
          } else if (line.trim() && !line.match(/^\s*$/)) {
            // 遇到非列表项，停止
            break;
          }
        }
      }
      // 也处理 inline array 格式: unit: [file1, file2]
      const inlineRegex = new RegExp(`^\\s+${category}:\\s*(\\[.+\\])\\s*$`, 'm');
      const inlineMatch = inlineRegex.exec(fullBlock);
      if (inlineMatch && tests[category].length === 0) {
        tests[category] = parseInlineArray(inlineMatch[1]);
      }
    }

    // skills — 提取 skill_id 和 entry_file
    const skills = [];
    const skillBlocks = fullBlock.split(/^\s+- skill_id:/m);
    skillBlocks.shift(); // 去掉 skill_id 之前
    for (const sb of skillBlocks) {
      const fullSb = '      - skill_id:' + sb;
      const skillId = extractScalar(fullSb, 'skill_id');
      const entryFile = extractScalar(fullSb, 'entry_file');
      if (skillId) {
        skills.push({ skill_id: skillId, entry_file: entryFile });
      }
    }

    features.push({ feature_id: featureId, maturity, entry_files: entryFiles, docs, tests, skills });
  }

  return features;
}

// ─── 加载 system-registry.yml ───────────────────────────────────

console.log('\n=== Registry Auto-Sync Phase 0 ===\n');

const sysRegPath = join(REGISTRY_DIR, 'system-registry.yml');
if (!existsSync(sysRegPath)) {
  console.error('FAIL: system-registry.yml 不存在');
  process.exit(1);
}

const sysContent = readFileSync(sysRegPath, 'utf-8');
const globalSchemaVersion = extractScalar(sysContent, 'schema_version');
const systems = parseSystems(sysContent);

console.log(`schema_version: ${globalSchemaVersion}`);
console.log(`systems: ${systems.length}\n`);

// ─── 检查 1: features_file 引用存在性 ───────────────────────────

console.log('[1/6] features_file 引用存在性');
for (const sys of systems) {
  const ff = sys.features_file;
  if (!ff) {
    fail(`system ${sys.id}: features_file 未定义`);
    continue;
  }
  const fullPath = join(REGISTRY_DIR, ff);
  if (existsSync(fullPath)) {
    ok(`${sys.id} -> ${ff}`);
  } else {
    fail(`${sys.id}: features_file 引用不存在: ${ff}`);
  }
}

// ─── 加载并检查每个 feature 文件 ────────────────────────────────

if (!existsSync(FEATURES_DIR)) {
  console.error('FAIL: features/ 目录不存在');
  process.exit(1);
}

const featureYmls = readdirSync(FEATURES_DIR).filter(f => f.endsWith('.yml'));

for (const ymlFile of featureYmls) {
  const ymlPath = join(FEATURES_DIR, ymlFile);
  const rawContent = readFileSync(ymlPath, 'utf-8');
  const systemId = extractScalar(rawContent, 'system_id');
  const features = parseFeatures(rawContent);

  console.log(`\n--- ${ymlFile} (system: ${systemId}, features: ${features.length}) ---`);

  // ─── 检查 6: schema_version 一致性（从注释提取）─────────────
  console.log('\n  [6/6] schema_version 一致性');
  const schemaMatch = rawContent.match(/^#\s*Schema:\s*v?([\d.]+)/m);
  if (schemaMatch) {
    const featureSchemaVersion = schemaMatch[1];
    if (featureSchemaVersion === globalSchemaVersion) {
      ok(`${ymlFile} schema v${featureSchemaVersion} == system-registry v${globalSchemaVersion}`);
    } else {
      fail(`${ymlFile} schema v${featureSchemaVersion} != system-registry v${globalSchemaVersion}`);
    }
  } else {
    warn(`${ymlFile} 未声明 Schema 版本（注释中缺少 # Schema: vX.X.X）`);
  }

  // ─── 检查 5: feature_count 一致性 ──────────────────────────
  console.log('\n  [5/6] feature_count 一致性');
  const sysEntry = systems.find(s => s.id === systemId);
  if (sysEntry) {
    const declared = sysEntry.feature_count;
    const actual = features.length;
    if (declared === actual) {
      ok(`${systemId}: feature_count ${declared} == 实际 ${actual}`);
    } else {
      fail(`${systemId}: feature_count 声明 ${declared}, 实际 ${actual}`);
    }
  } else {
    warn(`${systemId}: 在 system-registry.yml 中未找到对应 system`);
  }

  // ─── 逐 feature 检查 2/3/4 + maturity ─────────────────────
  for (const feature of features) {
    const fid = feature.feature_id;
    const maturity = feature.maturity;

    // ─── 检查 2: entry_files 存在性 ──────────────────────────
    console.log(`\n  [2/6] entry_files 存在性 (${fid})`);
    for (const ef of feature.entry_files) {
      if (pathExists(ef)) {
        ok(`entry_files: ${ef}`);
      } else {
        fail(`${fid}: entry_files 不存在: ${ef}`);
      }
    }
    if (feature.entry_files.length === 0) {
      warn(`${fid}: 未声明 entry_files`);
    }

    // ─── 检查 3: 测试文件存在性 ──────────────────────────────
    console.log(`  [3/6] tests 文件存在性 (${fid})`);
    for (const category of ['unit', 'integration', 'e2e', 'regression']) {
      for (const tf of feature.tests[category]) {
        if (pathExists(tf)) {
          ok(`tests.${category}: ${tf}`);
        } else {
          fail(`${fid}: tests.${category} 文件不存在: ${tf}`);
        }
      }
    }

    // ─── 检查 4: skill 文件存在性 ────────────────────────────
    console.log(`  [4/6] skills 文件存在性 (${fid})`);
    for (const skill of feature.skills) {
      if (skill.entry_file) {
        if (pathExists(skill.entry_file)) {
          ok(`skill ${skill.skill_id}: ${skill.entry_file}`);
        } else {
          fail(`${fid}: skill ${skill.skill_id} entry_file 不存在: ${skill.entry_file}`);
        }
      }
    }

    // ─── maturity 诚实性检查 ─────────────────────────────────
    console.log(`  [maturity] 诚实性 (${fid}, maturity=${maturity})`);
    const docsAllNull = Object.values(feature.docs).every(v => v === null || v === undefined);

    if (maturity >= 1 && docsAllNull) {
      warn(`${fid}: maturity=${maturity} >= 1 但 docs 全部为 null（建议降级或补文档）`);
    }
    if (maturity >= 2 && feature.tests.unit.length === 0) {
      fail(`${fid}: maturity=${maturity} >= 2 但 tests.unit 为空`);
    }
    if (maturity >= 3 && feature.tests.integration.length === 0) {
      fail(`${fid}: maturity=${maturity} >= 3 但 tests.integration 为空`);
    }
  }
}

// ─── 汇总 ───────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(60)}`);
console.log(`检查完成: ${passed} PASS, ${errors} FAIL, ${warnings} WARN`);

if (errors > 0) {
  console.log(`\nFAIL: Registry Lint 发现 ${errors} 个错误\n`);
  process.exit(1);
} else {
  console.log('\nPASS: Registry Lint 全部通过\n');
  process.exit(0);
}
