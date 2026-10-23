import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parse } from 'acorn';
import { loadDeploymentRetentionRuntime } from '../deploy-retention-runtime.js';

// Execute the production route body at the paths used by the actual flattened image.
describe('deploy/status real image layout', () => {
  async function layoutProbe(layout, { missing = false, brokenPrimary = false } = {}) {
    const root = mkdtempSync(join(tmpdir(), 'deployment-route-layout-'));
    const repo = join(root, layout === 'flat' ? 'flat/app' : 'mono');
    const routeDir = layout === 'flat' ? join(repo, 'src/routes') : join(repo, 'packages/brain/src/routes');
    const runtimeDir = join(repo, 'scripts/brain-image-retention');
    mkdirSync(routeDir, { recursive: true });
    mkdirSync(runtimeDir, { recursive: true });
    if (!missing) writeFileSync(join(runtimeDir, 'runtime.mjs'), `export async function createRuntime(){return {ledger:{settlement:async git_sha=>({outcome:'success',git_sha,image_id:'sha256:'+'b'.repeat(64)})}}}`);
    if (brokenPrimary) {
      mkdirSync(join(root, 'scripts/brain-image-retention'), { recursive: true });
      writeFileSync(join(root, 'scripts/brain-image-retention/runtime.mjs'), 'import "./missing-adapter.mjs";');
    }
    const source = readFileSync(new URL('../../routes/ops.js', import.meta.url), 'utf8');
    const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
    const route = ast.body.find(n => n.type === 'ExpressionStatement' && n.expression.type === 'CallExpression' && n.expression.callee.type === 'MemberExpression' && n.expression.callee.object.name === 'router' && n.expression.callee.property.name === 'get' && n.expression.arguments[0]?.value === '/deploy/status');
    const loader = ast.body.find(n => n.type === 'ImportDeclaration' && n.source.value === '../lib/deploy-retention-runtime.js');
    let prefix = '';
    if (loader) {
      const target = join(dirname(routeDir), 'lib/deploy-retention-runtime.js');
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(fileURLToPath(new URL('../deploy-retention-runtime.js', import.meta.url)), target);
      prefix = source.slice(loader.start, loader.end);
    }
    const filename = join(routeDir, 'probe.mjs');
    writeFileSync(join(repo, 'package.json'), '{"type":"module"}');
    writeFileSync(filename, `${prefix}\nlet handler;const router={get:(_path,fn)=>{handler=fn}};const readDeployStatusFile=()=>null;const deployState={status:'idle'};${source.slice(route.start, route.end)};export {handler};`);
    const oldSha = process.env.GIT_SHA;
    process.env.GIT_SHA = 'a'.repeat(40);
    try {
      const script = `const {handler}=await import(${JSON.stringify(pathToFileURL(filename).href)});await handler({}, {json:value=>console.log(JSON.stringify(value))});`;
      const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', env: process.env, timeout: 10000 });
      if (child.status !== 0) throw new Error(child.stderr || 'image layout probe failed');
      return JSON.parse(child.stdout);
    } finally {
      if (oldSha === undefined) delete process.env.GIT_SHA; else process.env.GIT_SHA = oldSha;
      rmSync(root, { recursive: true, force: true });
    }
  }
  it('loads the actual repository runtime without executing deployment actions', async () => {
    expect(typeof (await loadDeploymentRetentionRuntime()).createRuntime).toBe('function');
  });
  it.each(['mono', 'flat'])('loads the approved runtime in %s layout', async layout => {
    expect(await layoutProbe(layout)).toMatchObject({ settled: true, settlement: { outcome: 'success', git_sha: 'a'.repeat(40) } });
  });
  it('does not hide a missing or broken runtime behind a successful status', async () => {
    expect(await layoutProbe('flat', { missing: true })).toMatchObject({ settled: false, settlement: null });
    expect(await layoutProbe('flat', { brokenPrimary: true })).toMatchObject({ settled: false, settlement: null });
  });
});
