// This only selects local tests; it does not approve source relationships.
// Unknown data returns nonzero so the caller runs the unchanged full suite.
import { execFileSync } from 'node:child_process';
const git = (...args) => execFileSync('git', ['--no-replace-objects', ...args], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
const canonical = value => JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))));
const safePath = p => typeof p === 'string' && /^[A-Za-z0-9_.@/-]+$/.test(p) && !p.startsWith('/') && !p.startsWith('-') && p.split('/').every(x => x && x !== '.' && x !== '..');
function manifest(revision) {
  const doc = JSON.parse(git('show', `${revision}:.implementation-source-relations.json`));
  if (!doc || Object.keys(doc).sort().join() !== 'relations,repo,schema_version' || doc.schema_version !== 1 || doc.repo !== 'perfectuser21/cecelia' || !Array.isArray(doc.relations)) throw Error('schema');
  const rows = new Map();
  for (const row of doc.relations) {
    if (!row || Object.keys(row).sort().join() !== 'owner_path,path,role' || typeof row.owner_path !== 'string' || typeof row.path !== 'string' || !['verification','release','documentation'].includes(row.role) || rows.has(row.path)) throw Error('relation');
    rows.set(row.path, row);
  }
  return rows;
}
function regular(revision, path) {
  if (!safePath(path)) return false;
  const output = git('ls-tree', '-z', revision, '--', path).split('\0').filter(Boolean);
  return output.length === 1 && /^(100644|100755) blob [a-f0-9]+\t/.test(output[0]) && output[0].split('\t')[1] === path;
}
try {
  const base = process.argv[2];
  if (!/^[a-f0-9]{40}$/.test(base || '')) throw Error('base');
  const head = git('rev-parse', 'HEAD').trim();
  const prior = manifest(base), current = manifest(head);
  for (const [path, row] of prior) if (!current.has(path) || canonical(row) !== canonical(current.get(path))) throw Error('changed_prior');
  const changed = new Set(git('diff', '--name-only', '-z', '--diff-filter=AM', base, head).split('\0').filter(Boolean));
  for (const [path, row] of current) {
    if (prior.has(path)) continue;
    if (!changed.has(path) || !regular(head, path) || !regular(head, row.owner_path)) throw Error('unbound');
    if (!/\.(?:[cm]?[jt]sx?|sh|py)$/.test(row.owner_path) || /\.(?:test|spec)\./.test(row.owner_path) || /(?:^|\/)(?:tests|__tests__)\//.test(row.owner_path)) throw Error('owner');
    const eligible = row.role === 'verification' ? /^packages\/brain\/src\/.*\.(?:test|spec)\.[cm]?[jt]s$/.test(path)
      : row.role === 'release' ? /^changes\/[^/]+\.md$/.test(path)
      : /^(?:\.dod\.md|\.prd\.md|docs\/learnings\/[^/]+\.md)$/.test(path);
    if (!eligible) throw Error('role_path');
  }
} catch {
  process.exitCode = 1;
}
