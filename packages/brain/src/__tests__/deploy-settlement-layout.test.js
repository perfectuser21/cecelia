import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse } from 'acorn';
import { spawnSync } from 'node:child_process';

const roots = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
const source = await readFile(new URL('../routes/ops.js', import.meta.url), 'utf8');
const tree = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
const call = tree.body.find(n => n.type === 'ExpressionStatement'
  && n.expression.callee?.object?.name === 'router'
  && n.expression.callee?.property?.name === 'get'
  && n.expression.arguments[0]?.value === '/deploy/status').expression;
const handler = source.slice(call.arguments[1].start, call.arguments[1].end);
const sha = 'a'.repeat(40);
const runtimeLoader = await readFile(new URL('../lib/deploy-retention-runtime.js', import.meta.url), 'utf8');

// Execute the unchanged production callback from its real module location.
// Only the ledger boundary is a fixture; Node resolves the actual import itself.
async function invoke(layout, { present = true, outcome = 'success', status = 'idle' } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'settlement-layout-')); roots.push(root);
  const app = join(root, 'app');
  const route = join(app, layout === 'container' ? 'src/routes/ops.mjs' : 'packages/brain/src/routes/ops.mjs');
  await mkdir(dirname(route), { recursive: true });
  const loader = join(dirname(route), '../lib/deploy-retention-runtime.js');
  await mkdir(dirname(loader), { recursive: true });
  await writeFile(loader, runtimeLoader);
  await writeFile(join(app, 'package.json'), '{"type":"module"}');
  const marker = join(root, 'ledger-read');
  if (present) {
    const runtime = join(app, 'scripts/brain-image-retention/runtime.mjs');
    await mkdir(dirname(runtime), { recursive: true });
    await writeFile(runtime, `import {writeFileSync} from 'node:fs';
    export async function createRuntime() {
      return { ledger: { settlement: async sha => {
        writeFileSync(${JSON.stringify(marker)}, sha);
        if (${JSON.stringify(outcome)} === 'error') throw Error('LEDGER_BUSY');
        return {outcome:'success',git_sha:sha,deployment_id:'fixture-real-import'};
      } } };
    }`);
  }
  await writeFile(route, `import {loadDeploymentRetentionRuntime} from '../lib/deploy-retention-runtime.js';
    const deployState = {status:${JSON.stringify(status)}};
    const readDeployStatusFile = () => null;
    export const handler = ${handler};`);
  // 用真实Node解析动态import，避免测试runner改写缺失模块的错误身份。
  const script = `const {handler}=await import(${JSON.stringify(pathToFileURL(route).href)});await handler({}, {json:value=>process.stdout.write(JSON.stringify(value))});`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8', env: { ...process.env, GIT_SHA: sha }, timeout: 10000,
  });
  expect(child.status, child.stderr).toBe(0);
  const result = JSON.parse(child.stdout);
  if (present && status === 'idle') expect(await readFile(marker, 'utf8')).toBe(sha);

  return result;
}

it('Docker实际打包保留/app/src与/app/scripts的相对布局', async () => {
  const dockerfile = await readFile(new URL('../../Dockerfile', import.meta.url), 'utf8');
  expect(dockerfile).toMatch(/WORKDIR \/app/);
  expect(dockerfile).toMatch(/COPY scripts\/brain-image-retention\/ \.\/scripts\/brain-image-retention\//);
});

it('容器ledger失败仍不放行', async () => {
  expect(await invoke('container', { outcome: 'error' })).toMatchObject({ settled: false, settlement: null });
});

it.each(['running', 'failed', 'rollback'])('%s不能被可读取成功收据放行', async status => {
  expect(await invoke('container', { status })).toMatchObject({ settled: false, settlement: null });
});
