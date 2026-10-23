import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse } from 'acorn';

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
const runtimeLoader = await readFile(new URL('../lib/deploy-retention-runtime.js', import.meta.url), 'utf8');
const sha = 'a'.repeat(40);

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
  if (present) {
    const runtime = join(app, 'scripts/brain-image-retention/runtime.mjs');
    await mkdir(dirname(runtime), { recursive: true });
    await writeFile(runtime, `export async function createRuntime() {
      return { ledger: { settlement: async sha => {
        if (${JSON.stringify(outcome)} === 'error') throw Error('LEDGER_BUSY');
        return {outcome:'success',git_sha:sha,deployment_id:'fixture-real-import'};
      } } };
    }`);
  }
  await writeFile(route, `import {loadDeploymentRetentionRuntime} from '../lib/deploy-retention-runtime.js';
    const deployState = {status:${JSON.stringify(status)}};
    const readDeployStatusFile = () => null;
    export const handler = ${handler};`);
  const module = await import(pathToFileURL(route).href);
  let result;
  await module.handler({}, { json(value) { result = value; } });
  return result;
}

it.each(['repository', 'container'])('真实%s布局可加载结算模块并返回同SHA证据', async layout => {
  const before = process.env.GIT_SHA; process.env.GIT_SHA = sha;
  try {
    const result = await invoke(layout);
    expect(result).toMatchObject({ settled: true, git_sha: sha,
      settlement: { git_sha: sha, deployment_id: 'fixture-real-import' } });
  } finally {
    if (before === undefined) delete process.env.GIT_SHA; else process.env.GIT_SHA = before;
  }
});

it('Docker实际打包保留/app/src与/app/scripts的相对布局', async () => {
  const dockerfile = await readFile(new URL('../../Dockerfile', import.meta.url), 'utf8');
  expect(dockerfile).toMatch(/WORKDIR \/app/);
  expect(dockerfile).toMatch(/COPY scripts\/brain-image-retention\/ \.\/scripts\/brain-image-retention\//);
});

it('容器模块缺失或ledger失败仍不放行', async () => {
  expect(await invoke('container', { present: false })).toMatchObject({ settled: false, settlement: null });
  expect(await invoke('container', { outcome: 'error' })).toMatchObject({ settled: false, settlement: null });
});

it.each(['running', 'failed', 'rollback'])('%s不能被可读取成功收据放行', async status => {
  expect(await invoke('container', { status })).toMatchObject({ settled: false, settlement: null });
});
