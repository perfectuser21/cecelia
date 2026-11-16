import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { privateFixtureDatabase } from '../fixtures/private-fixture-db.js';
import { scanRepo, scanRepoList } from '../../../../../scripts/scan/scan-graph.mjs';

let fixture, directory;
afterEach(async () => { try { await fixture?.close(); } finally { if (directory) rmSync(directory, { recursive: true, force: true }); } });
it('真实三Git仓扫描同名入口不串仓，单仓新提交重扫保留另仓边和原版本快照', async () => {
  fixture = await privateFixtureDatabase('orggraph', db => db.query(`
    CREATE TABLE graph_edges(repo text,src_path text,dst_path text,edge_type text,detail jsonb,source_revision text,scanner_version text);
    CREATE TABLE graph_snapshot_versions(repo text,source_revision text,scanner_version text,scanned_at timestamptz,row_count int,PRIMARY KEY(repo,source_revision));
    CREATE TABLE graph_edge_snapshots(repo text,source_revision text,src_path text,dst_path text,edge_type text,detail jsonb);
    CREATE TABLE fact_snapshot_headers(kind text,repo text,source_revision text,scanner_version text,scanned_at timestamptz,row_count int,PRIMARY KEY(kind,repo));
  `));
  directory = mkdtempSync(join(tmpdir(), 'org-graph-git-'));
  const git = (root, args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const repos = ['cecelia', 'zenithjoy-workspace', 'zenithjoy-skills'].map((name, index) => {
    const root = join(directory, name); mkdirSync(root);
    git(root, ['init', '-q']);
    writeFileSync(join(root, 'package.json'), '{"type":"module"}');
    writeFileSync(join(root, 'entry.js'), `import './unique-${index}.js';\n`);
    writeFileSync(join(root, `unique-${index}.js`), 'export const value = 1;\n');
    git(root, ['add', '.']);
    git(root, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'initial fixture']);
    return { name, root, revision: git(root, ['rev-parse', 'HEAD']) };
  });
  const results = await scanRepoList(repos, fixture.db);
  expect(results.every(result => !result.error && result.inserted === 1)).toBe(true);
  const rows = (await fixture.db.query('SELECT repo,src_path,dst_path,source_revision FROM graph_edges ORDER BY repo')).rows;
  expect(rows.map(row => ({ ...row, dst_path: basename(row.dst_path) }))).toEqual(repos.map((repo, index) => ({ repo: repo.name, src_path: 'entry.js', dst_path: `unique-${index}.js`, source_revision: repo.revision })).sort((a, b) => a.repo.localeCompare(b.repo)));
  for (const row of rows) {
    const repo = repos.find(repo => repo.name === row.repo);
    expect(realpathSync(resolve(row.dst_path))).toBe(realpathSync(join(repo.root, basename(row.dst_path))));
  }
  writeFileSync(join(repos[0].root, 'entry.js'), "import './new-target.js';\n");
  writeFileSync(join(repos[0].root, 'new-target.js'), 'export const changed = true;\n');
  git(repos[0].root, ['add', '.']);
  git(repos[0].root, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'replace import']);
  const rescanned = await scanRepo(repos[0], fixture.db);
  expect(rescanned.error).toBeUndefined();
  expect((await fixture.db.query('SELECT dst_path FROM graph_edges WHERE repo=$1', [repos[0].name])).rows.map(row => basename(row.dst_path))).toEqual(['new-target.js']);
  expect((await fixture.db.query('SELECT repo,src_path,dst_path,source_revision FROM graph_edges WHERE repo<>$1 ORDER BY repo', [repos[0].name])).rows).toEqual(rows.slice(1));
  expect((await fixture.db.query('SELECT dst_path FROM graph_edge_snapshots WHERE repo=$1 AND source_revision=$2', [repos[0].name, repos[0].revision])).rows.map(row => basename(row.dst_path))).toEqual(['unique-0.js']);
});
