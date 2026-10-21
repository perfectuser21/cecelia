import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import yaml from 'js-yaml';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const workflow = yaml.load(readFileSync(join(repo, '.github/workflows/auto-version.yml'), 'utf8'));
const roots = [];
const git = (root, ...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
function put(root, path, text) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}
function versions(root, version) {
  put(root, 'packages/brain/package.json', JSON.stringify({ version }));
  put(root, 'packages/brain/package-lock.json', JSON.stringify({ version, packages: { '': { version } } }));
  put(root, 'package-lock.json', JSON.stringify({ packages: { 'packages/brain': { version } } }));
  put(root, '.brain-versions', version + '\n');
  put(root, 'packages/brain/VERSION', version + '\n');
  put(root, 'DEFINITION.md', `# Definition\n\n**Brain 版本**: ${version}\n`);
}
function commit(root, message) {
  git(root, 'add', '.');
  git(root, '-c', 'user.name=Regression', '-c', 'user.email=regression@example.invalid', 'commit', '-qm', message);
  return git(root, 'rev-parse', 'HEAD');
}
function fixture({ before = '1.445.49', after = '1.445.50', message = 'fix(brain): trusted staging source', edit, noParent = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'auto-version-decision-')); roots.push(root);
  git(root, 'init', '-q'); versions(root, before);
  if (!noParent) commit(root, 'baseline');
  versions(root, after); put(root, 'packages/brain/src/change.js', 'export const changed = true;\n');
  if (edit) edit(root);
  const sha = commit(root, message);
  return { root, sha };
}
// Execute the real workflow's check, type and apply commands against real Git commits.
// The remote PR step is never executed; its actual condition decides whether it would run.
function run(f, eventSha = f.sha) {
  const outputs = {};
  const condition = text => !text || Function(`return (${text.replace(/steps\.(\w+)\.outputs\.(\w+)/g,
    (_, step, key) => JSON.stringify(outputs[step]?.[key] ?? ''))})`)();
  let createWouldRun = false;
  for (const step of workflow.jobs.bump.steps) {
    if (!step.run || !condition(step.if)) continue;
    if (step.name === 'Create version bump PR') { createWouldRun = true; continue; }
    const output = join(f.root, '.step-output'); writeFileSync(output, '');
    const command = step.run.replace(/\$\{\{\s*steps\.(\w+)\.outputs\.(\w+)\s*\}\}/g,
      (_, name, key) => outputs[name]?.[key] ?? '')
      .replaceAll('node packages/brain/scripts/', `node ${repo}/packages/brain/scripts/`);
    const result = spawnSync('bash', ['-eo', 'pipefail', '-c', command], { cwd: f.root,
      env: { ...process.env, GITHUB_SHA: eventSha, GITHUB_OUTPUT: output }, encoding: 'utf8' });
    if (result.status !== 0) return { status: result.status, error: result.stderr, createWouldRun: false };
    if (step.id) outputs[step.id] = Object.fromEntries(readFileSync(output, 'utf8').trim().split('\n').filter(Boolean).map(line => line.split('=')));
  }
  return { status: 0, createWouldRun, outputs, version: JSON.parse(readFileSync(join(f.root, 'packages/brain/package.json'))).version };
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe('auto-version real workflow admission', () => {
  it('6592 reproduction: source plus synchronized 49→50 must not create redundant 51 PR', () => {
    const result = run(fixture());
    expect(result.status).toBe(0);
    expect(result.version).toBe('1.445.50');
    expect(result.createWouldRun).toBe(false);
  });
  it.each([
    ['fix(brain): source without version', '1.445.50'],
    ['feat(brain): source without version', '1.446.0'],
    ['feat(brain)!: breaking source without version', '2.0.0'],
  ])('still automatically versions unbumped %s', (message, version) => {
    const result = run(fixture({ after: '1.445.49', message }));
    expect(result.status).toBe(0); expect(result.version).toBe(version); expect(result.createWouldRun).toBe(true);
  });
  it('numeric comparison accepts patch 9→10 and does not infer a bump from package metadata', () => {
    expect(run(fixture({ before: '1.0.9', after: '1.0.10' })).createWouldRun).toBe(false);
    const result = run(fixture({ after: '1.445.49', edit: root => put(root, 'packages/brain/package.json', JSON.stringify({ version: '1.445.49', description: 'changed' })) }));
    expect(result.version).toBe('1.445.50'); expect(result.createWouldRun).toBe(true);
  });
  it('keeps pending fragment consumption even when the triggering commit increased the version', () => {
    const f = fixture({ edit: root => put(root, 'changes/feature.md', '## Brain {VERSION} — pending\n- change\n') });
    const result = run(f);
    expect(result.status).toBe(0); expect(result.version).toBe('1.445.51'); expect(result.createWouldRun).toBe(true);
    expect(existsSync(join(f.root, 'changes/feature.md'))).toBe(false);
    expect(readFileSync(join(f.root, 'DEFINITION.md'), 'utf8')).toContain('## Brain 1.445.51 — pending');
  });
  it('does not treat changes README as pending work and does not recurse on its own PR', () => {
    expect(run(fixture({ edit: root => put(root, 'changes/README.md', 'instructions') })).createWouldRun).toBe(false);
    expect(run(fixture({ message: 'chore(brain): auto-version patch bump to 1.445.50 (#6593)' })).createWouldRun).toBe(false);
  });
  it('reads the current DEFINITION declaration without rejecting historical version entries in real 6592', () => {
    const f = fixture({ edit: root => put(root, 'DEFINITION.md', '# Definition\n\n**Brain 版本**: 1.445.50\n\n## History\n**Brain 版本**: 1.368.1\n') });
    const result = run(f);
    expect(result.status).toBe(0); expect(result.version).toBe('1.445.50'); expect(result.createWouldRun).toBe(false);
  });
  it.each([
    ['missing first parent', { noParent: true }],
    ['malformed version', { after: '1.445.nope' }],
    ['regressed version', { after: '1.445.48' }],
    ['partial synchronization', { edit: root => put(root, 'packages/brain/VERSION', '1.445.49\n') }],
    ['root workspace lock drift', { edit: root => put(root, 'package-lock.json', JSON.stringify({ packages: { 'packages/brain': { version: '1.445.49' } } })) }],
    ['nested brain lock drift', { edit: root => put(root, 'packages/brain/package-lock.json', JSON.stringify({ version: '1.445.50', packages: { '': { version: '1.445.49' } } })) }],
    ['brain marker drift', { edit: root => put(root, '.brain-versions', '1.445.49\n') }],
    ['current definition drift', { edit: root => put(root, 'DEFINITION.md', '# Definition\n\n**Brain 版本**: 1.445.49\n') }],
    ['missing current declaration with matching historical entry', { edit: root => put(root, 'DEFINITION.md', '# Definition\n\n## History\n**Brain 版本**: 1.445.50\n') }],
  ])('fails closed before writes or PR creation for %s', (_, options) => {
    const f = fixture(options); const before = readFileSync(join(f.root, 'packages/brain/package.json'), 'utf8');
    const result = run(f);
    expect(result.status).not.toBe(0); expect(result.createWouldRun).toBe(false);
    expect(readFileSync(join(f.root, 'packages/brain/package.json'), 'utf8')).toBe(before);
  });
  it('rejects an absent or mismatched fixed event SHA instead of applying a plan to another HEAD', () => {
    const f = fixture();
    expect(run(f, '').status).not.toBe(0);
    expect(run(f, git(f.root, 'rev-parse', 'HEAD^')).status).not.toBe(0);
  });
});
