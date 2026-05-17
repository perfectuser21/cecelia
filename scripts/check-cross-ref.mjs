#!/usr/bin/env node
/**
 * check-cross-ref.mjs — 跨文件引用一致性检查器 v1.0.0
 *
 * 读取 scripts/cross-ref-registry.yaml 中定义的规则，
 * 检查 SSOT 文件和消费者文件之间的引用一致性。
 *
 * 只检查本次 PR 变更涉及的规则（增量检测）。
 * 无变更时全部跳过。
 *
 * 用法: node scripts/check-cross-ref.mjs [--all]
 *   --all  强制检查所有规则（忽略 git diff）
 *
 * exit 0 = 全部一致
 * exit 1 = 有不一致
 */

import { readFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');

const REGISTRY_PATH = resolve(ROOT, 'scripts/cross-ref-registry.yaml');
const CHECK_ALL = process.argv.includes('--all');

// ===== 简单 YAML 解析（不依赖 js-yaml） =====
function parseSimpleYaml(content) {
  const rules = [];
  let current = null;

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // 新规则开始
    if (/^- id:\s*(.+)/.test(trimmed)) {
      if (current) rules.push(current);
      current = { id: trimmed.match(/^- id:\s*(.+)/)[1].trim(), consumers: [] };
    }

    if (!current) continue;

    // 简单 key: value 解析
    if (/^description:/.test(trimmed)) continue; // 跳过多行描述
    if (/^ssot:/.test(trimmed)) continue;
    if (/^consumers:/.test(trimmed)) continue;

    // ssot.file
    const fileMatch = trimmed.match(/^file:\s*(.+)/);
    if (fileMatch && !current.ssotFile) {
      current.ssotFile = fileMatch[1].trim();
    }

    // check type
    const checkMatch = trimmed.match(/^check:\s*(.+)/);
    if (checkMatch) {
      current.check = checkMatch[1].trim();
    }

    // consumer entries (- path/to/file or - path/to/*.md)
    const consumerMatch = trimmed.match(/^- (packages\/.+|scripts\/.+)/);
    if (consumerMatch && current.ssotFile) {
      current.consumers.push(consumerMatch[1].trim());
    }
  }
  if (current) rules.push(current);

  return rules;
}

// ===== 获取变更文件列表 =====
function getChangedFiles() {
  try {
    const output = execSync('git diff --name-only origin/main...HEAD 2>/dev/null || git diff --name-only HEAD~1', {
      encoding: 'utf-8',
      cwd: ROOT,
    });
    return output.trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

// ===== 展开 glob 路径 =====
function expandGlob(pattern) {
  try {
    const output = execSync(`ls ${pattern} 2>/dev/null || true`, {
      encoding: 'utf-8',
      cwd: ROOT,
    });
    return output.trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

// ===== 从文件中提取 step_N_xxx 字段名 =====
function extractDevmodeFields(filePath) {
  try {
    const fullPath = resolve(ROOT, filePath);
    if (!existsSync(fullPath)) return new Set();
    const content = readFileSync(fullPath, 'utf-8');
    const matches = content.match(/step_\d+_[a-z_]+/g) || [];
    return new Set(matches);
  } catch {
    return new Set();
  }
}

// ===== 主逻辑 =====
function main() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Cross-Reference Consistency Check');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');

  // 读取 registry
  if (!existsSync(REGISTRY_PATH)) {
    console.log('⚠️  cross-ref-registry.yaml 不存在，跳过');
    process.exit(0);
  }

  const registryContent = readFileSync(REGISTRY_PATH, 'utf-8');
  const rules = parseSimpleYaml(registryContent);
  console.log(`📋 加载了 ${rules.length} 条规则`);
  console.log('');

  // 获取变更文件
  const changedFiles = CHECK_ALL ? ['*'] : getChangedFiles();
  if (changedFiles.length === 0) {
    console.log('ℹ️  无文件变更，跳过检查');
    process.exit(0);
  }

  let totalChecked = 0;
  let totalFailed = 0;
  const failures = [];

  for (const rule of rules) {
    // 增量检测：只检查 SSOT 或消费者被修改的规则
    const ssotChanged = CHECK_ALL || changedFiles.some(f => f === rule.ssotFile);
    const consumerChanged = CHECK_ALL || rule.consumers.some(pattern => {
      if (pattern.includes('*')) {
        return changedFiles.some(f => f.startsWith(pattern.replace('*', '').replace('*.md', '')));
      }
      return changedFiles.includes(pattern);
    });

    if (!ssotChanged && !consumerChanged) {
      console.log(`⏭️  ${rule.id}: 无变更，跳过`);
      continue;
    }

    totalChecked++;
    console.log(`🔍 检查规则: ${rule.id} (${rule.check})`);

    // devmode-fields: 检查 SSOT 和消费者之间的字段命名一致性
    // 规则：如果 SSOT 和消费者都有 step_N_xxx 格式的字段，命名模式必须一致
    // （不要求消费者字段是 SSOT 的子集——不同文件可能用不同子集是正常的）
    if (rule.id === 'devmode-fields') {
      const ssotFields = extractDevmodeFields(rule.ssotFile);
      console.log(`   SSOT (${rule.ssotFile}): ${[...ssotFields].join(', ')}`);

      // 提取 SSOT 的命名模式（step_4 vs step_10）
      const ssotStepNumbers = new Set([...ssotFields]
        .filter(f => f.startsWith('step_'))
        .map(f => f.match(/step_(\d+)/)?.[1])
        .filter(Boolean));

      for (const consumer of rule.consumers) {
        const files = consumer.includes('*') ? expandGlob(consumer) : [consumer];
        for (const file of files) {
          const consumerFields = extractDevmodeFields(file);
          if (consumerFields.size === 0) continue;

          // 检查消费者中的步骤编号是否包含旧编号（step_10/step_11 vs step_4/step_5）
          const consumerStepNumbers = [...consumerFields]
            .filter(f => f.startsWith('step_'))
            .map(f => f.match(/step_(\d+)/)?.[1])
            .filter(Boolean);

          // 如果消费者有 step_10/step_11（旧编号）但 SSOT 没有，报告不一致
          const oldNumbers = consumerStepNumbers.filter(n => parseInt(n) >= 10 && !ssotStepNumbers.has(n));
          if (oldNumbers.length > 0) {
            const oldFields = [...consumerFields].filter(f => oldNumbers.some(n => f.includes(`step_${n}_`)));
            const msg = `${file}: 使用旧步骤编号: ${oldFields.join(', ')}（SSOT 已改为新编号）`;
            console.log(`   ❌ ${msg}`);
            failures.push({ rule: rule.id, message: msg });
            totalFailed++;
          } else {
            console.log(`   ✅ ${file}`);
          }
        }
      }
    } else {
      // 其他规则类型暂时只检查 SSOT 文件存在性
      const ssotPath = resolve(ROOT, rule.ssotFile);
      if (!existsSync(ssotPath)) {
        const msg = `SSOT 文件不存在: ${rule.ssotFile}`;
        console.log(`   ❌ ${msg}`);
        failures.push({ rule: rule.id, message: msg });
        totalFailed++;
      } else {
        console.log(`   ✅ SSOT 文件存在: ${rule.ssotFile}`);
      }
    }

    console.log('');
  }

  // 汇总
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  if (totalFailed > 0) {
    console.log(`  ❌ ${totalFailed} 个不一致（${totalChecked} 个规则检查）`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    for (const f of failures) {
      console.log(`  [${f.rule}] ${f.message}`);
    }
    process.exit(1);
  } else {
    console.log(`  ✅ 全部一致（${totalChecked} 个规则检查）`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    process.exit(0);
  }
}

main();
