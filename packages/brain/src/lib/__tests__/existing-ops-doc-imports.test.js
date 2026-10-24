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
  // 固定b0原Git blob数据，不依赖未发布的本地Git对象，也不执行命令文本。
  const realFixture = "// 真实 B 原生命令惰性原件；测试只在独立临时目录运行静态文档脚本。\nexport const B2_T3 = {\"command\": \"node -e 'const fs=require(\\\"fs\\\");const p=\\\"packages/brain/scripts/coding-workflow/runner/README.md\\\";const s=fs.readFileSync(p,\\\"utf8\\\");const n=fs.readFileSync(\\\"packages/brain/scripts/coding-workflow/new-task.mjs\\\",\\\"utf8\\\");for(const x of [\\\"去掉 `--dry-run`\\\",\\\"POST /api/brain/projects\\\",\\\"POST /api/brain/tasks\\\",\\\"name\\\",\\\"description\\\",\\\"task_type: coding_workflow\\\",\\\"mutation_intent: write\\\",\\\"repo_hint\\\",\\\"map_scope_hint\\\",\\\"gp_anchor\\\",\\\"acceptance\\\",\\\"[{key,id,title}]\\\",\\\"task_route_mismatch\\\",\\\"失败对象自身\\\",\\\"已建\\\",\\\"没有返回 ID\\\",\\\"项目名称、任务标题\\\",\\\"不要整批盲重跑\\\",\\\"不执行真实建单、不访问生产\\\",\\\"## 运行回执如何判读\\\"])if(!s.includes(x))throw Error(x);for(const x of [\\\"function body\\\",\\\"payload.depends_on = t.depends_on.map\\\",\\\"async function postJson\\\",\\\"method:\\\",\\\"headers:\\\",\\\"${base}/projects\\\",\\\"${base}/tasks\\\",\\\"task_route_mismatch\\\",\\\"const created = []\\\"])if(!n.includes(x))throw Error(x);console.log(\\\"Q-3 提交、部分失败核账与原回执章节核对通过\\\")'\", \"script\": \"const fs=require(\\\"fs\\\");const p=\\\"packages/brain/scripts/coding-workflow/runner/README.md\\\";const s=fs.readFileSync(p,\\\"utf8\\\");const n=fs.readFileSync(\\\"packages/brain/scripts/coding-workflow/new-task.mjs\\\",\\\"utf8\\\");for(const x of [\\\"去掉 `--dry-run`\\\",\\\"POST /api/brain/projects\\\",\\\"POST /api/brain/tasks\\\",\\\"name\\\",\\\"description\\\",\\\"task_type: coding_workflow\\\",\\\"mutation_intent: write\\\",\\\"repo_hint\\\",\\\"map_scope_hint\\\",\\\"gp_anchor\\\",\\\"acceptance\\\",\\\"[{key,id,title}]\\\",\\\"task_route_mismatch\\\",\\\"失败对象自身\\\",\\\"已建\\\",\\\"没有返回 ID\\\",\\\"项目名称、任务标题\\\",\\\"不要整批盲重跑\\\",\\\"不执行真实建单、不访问生产\\\",\\\"## 运行回执如何判读\\\"])if(!s.includes(x))throw Error(x);for(const x of [\\\"function body\\\",\\\"payload.depends_on = t.depends_on.map\\\",\\\"async function postJson\\\",\\\"method:\\\",\\\"headers:\\\",\\\"${base}/projects\\\",\\\"${base}/tasks\\\",\\\"task_route_mismatch\\\",\\\"const created = []\\\"])if(!n.includes(x))throw Error(x);console.log(\\\"Q-3 提交、部分失败核账与原回执章节核对通过\\\")\"};\nexport const B3_T1 = {\"command\": \"node -e 'const fs=require(\\\"fs\\\");const p=\\\"packages/brain/scripts/coding-workflow/runner/README.md\\\";const s=fs.readFileSync(p,\\\"utf8\\\");const n=fs.readFileSync(\\\"packages/brain/scripts/coding-workflow/new-task.mjs\\\",\\\"utf8\\\");const r=fs.readFileSync(\\\"packages/brain/scripts/coding-workflow/runner/lib/repos.mjs\\\",\\\"utf8\\\");const cut=s.split(\\\"### 单任务示例\\\")[1].split(\\\"### 两任务批次示例\\\")[0];const b=cut.split(String.fromCharCode(96).repeat(3)+\\\"json\\\")[1].split(String.fromCharCode(96).repeat(3))[0];const j=JSON.parse(b);for(const x of [\\\"title\\\",\\\"change_kind\\\",\\\"map_scope_hint\\\",\\\"acceptance\\\",\\\"repo\\\",\\\"gp_anchor\\\"])if(!j[x]||(Array.isArray(j[x])&&!j[x].length))throw Error(x);if(j.repo!==\\\"cecelia\\\"||j.gp_anchor!==\\\"none(docs)\\\"||j.map_scope_hint[0]!==\\\"F1\\\")throw Error(\\\"示例值\\\");for(const x of [\\\"node packages/brain/scripts/coding-workflow/new-task.mjs <plan.json> --repo cecelia --dry-run\\\",\\\"不创建任务\\\",\\\"不证明真实提交成功\\\",\\\"40 位小写十六进制\\\",\\\"不验证该 SHA 存在\\\",\\\"条目 repo → 计划顶层 repo → 命令行 --repo → 默认 cecelia\\\",\\\"读不了计划文件\\\",\\\"计划不合格\\\",\\\"退出码 2\\\",\\\"未知仓库\\\"])if(!s.includes(x))throw Error(x);for(const x of [\\\"function parseArgs\\\",\\\"JSON.parse(fs.readFileSync(file\\\",\\\"读不了计划文件\\\",\\\"return 2\\\",\\\"validatePlan(plan\\\",\\\"计划不合格\\\",\\\"if (dryRun)\\\",\\\"resolveRepo(wanted, repos)\\\",\\\"/^[a-f0-9]{40}$/\\\"])if(!n.includes(x))throw Error(x);for(const x of [\\\"export function resolveRepo\\\",\\\"r.default\\\",\\\"return hit?.key ?? null\\\"])if(!r.includes(x))throw Error(x);console.log(\\\"Q-1 单任务示例及用户预检说明符合当前 CLI 源码\\\")'\", \"script\": \"const fs=require(\\\"fs\\\");const p=\\\"packages/brain/scripts/coding-workflow/runner/README.md\\\";const s=fs.readFileSync(p,\\\"utf8\\\");const n=fs.readFileSync(\\\"packages/brain/scripts/coding-workflow/new-task.mjs\\\",\\\"utf8\\\");const r=fs.readFileSync(\\\"packages/brain/scripts/coding-workflow/runner/lib/repos.mjs\\\",\\\"utf8\\\");const cut=s.split(\\\"### 单任务示例\\\")[1].split(\\\"### 两任务批次示例\\\")[0];const b=cut.split(String.fromCharCode(96).repeat(3)+\\\"json\\\")[1].split(String.fromCharCode(96).repeat(3))[0];const j=JSON.parse(b);for(const x of [\\\"title\\\",\\\"change_kind\\\",\\\"map_scope_hint\\\",\\\"acceptance\\\",\\\"repo\\\",\\\"gp_anchor\\\"])if(!j[x]||(Array.isArray(j[x])&&!j[x].length))throw Error(x);if(j.repo!==\\\"cecelia\\\"||j.gp_anchor!==\\\"none(docs)\\\"||j.map_scope_hint[0]!==\\\"F1\\\")throw Error(\\\"示例值\\\");for(const x of [\\\"node packages/brain/scripts/coding-workflow/new-task.mjs <plan.json> --repo cecelia --dry-run\\\",\\\"不创建任务\\\",\\\"不证明真实提交成功\\\",\\\"40 位小写十六进制\\\",\\\"不验证该 SHA 存在\\\",\\\"条目 repo → 计划顶层 repo → 命令行 --repo → 默认 cecelia\\\",\\\"读不了计划文件\\\",\\\"计划不合格\\\",\\\"退出码 2\\\",\\\"未知仓库\\\"])if(!s.includes(x))throw Error(x);for(const x of [\\\"function parseArgs\\\",\\\"JSON.parse(fs.readFileSync(file\\\",\\\"读不了计划文件\\\",\\\"return 2\\\",\\\"validatePlan(plan\\\",\\\"计划不合格\\\",\\\"if (dryRun)\\\",\\\"resolveRepo(wanted, repos)\\\",\\\"/^[a-f0-9]{40}$/\\\"])if(!n.includes(x))throw Error(x);for(const x of [\\\"export function resolveRepo\\\",\\\"r.default\\\",\\\"return hit?.key ?? null\\\"])if(!r.includes(x))throw Error(x);console.log(\\\"Q-1 单任务示例及用户预检说明符合当前 CLI 源码\\\")\"};\n";
  it('真实固定b0 fixture原字节沿所选test进入静态输入', async () => {
    const f3 = await proof({ overrides: { [fixture]: realFixture } });
    expect(f3.status, JSON.stringify(f3.gaps)).toBe('verified');
    expect(f3.bindings.find(b => b.path === fixture)?.content_sha256).toBe('eff0d2fdfc49d5a9a2f02d6a55682eac1594eafd356708153702ef27a22a1418');
    expect(edges(f3)).toContainEqual({ consumer_path: test, input_path: fixture, kind: 'static_import_dependency', revision });
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
    ['未支持的reexport模块依赖', { overrides: { [helper]: 'export { x } from \"./missing.mjs\";' } }],
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
