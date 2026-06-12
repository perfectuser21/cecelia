#!/usr/bin/env node
/**
 * changed-test-router.mjs
 *
 * fs 依赖路由：扫描测试目录，找出所有通过 readFileSync 读取指定 skill 文件的测试，
 * 将测试 ID（文件名）输出到 stdout，供 CI 补充触发这些测试。
 *
 * 用法：
 *   node packages/brain/scripts/ci/changed-test-router.mjs --files <path1> [<path2>...]
 *
 * 输出：每行一个测试文件 ID（基础文件名，不含路径）
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { resolve, basename, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../../../../');

const TEST_DIRS = [
  resolve(REPO_ROOT, 'packages/brain/src/workflows/__tests__'),
];

function parseArgs(argv) {
  const files = [];
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--files') {
      while (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        files.push(argv[++i]);
      }
    }
  }
  return { files };
}

function collectTestFiles(dirs) {
  const results = [];
  for (const dir of dirs) {
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(entry)) {
        results.push(resolve(dir, entry));
      }
    }
  }
  return results;
}

function normalizeSkillPath(p) {
  return p.replace(/\\/g, '/');
}

function testDependsOnSkill(testFilePath, skillPaths) {
  let content;
  try {
    content = readFileSync(testFilePath, 'utf8');
  } catch {
    return false;
  }
  for (const skillPath of skillPaths) {
    const normalized = normalizeSkillPath(skillPath);
    const segments = normalized.split('/');
    // Match if test file contains any suffix of the skill path (2+ segments)
    for (let len = 2; len <= segments.length; len++) {
      const suffix = segments.slice(segments.length - len).join('/');
      if (content.includes(suffix)) {
        return true;
      }
    }
  }
  return false;
}

const { files: changedFiles } = parseArgs(process.argv);

if (changedFiles.length === 0) {
  process.exit(0);
}

const testFiles = collectTestFiles(TEST_DIRS);
const matched = new Set();

for (const testFile of testFiles) {
  if (testDependsOnSkill(testFile, changedFiles)) {
    matched.add(basename(testFile, '').replace(/\.(test|spec)\.[cm]?[jt]sx?$/, '') + '.' + basename(testFile).split('.').slice(1).join('.'));
  }
}

if (matched.size > 0) {
  for (const id of matched) {
    process.stdout.write(id + '\n');
  }
}

process.exit(0);
