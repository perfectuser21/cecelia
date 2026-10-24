import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { buildExistingOpsSources } from '../existing-ops-source.js';
const root = fileURLToPath(new URL('../../../../../', import.meta.url));
const revision = '16a9032b8aed2ab8dfa65cc80b32f0321a76e9bd';
const prefix = 'packages/brain/scripts/coding-workflow/';
const selector = 'packages/brain/src/lib/existing-ops-runtime-source.js';
const test = prefix + '__tests__/qa-doc-assertion.test.mjs', report = prefix + 'lib/qa-report.mjs';
const doc = prefix + 'lib/qa-doc-assertion.mjs', helper = prefix + 'lib/qa-doc-data-proof.mjs';
const fixture = prefix + '__tests__/fixtures/qa-doc-data-commands.mjs';
const marker = '\nexport const EXISTING_OPS_DOC_IMPORT_SCHEMA = 1;\n';
const cache = new Map();
const git = path => {
  if (!cache.has(path)) cache.set(path, execFileSync('git', ['show', `${revision}:${path}`], { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }));
  return cache.get(path);
};
const paths = execFileSync('git', ['ls-tree', '-rz', '--name-only', revision], { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }).split('\0').filter(Boolean);
const additions = {
  [test]: `import { trivialAssertions } from '../lib/qa-report.mjs';\nimport { B2_T3 } from './fixtures/qa-doc-data-commands.mjs';\nexport const input = [trivialAssertions, B2_T3];`,
  [doc]: `import { proof } from './qa-doc-data-proof.mjs';\nexport const isReadonlyDocAssertion = proof;`,
  [helper]: `import { readonlyQaScript } from './readonly-qa-command.mjs';\nimport { parse } from 'acorn';\nexport const proof = [readonlyQaScript, parse];`,
  [fixture]: 'export const B2_T3 = "node -e data";\n',
};
async function proof({ schema = marker, overrides = {}, missing = [], enabled = true } = {}) {
  const texts = { ...additions, ...overrides };
  const result = await buildExistingOpsSources({ scope: 'cecelia-factory', repo: 'perfectuser21/cecelia', revision,
    paths: [...new Set([...paths, ...Object.keys(texts)])].filter(p => !missing.includes(p)),
    readSource: async path => path === selector ? git(path) + (enabled ? schema : '') : Object.hasOwn(texts, path) ? texts[path] : git(path),
  });
  return result.consumers.find(c => c.workflow_key === 'factory_f3_ops');
}
const edges = f3 => f3.input_relations.filter(e => e.kind === 'static_import_dependency');
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
describe('固定revision opt-in 文档静态import输入闭包（不执行候选代码）', () => {
  it('真实selector与whole qaReport前提认领fixture和多跳生产helper并封存字节', async () => {
    const f3 = await proof(); expect(f3.status, JSON.stringify(f3.gaps)).toBe('verified');
    for (const [consumer_path, input_path] of [[test, fixture], [test, report], [report, doc], [doc, helper], [helper, prefix + 'lib/readonly-qa-command.mjs']])
      expect(edges(f3)).toContainEqual({ consumer_path, input_path, kind: 'static_import_dependency', revision });
    for (const path of [doc, helper, fixture]) expect(f3.bindings.find(b => b.path === path)?.content_sha256).toBe(createHash('sha256').update(additions[path]).digest('hex'));
    expect(edges(f3).some(e => e.input_path === 'acorn')).toBe(false);
  });
  it('无marker旧图完整bindings和relations不受未读helper影响', async () => {
    const a = await proof({ enabled: false }), b = await proof({ enabled: false, overrides: { [helper]: 'throw Error("never run");' } });
    expect(a.status).toBe('verified'); expect(digest(a)).toBe(digest(b)); expect(edges(a)).toEqual([]);
  });
  it('被实际exclude排除的测试不成为closure入口', async () => {
    const f3 = await proof({ overrides: { 'packages/brain/vitest.config.js': git('packages/brain/vitest.config.js').replace('exclude: [', `exclude: ['scripts/coding-workflow/__tests__/qa-doc-assertion.test.mjs',`) } });
    expect(f3.status, JSON.stringify(f3.gaps)).toBe('verified'); expect(edges(f3)).toEqual([]);
  });
  it('注释与普通字符串不制造导入边', async () => {
    const f3 = await proof({ overrides: { [fixture]: '// import x from "./missing.mjs";\nexport const data = "import(unknown)";' } });
    expect(f3.status, JSON.stringify(f3.gaps)).toBe('verified'); expect(edges(f3).some(e => e.input_path.endsWith('missing.mjs'))).toBe(false);
  });
  it('循环及重复import有限去重且不执行候选throw', async () => {
    const f3 = await proof({ overrides: { [helper]: `import './qa-doc-assertion.mjs';\nimport './qa-doc-assertion.mjs';\nthrow Error('not executed');` } });
    expect(f3.status, JSON.stringify(f3.gaps)).toBe('verified'); expect(edges(f3).filter(e => e.consumer_path === helper && e.input_path === doc)).toHaveLength(1);
  });
  for (const [name, options] of [
    ['动态import', { overrides: { [helper]: 'export const x = import("./missing.mjs");' } }],
    ['不安全路径', { overrides: { [helper]: 'import x from "../../../../../../outside.mjs";' } }],
    ['非canonical路径', { overrides: { [helper]: 'import x from "./dir/../qa-doc-assertion.mjs";' } }],
    ['缺失blob', { missing: [fixture] }],
    ['未知bare依赖', { overrides: { [helper]: 'import x from "not-a-declared-dependency";' } }],
    ['超大闭包', { overrides: { [fixture]: '/*' + 'x'.repeat(2 * 1024 * 1024) + '*/' } }],
    ['whole qaReport漂移', { overrides: { [report]: git(report).replace('export const CANNOT_VERIFY', 'export let CANNOT_VERIFY') } }],
    ['未知schema', { schema: '\nexport const EXISTING_OPS_DOC_IMPORT_SCHEMA = 2;\n' }],
    ['动态schema', { schema: '\nexport const EXISTING_OPS_DOC_IMPORT_SCHEMA = Number(1);\n' }],
    ['可变schema', { schema: '\nexport let EXISTING_OPS_DOC_IMPORT_SCHEMA = 1;\n' }],
    ['重复schema', { schema: marker + marker }],
  ]) it(`${name}关闭证明且不留下部分新输入`, async () => {
    const f3 = await proof(options); expect(f3.status).toBe('unknown'); expect(f3.gaps.length).toBeGreaterThan(0);
    expect(edges(f3)).toEqual([]); expect(f3.bindings).toEqual([]);
  });
});
