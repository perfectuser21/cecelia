import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectAuxiliarySourceEvidence, applyAuxiliarySourceEvidence } from '../../../../../scripts/ci/implementation-auxiliary-evidence.mjs';

const roots = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const owner = 'scripts/value.sh';
const test = 'scripts/__tests__/value.test.sh';

function fixture(row = { owner_path: owner, path: test, role: 'verification' }) {
  const root = mkdtempSync(join(tmpdir(), 'shell-verification-'));
  roots.push(root);
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git('init', '-q');
  git('config', 'user.email', 'ci@example.invalid');
  git('config', 'user.name', 'ci');
  git('remote', 'add', 'origin', 'https://github.com/example/repo.git');
  mkdirSync(join(root, 'scripts/__tests__'), { recursive: true });
  writeFileSync(join(root, owner), '#!/bin/bash\nset -euo pipefail\nprintf "%s\\n" "$(( $1 + 1 ))"\n');
  writeFileSync(join(root, test), '#!/bin/bash\nset -euo pipefail\n[[ "$(bash "$1" 4)" == 5 ]]\n');
  writeFileSync(join(root, 'scripts/other.sh'), '#!/bin/bash\nexit 0\n');
  writeFileSync(join(root, 'scripts/value.spec.sh'), '#!/bin/bash\nexit 0\n');
  git('add', '.');
  git('commit', '-qm', 'actual shell source');
  const base = git('rev-parse', 'HEAD');
  writeFileSync(join(root, '.implementation-source-relations.json'), JSON.stringify({ schema_version: 1, repo: 'example/repo', relations: [row] }));
  git('add', '.');
  git('commit', '-qm', 'declare shell regression owner');
  const head = git('rev-parse', 'HEAD');
  return { root, source: { repo: 'example/repo', base_revision: base, head_revision: head } };
}

it('固定 Git 中真实执行的 .test.sh 可以作为 verification，未认领 owner 仍不放行', () => {
  const f = fixture();
  execFileSync('bash', [join(f.root, test), join(f.root, owner)], { cwd: f.root });
  const evidence = collectAuxiliarySourceEvidence(f.root, f.source);
  expect(evidence.head.relations[0]).toMatchObject({ owner_path: owner, path: test, role: 'verification' });
  expect(evidence.head.relations[0].sha256).toMatch(/^[0-9a-f]{64}$/);
  const file = { change_index: 0, path: test, matched_paths: [], truncated: false };
  const report = {
    source: { ...f.source, changed_files: [{ path: test }] },
    base: { revision: f.source.base_revision, file_coverage: [{ ...file }] },
    head: { revision: f.source.head_revision, file_coverage: [{ ...file }] },
    gaps: [{ code: 'changed_file_unclaimed', path: test }],
    unclaimed_paths: [{ path: test }], mapping_status: 'unknown', affected_usages: [],
  };
  applyAuxiliarySourceEvidence(report, evidence, { base: [], head: [] });
  expect(report.unclaimed_paths).toEqual([{ path: test }]);
  expect(report.mapping_status).toBe('unknown');
});

it.each([
  [{ owner_path: owner, path: 'scripts/other.sh', role: 'verification' }, 'AUXILIARY_ROLE_INVALID'],
  [{ owner_path: owner, path: 'scripts/value.spec.sh', role: 'verification' }, 'AUXILIARY_ROLE_INVALID'],
  [{ owner_path: owner, path: '../escape.test.sh', role: 'verification' }, 'AUXILIARY_PATH_INVALID'],
  [{ owner_path: test, path: 'scripts/other.test.sh', role: 'verification' }, 'AUXILIARY_OWNER_INVALID'],
  [{ owner_path: owner, path: 'scripts/missing.test.sh', role: 'verification' }, 'AUXILIARY_SOURCE_MISSING'],
])('非法 shell 验证关系拒绝 %#', (row, error) => {
  const f = fixture(row);
  expect(() => collectAuxiliarySourceEvidence(f.root, f.source)).toThrow(error);
});
