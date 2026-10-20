import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildExistingOpsSources } from '../existing-ops-source.js';

const root = fileURLToPath(new URL('../../../../../', import.meta.url));
const git = (...args) => execFileSync('git', ['--no-replace-objects', ...args], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
const revision = git('rev-parse', 'HEAD').trim();
const paths = git('ls-tree', '-rz', '--name-only', revision).replace(/\0$/, '').split('\0');
const sourcePath = 'packages/brain/src/lib/existing-ops-source.js';
const workflow = '.github/workflows/auto-staging-deploy.yml';
const route = 'packages/brain/src/routes/ops.js';
const script = 'scripts/staging-deploy.sh';
const auth = 'scripts/lib/internal-auth-token.sh';
const cache = new Map();
const read = path => {
  if (!cache.has(path)) cache.set(path, git('show', `${revision}:${path}`));
  return cache.get(path);
};
async function build({ patch = {}, marker = 1, missing } = {}) {
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
    for (const path of [workflow, route, script, auth]) expect(result.bindings).toContainEqual(expect.objectContaining({ path, revision, status: 'verified' }));
    for (const [consumer_path, input_path, kind] of [[workflow, route, 'reviewed_staging_deploy_request'],
      [route, script, 'reviewed_staging_script_exec'], [script, auth, 'bash_source_call']])
      expect(result.input_relations).toContainEqual({ consumer_path, input_path, kind, revision });
    expect(result.definition_scope).toBe('consumer_evidence');
  });
  it('没有声明新协议的旧冻结修订保持原证据，不追加 staging 绑定', async () => {
    for (const marker of [null, 0]) {
      const result = await build({ marker });
      expect(result.status).toBe('verified');
      expect(result.bindings.some(b => b.path === script || b.path === workflow)).toBe(false);
    }
  });
  it.each([workflow, script, auth])('新协议固定输入 %s 不可读必须 UNKNOWN 且无部分绑定', async missing => {
    const result = await build({ missing });
    expect(result.status).toBe('unknown');
    expect(result.bindings).toEqual([]);
  });
  it.each([
    ['workflow echo', workflow, text => text.replace('-X POST "${BRAIN_URL}/api/brain/deploy"', 'echo POST "${BRAIN_URL}/api/brain/deploy"')],
    ['route 无执行', route, text => text.replace('const output = execSync(cmd, { cwd: repoRoot, timeout: 600_000, shell: true }).toString();', "const output = 'not executed';")],
    ['route 错路径', route, text => text.replace('/scripts/staging-deploy.sh`', '/scripts/other-deploy.sh`')],
    ['route 关闭 staging', route, text => text.replace("staging === true || mode === 'staging'", 'false')],
    ['route 超时改动', route, text => text.replace('timeout: 600_000, shell: true', 'timeout: 60_000, shell: true')],
    ['route 重复', route, text => text + "\nrouter.post('/deploy', (req, res) => res.end('other'));\n"],
    ['source 错根', script, text => text.replace('BRAIN_DIR="$ROOT_DIR/packages/brain"', 'BRAIN_DIR="/other/brain"')],
    ['source echo', script, text => text.replace('source "$SCRIPT_DIR/lib/internal-auth-token.sh"', 'echo source "$SCRIPT_DIR/lib/internal-auth-token.sh"')],
    ['source 死分支', script, text => text.replace('source "$SCRIPT_DIR/lib/internal-auth-token.sh"', 'if false; then source "$SCRIPT_DIR/lib/internal-auth-token.sh"; fi')],
    ['source 之前退出', script, text => text.replace('source "$SCRIPT_DIR/lib/internal-auth-token.sh"', 'exit 0\nsource "$SCRIPT_DIR/lib/internal-auth-token.sh"')],
  ])('%s 不可冒充真实消费', async (_name, path, mutate) => {
    const original = read(path), changed = mutate(original);
    expect(changed).not.toBe(original);
    const result = await build({ patch: { [path]: changed } });
    expect(result.status).toBe('unknown');
    expect(result.bindings).toEqual([]);
  });
  it('实际 source 后的业务正文变化仍按新固定摘要绑定，不把证据核实冒充业务 PASS', async () => {
    const result = await build({ patch: { [script]: read(script).replace('/Users/administrator/.credentials/cecelia-internal.env', '${HOME}/.credentials/cecelia-internal.env') } });
    expect(result.status, JSON.stringify(result.gaps)).toBe('verified');
    expect(result.bindings.find(b => b.path === script)?.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
  });
  it('未知协议版本不能降级为旧证据', async () => {
    const result = await build({ marker: 2 });
    expect(result.status).toBe('unknown');
    expect(result.bindings).toEqual([]);
  });
});
