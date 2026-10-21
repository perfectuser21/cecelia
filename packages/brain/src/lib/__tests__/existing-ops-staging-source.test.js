import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parse } from 'acorn';
import { buildExistingOpsSources } from '../existing-ops-source.js';

const root = fileURLToPath(new URL('../../../../../', import.meta.url));
const git = (...args) => execFileSync('git', ['--no-replace-objects', ...args], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
const revision = git('rev-parse', 'HEAD').trim();
const paths = git('ls-tree', '-rz', '--name-only', revision).replace(/\0$/, '').split('\0');
const sourcePath = 'packages/brain/src/lib/existing-ops-source.js';
const workflow = '.github/workflows/auto-staging-deploy.yml';
const route = 'packages/brain/src/routes/ops.js';
const script = 'scripts/staging-deploy.sh';
const helper = 'scripts/lib/brain-staging.sh';
const verify = 'scripts/staging-verify.sh';
const wait = 'scripts/wait-for-staging.sh';
const deploy = 'scripts/brain-deploy.sh';
const buildScript = 'scripts/brain-build.sh';
const dbConfig = 'packages/brain/src/db-config.js';
const cache = new Map();
const read = path => {
  if (!cache.has(path)) cache.set(path, git('show', `${revision}:${path}`));
  return cache.get(path);
};
function wrapRoute(text, wrap) {
  const entry = parse(text, { ecmaVersion: 'latest', sourceType: 'module' }).body.find(n => n.type === 'ExpressionStatement'
    && n.expression?.callee?.object?.name === 'router' && n.expression.callee.property?.name === 'post' && n.expression.arguments[0]?.value === '/deploy');
  if (!entry) throw Error('actual route fixture missing');
  return text.slice(0, entry.start) + wrap(text.slice(entry.start, entry.end)) + text.slice(entry.end);
}
async function build({ patch = {}, marker = 2, missing } = {}) {
  const result = await buildExistingOpsSources({ scope: 'cecelia-factory', repo: 'perfectuser21/cecelia', revision, paths,
    readSource: async path => {
      if (path === missing) throw Error('missing fixed blob');
      let text = patch[path] ?? read(path);
      if (path === sourcePath) {
        text = text.replace(/^export const EXISTING_OPS_STAGING_SELECTOR_SCHEMA = .*;\n/m, '');
        if (marker !== null) text += `\nexport const EXISTING_OPS_STAGING_SELECTOR_SCHEMA = ${marker};\n`;
      }
      return text;
    } });
  return result.consumers.find(c => c.workflow_key === 'factory_f2_ops');
}

describe('staging 正式调用链的固定来源，不声明部署成功', () => {
  it('真实 main workflow 请求、真实 route 执行和顶层 source 都必须成为来源边', async () => {
    const result = await build();
    expect(result.status, JSON.stringify(result.gaps)).toBe('verified');
    for (const path of [workflow, route, script, helper, verify, wait, deploy, buildScript, dbConfig]) expect(result.bindings).toContainEqual(expect.objectContaining({ path, revision, status: 'verified' }));
    for (const [consumer_path, input_path, kind] of [[workflow, route, 'reviewed_staging_deploy_request'],
      [route, script, 'reviewed_staging_script_exec'], [script, helper, 'bash_source_call'], [deploy, helper, 'bash_source_call'], [helper, verify, 'isolated_candidate_verification'], [workflow, wait, 'reviewed_staging_receipt_wait']])
      expect(result.input_relations).toContainEqual({ consumer_path, input_path, kind, revision });
    expect(result.definition_scope).toBe('consumer_evidence');
  });
  it('旧冻结schema1继续核验旧完整来源，不把新隔离链追写给旧修订',async()=>{
    const legacy='5b4cad928017e12d5b0966c0d3e69cfc673ea4d3';
    const patch=Object.fromEntries([workflow,route,script].map(path=>[path,git('show',`${legacy}:${path}`)]));
    const result=await build({marker:1,patch});
    expect(result.status,JSON.stringify(result.gaps)).toBe('verified');
    expect(result.input_relations).toContainEqual({consumer_path:script,input_path:'scripts/lib/internal-auth-token.sh',kind:'bash_source_call',revision});
    expect(result.bindings.some(b=>b.path===helper)).toBe(false);
  });
  it('没有声明新协议的旧冻结修订保持原证据，不追加 staging 绑定', async () => {
    for (const marker of [null, 0]) {
      const result = await build({ marker });
      expect(result.status).toBe('verified');
      expect(result.bindings.some(b => b.path === script || b.path === workflow)).toBe(false);
    }
  });
  it.each([workflow, script, helper, verify, wait, deploy, buildScript, dbConfig])('新协议固定输入 %s 不可读必须 UNKNOWN 且无部分绑定', async missing => {
    const result = await build({ missing });
    expect(result.status).toBe('unknown');
    expect(result.bindings).toEqual([]);
  });
  it.each([
    ['workflow echo', workflow, text => text.replace('-X POST "$BRAIN_URL/api/brain/deploy"', 'echo POST "$BRAIN_URL/api/brain/deploy"')],
    ['route 无执行', route, text => text.replace("execFile('bash',[stagingScript],{","neverExec('bash',[stagingScript],{")],
    ['route 错路径', route, text => text.replace('/scripts/staging-deploy.sh`', '/scripts/other-deploy.sh`')],
    ['route 关闭 staging', route, text => text.replace("staging === true || mode === 'staging'", 'false')],
    ['route 超时改动', route, text => text.replace('timeout:1_200_000','timeout:60_000')],
    ['route 重复', route, text => text + "\nrouter.post('/deploy', (req, res) => res.end('other'));\n"],
    ['route 未调用函数', route, text => wrapRoute(text, call => 'function neverRegistered() {\n' + call + '\n}')],
    ['route if 单句死分支', route, text => wrapRoute(text, call => 'if (false) ' + call)],
    ['route if 块死分支', route, text => wrapRoute(text, call => 'if (false) {\n' + call + '\n}')],
    ['route false 短路', route, text => wrapRoute(text, call => 'false && ' + call)],
    ['route 顺序表达式', route, text => wrapRoute(text, call => '(0, ' + call.replace(/;$/, '') + ');')],
    ['source 错根', script, text => text.replace('ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"','ROOT_DIR="/other/brain"')],
    ['source echo', script, text => text.replace('source "$SCRIPT_DIR/lib/brain-staging.sh"', 'echo source "$SCRIPT_DIR/lib/brain-staging.sh"')],
    ['source 死分支', script, text => text.replace('source "$SCRIPT_DIR/lib/brain-staging.sh"', 'if false; then source "$SCRIPT_DIR/lib/brain-staging.sh"; fi')],
    ['candidate helper 无执行', script, text => text.replace('stage_candidate "$EXPECTED_SHA"','echo stage_candidate "$EXPECTED_SHA"')],
    ['验证改为不执行', helper, text => text.replace('bash "$SCRIPT_DIR/staging-verify.sh"','echo bash "$SCRIPT_DIR/staging-verify.sh"')],
    ['生产在验证前迁移', deploy, text => text.replace('stage_candidate "$EXPECTED_SHA"','echo stage_candidate "$EXPECTED_SHA"')],
    ['source 之前退出', script, text => text.replace('source "$SCRIPT_DIR/lib/brain-staging.sh"', 'exit 0\nsource "$SCRIPT_DIR/lib/brain-staging.sh"')],
  ])('%s 不可冒充真实消费', async (_name, path, mutate) => {
    const original = read(path), changed = mutate(original);
    expect(changed).not.toBe(original);
    const result = await build({ patch: { [path]: changed } });
    expect(result.status).toBe('unknown');
    expect(result.bindings).toEqual([]);
  });
  it('route 仅空白变化仍按固定AST与新源码摘要绑定，不声称业务PASS', async () => {
    const result = await build({ patch: { [route]: read(route).replace('const output=await', 'const output = await') } });
    expect(result.status, JSON.stringify(result.gaps)).toBe('verified');
    expect(result.bindings.find(b => b.path === route)?.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
  });
  it('未知协议版本不能降级为旧证据', async () => {
    const result = await build({ marker: 3 });
    expect(result.status).toBe('unknown');
    expect(result.bindings).toEqual([]);
  });
});
