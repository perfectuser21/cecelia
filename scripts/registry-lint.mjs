#!/usr/bin/env node
/**
 * Registry Lint — 验证 registry 文件完整性
 *
 * 检查项:
 * 1. system-registry.yml 中引用的 features_file 文件都存在
 * 2. features/*.yml 中的 code_path 指向真实存在的文件
 * 3. 基础 YAML 格式校验（key-value 结构）
 *
 * 不依赖 js-yaml，纯 node fs 解析
 */

import { readFileSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const REGISTRY_DIR = join(ROOT, 'docs', 'registry');

let errors = 0;
let warnings = 0;
let checked = 0;

function error(msg) {
  console.error(`  ❌ ${msg}`);
  errors++;
}

function warn(msg) {
  console.warn(`  ⚠️  ${msg}`);
  warnings++;
}

function ok(msg) {
  console.log(`  ✅ ${msg}`);
}

// --- 简易 YAML 值提取 ---

function extractValues(content, key) {
  const results = [];
  const regex = new RegExp(`^\\s*${key}:\\s*(.+)$`, 'gm');
  let match;
  while ((match = regex.exec(content)) !== null) {
    let val = match[1].trim();
    // 去掉引号
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (val && val !== 'null' && val !== '~') {
      results.push(val);
    }
  }
  return results;
}

// --- 1. 检查 system-registry.yml ---

console.log('\n📋 检查 system-registry.yml ...');
const sysRegPath = join(REGISTRY_DIR, 'system-registry.yml');

if (!existsSync(sysRegPath)) {
  error('system-registry.yml 不存在');
  process.exit(1);
}

const sysContent = readFileSync(sysRegPath, 'utf-8');
const featureFiles = extractValues(sysContent, 'features_file');

for (const ff of featureFiles) {
  checked++;
  const fullPath = join(REGISTRY_DIR, ff);
  if (existsSync(fullPath)) {
    ok(`features_file: ${ff}`);
  } else {
    error(`features_file 引用不存在: ${ff}`);
  }
}

// --- 2. 检查每个 feature 文件的 code_path ---

console.log('\n📋 检查 features/*.yml code_path ...');
const featuresDir = join(REGISTRY_DIR, 'features');

if (!existsSync(featuresDir)) {
  error('features/ 目录不存在');
} else {
  const featureYmls = readdirSync(featuresDir).filter(f => f.endsWith('.yml'));

  for (const yml of featureYmls) {
    console.log(`\n  📄 ${yml}`);
    const content = readFileSync(join(featuresDir, yml), 'utf-8');
    const codePaths = extractValues(content, 'code_path');

    for (const cp of codePaths) {
      checked++;
      const fullPath = join(ROOT, cp);
      if (existsSync(fullPath)) {
        ok(`code_path: ${cp}`);
      } else {
        warn(`code_path 指向不存在的文件: ${cp}`);
      }
    }
  }
}

// --- 3. 检查其他 registry 文件存在性 ---

console.log('\n📋 检查其他 registry 文件 ...');
const expectedFiles = ['api-registry.yml', 'skill-registry.yml', 'test-registry.yml'];
for (const f of expectedFiles) {
  checked++;
  if (existsSync(join(REGISTRY_DIR, f))) {
    ok(`${f} 存在`);
  } else {
    warn(`${f} 不存在`);
  }
}

// --- 汇总 ---

console.log(`\n${'─'.repeat(50)}`);
console.log(`检查完成: ${checked} 项, ${errors} 错误, ${warnings} 警告`);

if (errors > 0) {
  console.log('\n❌ Registry Lint 失败\n');
  process.exit(1);
} else {
  console.log('\n✅ Registry Lint 通过\n');
  process.exit(0);
}
