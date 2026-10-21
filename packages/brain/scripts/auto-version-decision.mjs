#!/usr/bin/env node
// 只读固定 push 提交；已在该提交同步升版且没有待发布碎片时，禁止再次升版。
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const fail = code => { throw new Error(code); };
function semver(value) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) fail('AUTO_VERSION_INVALID_SEMVER');
  const parts = value.split('.').map(Number);
  if (!parts.every(Number.isSafeInteger)) fail('AUTO_VERSION_INVALID_SEMVER');
  return parts;
}

export function decideAutoVersion({ root = process.cwd(), sha }) {
  if (!/^[a-f0-9]{40}$/.test(sha || '')) fail('AUTO_VERSION_EVENT_SHA_REQUIRED');
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  const git = (...args) => execFileSync('git', ['-c', 'core.fsmonitor=false', ...args],
    { cwd: root, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  if (git('rev-parse', 'HEAD') !== sha) fail('AUTO_VERSION_EVENT_HEAD_MISMATCH');
  let parent;
  try { parent = git('rev-parse', '--verify', `${sha}^1`); }
  catch { fail('AUTO_VERSION_FIRST_PARENT_REQUIRED'); }
  const read = (revision, path) => {
    if (!/^100(?:644|755) blob /.test(git('ls-tree', revision, '--', path))) fail('AUTO_VERSION_REGULAR_FILE_REQUIRED: ' + path);
    return git('show', `${revision}:${path}`);
  };
  const json = (revision, path) => JSON.parse(read(revision, path));
  const path = 'packages/brain/package.json';
  const before = json(parent, path).version, current = json(sha, path).version;
  const previous = semver(before), next = semver(current);
  const difference = next.map((value, i) => value - previous[i]).find(value => value !== 0) || 0;
  if (difference < 0) fail('AUTO_VERSION_REGRESSION');

  // 六个实际发布文件；两个 lock 的嵌套版本也必须与 package.json 相同。
  const brainLock = json(sha, 'packages/brain/package-lock.json');
  const rootLock = json(sha, 'package-lock.json');
  // 当前声明紧随文档标题；后文历史条目可合法保留旧的“Brain 版本”行。
  const definition = read(sha, 'DEFINITION.md').match(/^# [^\n]+\n\s*\*\*Brain 版本\*\*: (\S+)[ \t]*(?:\r?\n|$)/);
  const versions = [brainLock.version, brainLock.packages?.['']?.version,
    rootLock.packages?.['packages/brain']?.version, read(sha, '.brain-versions'),
    read(sha, 'packages/brain/VERSION'), definition?.[1]];
  if (!versions.every(version => version === current)) fail('AUTO_VERSION_FILES_OUT_OF_SYNC');

  const fragments = git('ls-tree', '-r', '--name-only', sha, '--', 'changes').split('\n')
    .filter(file => /^changes\/[^/]+\.md$/.test(file) && file.toLowerCase() !== 'changes/readme.md');
  const ownCommit = /^chore\(brain\): auto-version(?:\s|$)/.test(git('log', '-1', '--format=%s', sha));
  const alreadyVersioned = difference > 0 && fragments.length === 0;
  return { skip: ownCommit || alreadyVersioned, reason: ownCommit ? 'auto_version_commit'
    : alreadyVersioned ? 'already_versioned' : 'normal_bump_policy', before, current, fragments: fragments.length };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const result = decideAutoVersion({ sha: process.argv[process.argv.indexOf('--sha') + 1] });
    process.stdout.write(`skip=${result.skip}\nreason=${result.reason}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
