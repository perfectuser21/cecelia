import { afterEach, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import yaml from 'js-yaml';
import * as auxiliary from '../../../../../scripts/ci/implementation-auxiliary-evidence.mjs';

const roots = [];
const row = (path, role = 'documentation') => ({ owner_path: 'src/controller.js', path, role });
const transient = ['.prd-cp-fixture.md', '.dod-cp-fixture.md'];
function fixture(rows = [...transient.map(path => row(path)), row('docs/persistent.md')]) {
  const root = mkdtempSync(join(tmpdir(), 'cleanup-source-'));
  roots.push(root);
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git('init', '-q'); git('config', 'user.email', 'ci@example.invalid'); git('config', 'user.name', 'ci');
  git('remote', 'add', 'origin', 'https://github.com/example/repo.git');
  mkdirSync(join(root, 'src')); writeFileSync(join(root, 'src/controller.js'), 'export const value=1;\n');
  for (const item of rows) {
    mkdirSync(join(root, item.path, '..'), { recursive: true });
    writeFileSync(join(root, item.path), 'actual tracked artifact\n');
  }
  const text = '{"schema_version":1,"repo":"example/repo","relations":[\n'
    + rows.map(item => JSON.stringify(item)).join(',\n') + '\n]}\n';
  writeFileSync(join(root, auxiliary.SOURCE_RELATIONS_PATH), text);
  git('add', '.'); git('commit', '-qm', 'actual before cleanup');
  return { root, git, text, rows };
}
function assertHead(f) {
  const revision = f.git('rev-parse', 'HEAD');
  return auxiliary.collectAuxiliarySourceEvidence(f.root, {
    repo: 'example/repo', base_revision: revision, head_revision: revision,
  });
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

it('真实Git删除瞬态文档后只退役实际删除声明，提交后的HEAD来源完整', () => {
  const f = fixture();
  f.git('rm', '--', transient[0]);
  const output = auxiliary.removeDeletedArtifactRelations(f.text, [transient[0]]);
  expect(JSON.parse(output).relations).toEqual(f.rows.slice(1));
  expect(output).toContain(JSON.stringify(f.rows[1]));
  expect(output).toContain(JSON.stringify(f.rows[2]));
  writeFileSync(join(f.root, auxiliary.SOURCE_RELATIONS_PATH), output);
  f.git('add', auxiliary.SOURCE_RELATIONS_PATH); f.git('commit', '-qm', 'atomic cleanup');
  expect(assertHead(f).head.relations).toHaveLength(2);
  expect(existsSync(join(f.root, transient[0]))).toBe(false);
});
it('未删除瞬态文档和持久文档原始字节受保护，空删除清单无变化', () => {
  const f = fixture();
  expect(auxiliary.removeDeletedArtifactRelations(f.text, [])).toBe(f.text);
  expect(auxiliary.removeDeletedArtifactRelations(f.text, ['docs/persistent.md'])).toBe(f.text);
  const output = auxiliary.removeDeletedArtifactRelations(f.text, [transient[0]]);
  expect(output).toContain(JSON.stringify(row(transient[1])));
  expect(output).toContain(JSON.stringify(row('docs/persistent.md')));
});
it('实际删除release的已有语义保留，未删release不被消费', () => {
  const f = fixture([row('changes/consumed.md', 'release'), row('changes/kept.md', 'release')]);
  const output = auxiliary.removeDeletedArtifactRelations(f.text, ['changes/consumed.md']);
  expect(JSON.parse(output).relations).toEqual([f.rows[1]]);
  expect(output).toContain(JSON.stringify(f.rows[1]));
});
it('非法角色和重复JSON键不能被退役helper洗掉', () => {
  const f = fixture();
  expect(() => auxiliary.removeDeletedArtifactRelations(f.text.replace('documentation', 'unknown'), transient)).toThrow();
  expect(() => auxiliary.removeDeletedArtifactRelations(f.text.replace('"schema_version":1', '"schema_version":1,"schema_version":1'), transient)).toThrow();
});
it('执行真实cleanup工作流删除步骤，文档与声明同一Git提交且持久文档保留', () => {
  const f = fixture();
  const workflow = yaml.load(readFileSync(new URL('../../../../../.github/workflows/cleanup-merged-artifacts.yml', import.meta.url), 'utf8'));
  const step = workflow.jobs.cleanup.steps.find(item => item.id === 'cleanup');
  const helper = new URL('../../../../../scripts/ci/implementation-auxiliary-evidence.mjs', import.meta.url).href;
  const run = step.run.replaceAll("'./scripts/ci/implementation-auxiliary-evidence.mjs'", JSON.stringify(helper));
  execFileSync('bash', ['-e', '-c', run], { cwd: f.root, env: { ...process.env, GITHUB_OUTPUT: join(f.root, 'github-output') }, encoding: 'utf8' });
  for (const path of transient) expect(existsSync(join(f.root, path))).toBe(false);
  expect(existsSync(join(f.root, 'docs/persistent.md'))).toBe(true);
  expect(f.git('diff', '--cached', '--name-only')).toContain(auxiliary.SOURCE_RELATIONS_PATH);
  f.git('commit', '-qm', 'actual workflow atomic commit');
  expect(assertHead(f).head.relations.map(item => item.path)).toEqual(['docs/persistent.md']);
});
