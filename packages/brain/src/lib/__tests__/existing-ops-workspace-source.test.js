import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { buildExistingOpsSources } from './helpers/existing-ops-proof-builder.js';
import { collectWorkspaceInputEdges } from '../existing-ops-workspace-source.js';
import { parse, parse as acorn } from 'acorn';
import { readFileSync } from 'node:fs';
import { readNativeConsumerRuntime, assertNativeConsumerRuntime } from '../native-consumer-runtime.js';
import { buildExistingOpsSources as basicBuilder } from '../existing-ops-source.js';

const root = fileURLToPath(new URL('../../../../../', import.meta.url));
const revision = 'b5800c2d297cb121e90ff74987ebc410679371a2';
const paths = execFileSync('git', ['ls-tree', '-rz', '--name-only', revision], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
const cache = new Map();
const read = path => {
  if (!cache.has(path)) cache.set(path, execFileSync('git', ['show', `${revision}:${path}`], { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }));
  return cache.get(path);
};
const schema = 'packages/brain/src/lib/existing-ops-source.js';
const workflow = '.github/workflows/nightly-regression.yml';
const config = 'apps/api/vitest.config.ts';
const selected = 'apps/api/features/planning/pages/capability-system/InvocationPanel.test.tsx';
async function collectDefinition(overrides = {}, enabled = true) {
  return (await buildExistingOpsSources({ scope: 'cecelia-factory', repo: 'perfectuser21/cecelia', revision, paths,
    readSource: async path => overrides[path] ?? (path === schema && enabled
      ? read(path) + '\nexport const EXISTING_OPS_WORKSPACE_SELECTOR_SCHEMA = 1;' : read(path)) })).consumers[1];
}
const collect = overrides => collectWorkspaceInputEdges({ revision, paths,
  parse: text => parse(text, { ecmaVersion: 'latest', sourceType: 'module' }),
  readSource: async path => overrides?.[path] ?? read(path) });
describe('真实nightly workspace消费者来源', () => {
  it('独立图解析不能激活中央冻结合同之外的workspace绑定', async () => {
    const legacy = await collectDefinition({}, false);
    const marked = await collectDefinition();
    expect(marked.status).toBe('verified');
    expect(marked.bindings).toEqual(legacy.bindings);
    expect(marked.input_relations).toEqual(legacy.input_relations);
  });
  it('固定Git现有直接命令及字面量选择器证明前端测试输入，不把全部apps路径直接认领', async () => {
    const proof = await collect();
    expect(proof.length).toBeGreaterThan(0);
    expect(proof.map(b => b.dst_path)).toContain(selected);
    expect(proof).toContainEqual(expect.objectContaining({ src_path: workflow, dst_path: config }));
    expect(proof).toContainEqual(expect.objectContaining({ src_path: config, dst_path: selected }));
    expect(proof.map(b => b.dst_path)).not.toContain(selected.replace('.test.tsx', '.tsx'));
  });
  it('无marker固定旧来源不增加workspace绑定', async () => {
    const proof = await collectDefinition({}, false);
    expect(proof.status).toBe('verified');
    expect(proof.bindings.some(b => b.path.startsWith('apps/'))).toBe(false);
  });
  it('脚本替换不能扩大真实图消费者来源', async () => {
    const manifest = 'apps/api/package.json', pkg = JSON.parse(read(manifest));
    pkg.scripts.test = 'echo vitest run';
    await expect(collect({ [manifest]: JSON.stringify(pkg) })).rejects.toThrow(/workspace/i);
  });
  it('注释、未执行分支、条件步骤及改变cwd不能证明workspace命令', async () => {
    for (const change of [step => { step.run = '# ' + step.run; }, step => { step.run = 'if false; then ' + step.run + '; fi'; },
      step => { step.if = 'false'; }, step => { step['working-directory'] = 'packages/brain'; }]) {
      const doc = yaml.load(read(workflow));
      change(doc.jobs['workspace-test-nightly'].steps.find(s => s.name === 'Test apps/api'));
      await expect(collect({ [workflow]: yaml.dump(doc) })).rejects.toThrow(/workspace/i);
    }
  });
  it('真实exclude不选择文件，动态选择器及缺字节失败关闭', async () => {
    const excluded = await collect({ [config]: read(config).replace("exclude: ['node_modules'", "exclude: ['features/**', 'node_modules'") });
    expect(excluded.map(b => b.dst_path)).not.toContain(selected);
    for (const source of [read(config).replace("include: [", 'include: [process.env.TESTS,'), read(config).replace('defineConfig({', 'defineConfig({...dynamic,')]) {
      await expect(collect({ [config]: source })).rejects.toThrow(/workspace/i);
    }
    await expect(collect({ [selected]: '' })).rejects.toThrow(/workspace/i);
  });
});

// 新协议回归沿用既有受信测试路径，首棒不新增未认领文件。
{
// 固定 Git fixture 只验证解析机制，不能授予当前候选发布资格。
const root = fileURLToPath(new URL('../../../../../', import.meta.url));
const revision = 'f92e384cce2acd485beb319d2587e7c72da61fc3';
const paths = execFileSync('git', ['ls-tree', '-rz', '--name-only', revision], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
const cache = new Map();
const read = path => {
  if (!cache.has(path)) cache.set(path, execFileSync('git', ['show', `${revision}:${path}`], { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }));
  return cache.get(path);
};
const schema = 'packages/brain/src/lib/existing-ops-source.js';
const ci = '.github/workflows/ci.yml', runner = 'scripts/ci/run-basic-check.mjs';
const scope = 'scripts/ci/basic-scope.mjs', results = 'scripts/ci/check-basic-results.mjs';
const marker = '\nexport const EXISTING_OPS_BASIC_CI_SELECTOR_SCHEMA = 1;';
const parse = text => acorn(text, { ecmaVersion: 'latest', sourceType: 'module' });
const reader = overrides => async path => overrides[path] ?? (path === schema ? read(path) + marker : read(path));
const collect = (overrides = {}, missing = []) => basicBuilder({ scope: 'cecelia-factory', repo: 'perfectuser21/cecelia', revision,
  paths: paths.filter(path => !missing.includes(path)), readSource: reader(overrides) });
const workspace = (overrides = {}, missing = []) => collectWorkspaceInputEdges({ revision,
  paths: paths.filter(path => !missing.includes(path)), parse, readSource: reader(overrides) });
const mutateCi = fn => { const doc = yaml.load(read(ci)); fn(doc); return yaml.dump(doc); };
const apiInputs = ['apps/api/vitest.config.ts', 'apps/api/vitest.integration.config.ts',
  'apps/api/src/system/__tests__/memory.test.ts', 'apps/api/src/system/__tests__/planning.test.ts', 'apps/api/src/system/__tests__/dev-session.test.ts'];
// 显式下一版fixture，不依赖待合入工作树；仍只证明选择器，绝不授予当前发布资格。
const apiTuple = {
  'packages/brain/vitest.config.js': read('packages/brain/vitest.config.js').split('\n').filter(line => ![
    '// Pre-existing failures on main — 之前靠 vitest OOM worker 崩溃跳过被掩盖，',
    '// 现在 workers 稳定后暴露。已创 Brain task 追踪，不是本 PR scope。',
    '// watchdog-crisis-*: checkRunaways 返回 0 kills vs expected 1+（真实逻辑 bug）',
    "'src/__tests__/watchdog-crisis-kill.test.js',", "'src/__tests__/watchdog-crisis-min-rss.test.js',",
    '// Pre-existing failures: wrong import paths (../../brain/src/ instead of ../../packages/brain/src/)',
    '// Added to exclude list in skill-repo-decouple PR (not caused by this PR)',
    ...['diagnosis', 'escalation', 'healing', 'metrics', 'levels'].map(name => `'../../tests/alertness/${name}.test.js',`),
  ].includes(line.trim())).join('\n'),
  [ci]: mutateCi(doc => {
    doc.jobs.checks.services.postgres.image = "${{ (matrix.component == 'brain-integration' || matrix.component == 'api-integration') && 'mirror.gcr.io/pgvector/pgvector:pg15' || '' }}";
    doc.jobs.checks.env.API_PG_INTEGRATION = "${{ matrix.component == 'api-integration' && '1' || '0' }}";
  }),
  [scope]: read(scope).replace("'api', 'dashboard'", "'api', 'api-integration', 'dashboard'").replace("'api', 'ops'", "'api', 'api-integration', 'ops'"),
  [runner]: read(runner).replace("    case 'dashboard':", "    case 'api-integration':\n      return [step('apps/api', 'npx', '--no-install', 'vitest', 'run', '--config', 'vitest.integration.config.ts')];\n    case 'dashboard':"),
  'apps/api/vitest.config.ts': read('apps/api/vitest.config.ts').replace("exclude: ['node_modules', 'dist', '.idea', '.git', '.cache']", "exclude: [\n      'node_modules', 'dist', '.idea', '.git', '.cache',\n      'src/system/__tests__/memory.test.ts',\n      'src/system/__tests__/planning.test.ts',\n      'src/system/__tests__/dev-session.test.ts',\n    ]"),
  'apps/api/vitest.integration.config.ts': `import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'src/system/__tests__/memory.test.ts',
      'src/system/__tests__/planning.test.ts',
      'src/system/__tests__/dev-session.test.ts',
    ],
    // No fallback DB and no conditional skip: a selected PG lane must really run.
    env: { API_PG_INTEGRATION: '1' },
    fileParallelism: false,
    testTimeout: 10000,
    hookTimeout: 15000,
  },
});
`,
};
const collectApi = (overrides = {}) => basicBuilder({ scope: 'cecelia-factory', repo: 'perfectuser21/cecelia', revision,
  paths: [...new Set([...paths, ...apiInputs])], readSource: reader({...apiTuple, ...overrides}) });

describe('显式源码保底 CI 固定来源协议', () => {
  it('来源协议保持既有16文件信任边界且单模块不超过500行', () => {
    expect(readNativeConsumerRuntime().files).toHaveLength(16);
    for (const name of ['source', 'runtime-source', 'workspace-source', 'stage-source', 'stage-modes']) {
      const text = readFileSync(new URL(`../existing-ops-${name}.js`, import.meta.url), 'utf8');
      expect(text.trimEnd().split('\n').length, name).toBeLessThanOrEqual(500);
    }
  });
  it('已启用完整Engine组件时缺配置、目标测试或被执行脚本必须失败关闭', async () => {
    for (const missing of ['packages/engine/vitest.config.ts', 'packages/engine/tests/skills/worktree-cleanup-set-e.test.ts', 'packages/engine/skills/dev/scripts/worktree-manage.sh']) {
      await expect(workspace({}, [missing])).rejects.toThrow(/workspace/i);
    }
  });
  it('API专项完整tuple绑定独立PG配置与真实三文件，旧tuple混搭必须拒绝', async () => {
    const proof = await collectApi();
    expect(proof.consumers[1].status, JSON.stringify(proof.consumers[1].gaps)).toBe('verified');
    expect(proof.consumers[1].input_relations).toContainEqual({ consumer_path: runner, input_path: 'apps/api/vitest.integration.config.ts', kind: 'isolated_api_postgres_config', revision });
    for (const path of apiInputs.slice(2)) expect(proof.consumers[1].input_relations).toContainEqual({ consumer_path: 'apps/api/vitest.integration.config.ts', input_path: path, kind: 'literal_api_postgres_selector', revision });
    for (const path of [ci, scope, runner, 'packages/brain/vitest.config.js']) {
      const mixed = (await collectApi({[path]: read(path)})).consumers[1];
      expect(mixed.status).toBe('unknown'); expect(mixed.bindings).toEqual([]); expect(mixed.input_relations).toEqual([]);
    }
  }, 120000);
  it('运行进程完整封印协议所在消费者，固定源码字节被替换必须拒绝', async () => {
    const helper = 'packages/brain/src/lib/existing-ops-workspace-source.js';
    expect(readNativeConsumerRuntime().files).toHaveLength(16);
    expect(readNativeConsumerRuntime().files.map(file => file.path)).toContain(helper);
    await expect(assertNativeConsumerRuntime(async path => readFileSync(new URL(path, new URL('../../../../../', import.meta.url)), 'utf8') + (path === helper ? '\nthrow Error();' : ''))).rejects.toMatchObject({ code: 'IMPLEMENTATION_CI_SOURCE_RUNTIME_MISMATCH' });
  });
  it('新矩阵真实命令与Deep全PG分别绑定，部署只读guard仍保留完整封印', async () => {
    const proof = await collect();
    for (const consumer of proof.consumers) expect(consumer.status, JSON.stringify(consumer.gaps)).toBe('verified');
    const f3 = proof.consumers[1];
    for (const path of [scope, runner, results, 'scripts/ci/basic-runtime-smoke.mjs']) expect(f3.bindings.map(b => b.path)).toContain(path);
    expect(f3.input_relations).toContainEqual({ consumer_path: ci, input_path: runner, kind: 'required_basic_ci_matrix_runner', revision });
    expect(f3.input_relations).toContainEqual({ consumer_path: runner, input_path: 'scripts/ci/basic-runtime-smoke.mjs', kind: 'isolated_scratch_runtime_check', revision });
    expect(f3.input_relations).toContainEqual({ consumer_path: 'scripts/ci/deep-integration.config.mjs', input_path: 'packages/brain/src/routes/__tests__/integration/implementation-ci.test.js', kind: 'deep_postgres_config_input', revision });
    expect(f3.bindings.map(b => b.path)).not.toContain('packages/brain/vitest.integration.config.js');
    expect(f3.input_relations.some(r => r.input_path === 'packages/quality/skill-distillation/scripts/goldset-eval.mjs')).toBe(false);
    expect(f3.input_relations.some(r => r.input_path.endsWith('ci-aggregate-results.test.mjs'))).toBe(false);
    for (const workflow of proof.workflows) expect(workflow).toMatchObject({ executable: false, coverage: { status: 'unknown' } });
  }, 120000);
  it('新矩阵经真实engine命令产生配置与真实脚本执行边', async () => {
    const edges = await workspace();
    expect(edges).toContainEqual(expect.objectContaining({ src_path: runner, dst_path: 'packages/engine/vitest.config.ts' }));
    expect(edges).toContainEqual(expect.objectContaining({ src_path: 'packages/engine/tests/skills/worktree-cleanup-set-e.test.ts', dst_path: 'packages/engine/skills/dev/scripts/worktree-manage.sh' }));
    expect(edges.every(edge => /^[a-f0-9]{64}$/.test(edge.detail.consumer_sha256) && /^[a-f0-9]{64}$/.test(edge.detail.input_sha256))).toBe(true);
  }, 120000);
  for (const [label, override, missing] of [
    ['缺组件', { [scope]: () => read(scope).replace("'image', 'engine'", "'image'") }],
    ['少unit分片', { [scope]: () => read(scope).replace('length: 6', 'length: 5') }],
    ['替身命令', { [runner]: () => read(runner).replace("'vitest', 'run'", "'echo', 'run'") }],
    ['吞signal失败', { [runner]: () => read(runner).replace('if (result.signal)', 'if (false)') }],
    ['接受skipped/failure/cancel', { [results]: () => read(results).replace("!== 'success'", "=== 'missing'") }],
    ['汇总未required', { [ci]: () => mutateCi(doc => { doc.jobs['ci-passed'].needs = ['plan', 'security']; }) }],
    ['matrix被替换', { [ci]: () => mutateCi(doc => { doc.jobs.checks.strategy.matrix = { include: [{ component: 'scripts' }] }; }) }],
    ['未知环境', { [ci]: () => mutateCi(doc => { doc.env = { NODE_OPTIONS: '--import=./replacement.mjs' }; }) }],
    ['Brain配置注入未审setup', { 'packages/brain/vitest.config.js': () => read('packages/brain/vitest.config.js').replace('test: {', "test: { setupFiles: ['./replacement.mjs'],") }],
    ['Engine配置注入未审setup', { 'packages/engine/vitest.config.ts': () => read('packages/engine/vitest.config.ts').replace('test: {', "test: { setupFiles: ['./replacement.mjs'],") }],
    ['仓库登记篡改', { 'packages/brain/scripts/coding-workflow/repos.json': () => read('packages/brain/scripts/coding-workflow/repos.json').replace('源码保底通过', 'fake check') }],
    ['helper摘要变化', { 'scripts/ci/skill-source-tests.mjs': () => read('scripts/ci/skill-source-tests.mjs') + '\nthrow Error();' }],
    ['部署封印篡改', { 'scripts/brain-deploy.sh': () => read('scripts/brain-deploy.sh') + '\necho unreviewed' }],
    ['缺runner', {}, [runner]],
    ['未知marker', { [schema]: () => read(schema) + marker.replace('= 1', '= 2') }],
  ]) it(`${label}失败关闭并清空全部绑定和关系`, async () => {
    const overrides = Object.fromEntries(Object.entries(override).map(([path, value]) => [path, value()]));
    const proof = await collect(overrides, missing);
    const consumer = label === '部署封印篡改' ? proof.consumers[0] : proof.consumers[1];
    expect(consumer.status).toBe('unknown');
    expect(consumer.bindings).toEqual([]); expect(consumer.input_relations).toEqual([]);
    if (label !== '部署封印篡改' && label !== '仓库登记篡改' && label !== '未知marker' && !missing?.length) await expect(workspace(overrides)).rejects.toThrow();
  }, 120000);
});

}
