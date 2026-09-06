#!/usr/bin/env node
/**
 * auto-version-apply.mjs — 合并后版本五件套统一应用器(bump 全权归 bot)
 *
 * 被 .github/workflows/auto-version.yml 调用;PR 不再自带 bump(见 brain-version-bump-gate 翻转)。
 * 职责:
 *  1. bump packages/brain/package.json + package-lock.json(含 packages[''])
 *  2. 同步根 package-lock.json 的 packages['packages/brain'].version(npm10 edgesOut 案回归防线)
 *  3. 同步 .brain-versions / DEFINITION.md 版本行 / packages/brain/VERSION(如存在)
 *  4. 消费 changes/*.md 碎片:每个碎片占一个版本号,{VERSION} 占位替换后置顶插入 DEFINITION 条目区,碎片删除
 *
 * CLI: node packages/brain/scripts/auto-version-apply.mjs [--bump patch|minor|major] [--root <dir>]
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

function bumpVersion(v, type) {
  const [maj, min, pat] = v.trim().split('.').map(Number);
  if (type === 'major') return `${maj + 1}.0.0`;
  if (type === 'minor') return `${maj}.${min + 1}.0`;
  return `${maj}.${min}.${pat + 1}`;
}

function readJson(p) { return JSON.parse(readFileSync(p, 'utf8')); }
function writeJson(p, obj) { writeFileSync(p, JSON.stringify(obj, null, 2) + '\n'); }

function listFragments(root) {
  const dir = join(root, 'changes');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md') && f.toLowerCase() !== 'readme.md')
    .sort()
    .map((f) => join(dir, f));
}

function writeVersionEverywhere(root, version) {
  const pkgPath = join(root, 'packages/brain/package.json');
  const pkg = readJson(pkgPath);
  pkg.version = version;
  writeJson(pkgPath, pkg);

  const lockPath = join(root, 'packages/brain/package-lock.json');
  if (existsSync(lockPath)) {
    const lock = readJson(lockPath);
    lock.version = version;
    if (lock.packages && lock.packages['']) lock.packages[''].version = version;
    writeJson(lockPath, lock);
  }

  // 根 lock 的 workspace 条目——check-version-sync 不盖它,npm10 edgesOut 全线红的根因之一
  const rootLockPath = join(root, 'package-lock.json');
  if (existsSync(rootLockPath)) {
    const rootLock = readJson(rootLockPath);
    if (rootLock.packages && rootLock.packages['packages/brain']) {
      rootLock.packages['packages/brain'].version = version;
      writeJson(rootLockPath, rootLock);
    }
  }

  writeFileSync(join(root, '.brain-versions'), version + '\n');

  const versionFile = join(root, 'packages/brain/VERSION');
  if (existsSync(versionFile)) writeFileSync(versionFile, version + '\n');

  const defPath = join(root, 'DEFINITION.md');
  if (existsSync(defPath)) {
    const def = readFileSync(defPath, 'utf8');
    writeFileSync(defPath, def.replace(/\*\*Brain 版本\*\*: .*/, `**Brain 版本**: ${version}`));
  }
}

function insertDefinitionEntry(root, entryText) {
  const defPath = join(root, 'DEFINITION.md');
  if (!existsSync(defPath)) return;
  const def = readFileSync(defPath, 'utf8');
  const body = entryText.trim() + '\n';
  // 插到第一个 "## Brain " 条目之前(即最新条目位);没有旧条目则追加文末
  const m = def.match(/^## Brain /m);
  const out = m
    ? def.slice(0, m.index) + body + '\n' + def.slice(m.index)
    : def.trimEnd() + '\n\n' + body;
  writeFileSync(defPath, out);
}

export function applyAutoVersion(root, { bumpType = 'patch', ifFragmentsOnly = false } = {}) {
  const fragments = listFragments(root);
  if (ifFragmentsOnly && fragments.length === 0) {
    return { skipped: true, fragmentsConsumed: 0, newVersion: null };
  }

  let version = readJson(join(root, 'packages/brain/package.json')).version;

  if (fragments.length === 0) {
    version = bumpVersion(version, bumpType);
    writeVersionEverywhere(root, version);
    return { skipped: false, fragmentsConsumed: 0, newVersion: version };
  }

  // 每个碎片占一个版本号:文件名序 = 版本序
  for (const frag of fragments) {
    version = bumpVersion(version, bumpType);
    const entry = readFileSync(frag, 'utf8').replaceAll('{VERSION}', version);
    insertDefinitionEntry(root, entry);
    unlinkSync(frag);
  }
  writeVersionEverywhere(root, version);
  return { skipped: false, fragmentsConsumed: fragments.length, newVersion: version };
}

// CLI 入口(workflow 用);被 import 时不执行
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const bumpType = args.includes('--bump') ? args[args.indexOf('--bump') + 1] : 'patch';
  const root = args.includes('--root') ? args[args.indexOf('--root') + 1] : process.cwd();
  const r = applyAutoVersion(root, { bumpType });
  console.log(JSON.stringify(r));
}
