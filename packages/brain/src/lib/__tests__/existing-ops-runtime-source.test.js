import { describe, it, expect } from 'vitest';
import { parse as acorn } from 'acorn';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { buildExistingOpsSources } from '../existing-ops-source.js';
import { runtimeSelectorEnabled } from '../existing-ops-runtime-source.js';
const parse = text => acorn(text, { ecmaVersion: 'latest', sourceType: 'module' });

describe('existing-ops-runtime-source 显式固定来源协议', () => {
  it('缺省、私有或注释标记不启用，合法 export const 1 才启用', () => {
    for (const text of ['', '// export const EXISTING_OPS_RUNTIME_SELECTOR_SCHEMA=1;',
      'const EXISTING_OPS_RUNTIME_SELECTOR_SCHEMA=1;', 'export const EXISTING_OPS_RUNTIME_SELECTOR_SCHEMA=0;'])
      expect(runtimeSelectorEnabled(text, parse)).toBe(false);
    expect(runtimeSelectorEnabled('export const EXISTING_OPS_RUNTIME_SELECTOR_SCHEMA=1;', parse)).toBe(true);
  });
  it('动态、可变、未知与重复声明不猜为可执行来源', () => {
    for (const text of ['export let EXISTING_OPS_RUNTIME_SELECTOR_SCHEMA=1;',
      'export const EXISTING_OPS_RUNTIME_SELECTOR_SCHEMA=2;',
      'export const EXISTING_OPS_RUNTIME_SELECTOR_SCHEMA=process.env.SCHEMA;',
      'export const EXISTING_OPS_RUNTIME_SELECTOR_SCHEMA=1; export const EXISTING_OPS_RUNTIME_SELECTOR_SCHEMA=0;'])
      expect(() => runtimeSelectorEnabled(text, parse)).toThrow();
  });
});

// 真实固定Git的aggregate reader链；只在IO边界模型化下一版协议，不执行被读源码。
const aggregateRevision = 'a31d0e477b855e2e71911cb9837bce9b87049c0a';
const aggregateRoot = fileURLToPath(new URL('../../../../../', import.meta.url));
const aggregateSchema = 'packages/brain/src/lib/existing-ops-source.js';
const aggregateReader = '.github/workflows/scripts/__tests__/ci-aggregate-results.test.mjs';
const aggregateCi = '.github/workflows/ci.yml';
const aggregateSmoke = '.github/workflows/ci-smoke-glob-runner.yml';
const aggregateMarker = 'export const EXISTING_OPS_AGGREGATE_SELECTOR_SCHEMA = 1;';
const gitCache = new Map();
const fixedGit = (revision, path) => {
  const key = `${revision}:${path}`;
  if (!gitCache.has(key)) gitCache.set(key, execFileSync('git', ['show', key], {
    cwd: aggregateRoot, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  }));
  return gitCache.get(key);
};
const gitPaths = revision => execFileSync('git', ['ls-tree', '-rz', '--name-only', revision], {
  cwd: aggregateRoot, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
}).split('\0').filter(Boolean);
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const frozenDigest = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
async function aggregateProof({ marker = aggregateMarker, reader, mutateCi, missing = [] } = {}) {
  const paths = gitPaths(aggregateRevision).filter(path => !missing.includes(path));
  return buildExistingOpsSources({ scope: 'cecelia-factory', repo: 'perfectuser21/cecelia', revision: aggregateRevision, paths,
    readSource: async path => {
      const original = fixedGit(aggregateRevision, path);
      if (path === aggregateSchema) return `${original}\n${marker}\n`;
      if (path === aggregateReader && reader) return reader(original);
      if (path === aggregateCi && mutateCi) {
        const doc = yaml.load(original); mutateCi(doc); return yaml.dump(doc, { lineWidth: -1 });
      }
      return original;
    },
  });
}
const aggregateF3 = proof => proof.consumers.find(c => c.workflow_key === 'factory_f3_ops');
const aggregateStep = doc => doc.jobs['lint-auto-merge-decision'].steps.find(s =>
  s.run === `node --test ${aggregateReader}`);

describe('aggregate固定Git输入协议', () => {
  it('旧正式a2冻结的两消费者bindings与input_relations逐字摘要保持不变', async () => {
    const revision = 'a2b043435339c90b40d6fa0c0df369d15b18eb49';
    const proof = await buildExistingOpsSources({ scope: 'cecelia-factory', repo: 'perfectuser21/cecelia', revision,
      paths: gitPaths(revision), readSource: async path => fixedGit(revision, path) });
    // 来自原官方a2已核验快照的固定值，不由被测collector重算期望。
    const expected = {
      factory_f2_ops: ['c47f73328384db508e4464ec3ef773ec68674b13e51e301e4e225938fa0d52ac', 'e498bcbf09220d962753f9b664ccef0531c37fb5dd424ad07811b464564e988b'],
      factory_f3_ops: ['90dfba1e4085412df18cd25ef8f7cfa1e0f5c560565996f272d512e37626120e', '6835844f71e2cbded8625c0283b0c5aa56b3f088a6d3febd7332f53f7b79eab5'],
    };
    for (const consumer of proof.consumers) {
      expect(consumer.status, JSON.stringify(consumer.gaps)).toBe('verified');
      expect([frozenDigest(consumer.bindings), frozenDigest(consumer.input_relations)]).toEqual(expected[consumer.workflow_key]);
    }
  }, 120000);
  it('新marker经真实required node入口和顶层loadGate绑定读入的两份workflow本体', async () => {
    const f3 = aggregateF3(await aggregateProof());
    expect(f3.status, JSON.stringify(f3.gaps)).toBe('verified');
    for (const path of [aggregateReader, aggregateCi, aggregateSmoke]) {
      expect(f3.bindings.find(b => b.path === path)).toMatchObject({ repo: 'perfectuser21/cecelia', revision: aggregateRevision,
        content_sha256: createHash('sha256').update(fixedGit(aggregateRevision, path)).digest('hex') });
    }
    expect(f3.input_relations).toContainEqual({ consumer_path: aggregateCi, input_path: aggregateReader,
      kind: 'required_node_test', revision: aggregateRevision });
    for (const path of [aggregateCi, aggregateSmoke]) expect(f3.input_relations).toContainEqual({ consumer_path: aggregateReader,
      input_path: path, kind: 'node_test_url_workflow_input', revision: aggregateRevision });
  }, 120000);
  it('仅注释与空白不改变AST执行链，binding仍封存实际读取字节', async () => {
    const reader = original => `// fixed-Git harmless comment\n${original}\n`;
    const f3 = aggregateF3(await aggregateProof({ reader }));
    expect(f3.status, JSON.stringify(f3.gaps)).toBe('verified');
    expect(f3.bindings.find(b => b.path === aggregateReader)?.content_sha256).toBe(
      createHash('sha256').update(reader(fixedGit(aggregateRevision, aggregateReader))).digest('hex'));
  }, 120000);
  for (const [label, options] of [
    ['CI聚合不再required', { mutateCi: doc => { doc.jobs['ci-passed'].needs = doc.jobs['ci-passed'].needs.filter(x => x !== 'lint-auto-merge-decision'); } }],
    ['入口改为条件执行', { mutateCi: doc => { aggregateStep(doc).if = 'false'; } }],
    ['入口吞掉失败', { mutateCi: doc => { aggregateStep(doc)['continue-on-error'] = true; } }],
    ['入口切换工作目录', { mutateCi: doc => { aggregateStep(doc)['working-directory'] = 'packages/brain'; } }],
    ['node命令不是实际reader', { mutateCi: doc => { aggregateStep(doc).run = 'node --test scripts/not-the-reader.test.mjs'; } }],
    ['reader仅在未调用函数中提到smoke', { reader: text => text.replace("const smoke = loadGate('ci-smoke-glob-runner.yml', 'smoke-glob-runner-passed');", "const smoke = () => loadGate('ci-smoke-glob-runner.yml', 'smoke-glob-runner-passed');") }],
    ['readFileSync导入身份被换掉', { reader: text => text.replace("import { readFileSync } from 'node:fs';", "import { readFileSync as otherReader } from 'node:fs';") }],
    ['URL输入未锚定import.meta.url', { reader: text => text.replace('import.meta.url', "'file:///not-the-fixed-reader.mjs'") }],
    ['顶层loadGate参数换为另一文件', { reader: text => text.replace("loadGate('ci-smoke-glob-runner.yml', 'smoke-glob-runner-passed')", "loadGate('unowned.yml', 'smoke-glob-runner-passed')") }],
    ['reader出现未经证明的控制流', { reader: text => `if (process.env.SKIP_REAL_TESTS) throw Error('skip');\n${text}` }],
    ['真实输入文件缺失', { missing: [aggregateSmoke] }],
    ['selector是未知版本', { marker: 'export const EXISTING_OPS_AGGREGATE_SELECTOR_SCHEMA = 2;' }],
    ['selector是可变声明', { marker: 'export let EXISTING_OPS_AGGREGATE_SELECTOR_SCHEMA = 1;' }],
    ['selector来自动态值', { marker: 'export const EXISTING_OPS_AGGREGATE_SELECTOR_SCHEMA = process.env.VERSION;' }],
  ]) it(`${label}必须保留UNKNOWN且不得留下可认领的部分绑定`, async () => {
    const f3 = aggregateF3(await aggregateProof(options));
    expect(f3.status).toBe('unknown'); expect(f3.gaps.length).toBeGreaterThan(0);
    expect(f3.bindings).toEqual([]); expect(f3.input_relations).toEqual([]);
  }, 120000);
  for (const marker of ['', '// export const EXISTING_OPS_AGGREGATE_SELECTOR_SCHEMA = 1;',
    'const EXISTING_OPS_AGGREGATE_SELECTOR_SCHEMA = 1;', 'export const EXISTING_OPS_AGGREGATE_SELECTOR_SCHEMA = 0;'])
    it(`未启用marker不向旧协议追加smoke绑定：${JSON.stringify(marker)}`, async () => {
      const f3 = aggregateF3(await aggregateProof({ marker }));
      expect(f3.status, JSON.stringify(f3.gaps)).toBe('verified');
      expect(f3.bindings.some(b => b.path === aggregateReader || b.path === aggregateSmoke)).toBe(false);
    }, 120000);
});


const goldsetEntry = 'packages/quality/skill-distillation/scripts/goldset-eval.mjs';
const goldsetMarker = 'export const EXISTING_OPS_GOLDSET_SELECTOR_SCHEMA = 1;';
const goldsetStep = doc => doc.jobs['goldset-eval'].steps.find(s => s.run === `node ${goldsetEntry}`);
const goldsetProof = (options = {}) => aggregateProof({ marker: goldsetMarker, ...options });

describe('goldset固定Git条件入口协议', () => {
  it('独立marker仅绑定真实conditional required node入口，不认领整个quality目录', async () => {
    const f3 = aggregateF3(await goldsetProof());
    expect(f3.status, JSON.stringify(f3.gaps)).toBe('verified');
    expect(f3.bindings.find(b => b.path === goldsetEntry)).toMatchObject({ repo: 'perfectuser21/cecelia', revision: aggregateRevision,
      content_sha256: createHash('sha256').update(fixedGit(aggregateRevision, goldsetEntry)).digest('hex') });
    expect(f3.input_relations).toContainEqual({ consumer_path: aggregateCi, input_path: goldsetEntry,
      kind: 'conditional_required_node_entry', revision: aggregateRevision });
    expect(f3.bindings.some(b => b.path === aggregateReader || b.path === aggregateSmoke)).toBe(false);
    // judge 的真实 ESM import 由现有原生依赖图追踪；此协议不伪造二进制资产文本摘要。
    expect(f3.bindings.filter(b => b.path.startsWith('packages/quality/')) .map(b => b.path)).toEqual([goldsetEntry]);
  }, 120000);
  it('两个独立marker同时启用时分别保留真实入口关系', async () => {
    const f3 = aggregateF3(await aggregateProof({ marker: `${aggregateMarker}\n${goldsetMarker}` }));
    expect(f3.status, JSON.stringify(f3.gaps)).toBe('verified');
    expect(f3.input_relations).toContainEqual({ consumer_path: aggregateCi, input_path: goldsetEntry,
      kind: 'conditional_required_node_entry', revision: aggregateRevision });
    expect(f3.bindings.some(b => b.path === aggregateSmoke)).toBe(true);
  }, 120000);
  for (const [label, options] of [
    ['CI aggregate不再要求goldset结果', { mutateCi: doc => { doc.jobs['ci-passed'].needs = doc.jobs['ci-passed'].needs.filter(x => x !== 'goldset-eval'); } }],
    ['不再依赖实际changes输出', { mutateCi: doc => { doc.jobs['goldset-eval'].needs = []; } }],
    ['条件被改成无条件', { mutateCi: doc => { delete doc.jobs['goldset-eval'].if; } }],
    ['条件引用另一输出', { mutateCi: doc => { doc.jobs['goldset-eval'].if = "needs.changes.outputs.quality == 'true'"; } }],
    ['入口步骤可被跳过', { mutateCi: doc => { goldsetStep(doc).if = 'false'; } }],
    ['入口忽略执行失败', { mutateCi: doc => { goldsetStep(doc)['continue-on-error'] = true; } }],
    ['job忽略执行失败', { mutateCi: doc => { doc.jobs['goldset-eval']['continue-on-error'] = true; } }],
    ['入口离开root工作目录', { mutateCi: doc => { goldsetStep(doc)['working-directory'] = 'packages/quality'; } }],
    ['job defaults改变实际执行目录', { mutateCi: doc => { doc.jobs['goldset-eval'].defaults = { run: { 'working-directory': 'packages/quality' } }; } }],
    ['node argv不再指向实际入口', { mutateCi: doc => { goldsetStep(doc).run = 'node packages/quality/not-the-entry.mjs'; } }],
    ['入口已不存在', { missing: [goldsetEntry] }],
    ['selector为未知版本', { marker: 'export const EXISTING_OPS_GOLDSET_SELECTOR_SCHEMA = 2;' }],
    ['selector为可变声明', { marker: 'export let EXISTING_OPS_GOLDSET_SELECTOR_SCHEMA = 1;' }],
    ['selector来自动态值', { marker: 'export const EXISTING_OPS_GOLDSET_SELECTOR_SCHEMA = process.env.VERSION;' }],
  ]) it(`${label}必须UNKNOWN且不得留下部分认领`, async () => {
    const f3 = aggregateF3(await goldsetProof(options));
    expect(f3.status).toBe('unknown'); expect(f3.gaps.length).toBeGreaterThan(0);
    expect(f3.bindings).toEqual([]); expect(f3.input_relations).toEqual([]);
  }, 120000);
  for (const marker of ['', '// export const EXISTING_OPS_GOLDSET_SELECTOR_SCHEMA = 1;',
    'const EXISTING_OPS_GOLDSET_SELECTOR_SCHEMA = 1;', 'export const EXISTING_OPS_GOLDSET_SELECTOR_SCHEMA = 0;'])
    it(`未启用goldset marker保留旧协议：${JSON.stringify(marker)}`, async () => {
      const f3 = aggregateF3(await goldsetProof({ marker }));
      expect(f3.status, JSON.stringify(f3.gaps)).toBe('verified');
      expect(f3.bindings.some(b => b.path === goldsetEntry)).toBe(false);
    }, 120000);
});
