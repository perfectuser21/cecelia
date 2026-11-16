import { it, expect } from 'vitest';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const brain = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const repository = resolve(brain, '../..');

it.each([
  ['执行目录部署策略', "const {legacyRecords}=await import('./src/execution-directory/legacy-policy.js'); const nodes=legacyRecords({env:{}}); if(nodes.length!==3||nodes.some(n=>!n.profile)) throw new Error('部署策略缺失');"],
  ['Workflow 底座路由', "const {createWorkflowFoundationRouter}=await import('./src/routes/workflow-foundation.js'); const router=createWorkflowFoundationRouter(); for(const route of ['/catalog','/tasks','/claim','/tasks/:id/ready','/tasks/:id/preflight-failed','/tasks/:id/reconcile']) if(!router.stack.some(layer=>layer.route?.path===route)) throw new Error('底座路由缺失: '+route);"],
])('真实 Dockerfile 产物可加载%s', (_name, probe) => {
  const artifact = mkdtempSync(join(tmpdir(), 'brain-runtime-artifact-'));
  try {
    // 从真实 runtime stage 的 COPY 重建内部文件，不能链接源码掩盖漏打包。
    const runtime = readFileSync(join(brain, 'Dockerfile'), 'utf8').split(/^FROM /m).at(-1);
    let workdir;
    for (const line of runtime.split('\n')) {
      if (line.startsWith('WORKDIR ')) workdir = line.slice(8).trim();
      if (!line.startsWith('COPY ') || line.startsWith('COPY --from=')) continue;
      expect(workdir).toBe('/app');
      const parts = line.trim().split(/\s+/).slice(1);
      const destination = parts.pop();
      for (const source of parts) {
        const input = resolve(repository, source);
        let output = resolve(artifact, destination.replace(/^\/app\//, ''));
        if (!statSync(input).isDirectory() && destination.endsWith('/')) output = join(output, basename(source));
        mkdirSync(dirname(output), { recursive: true });
        cpSync(input, output, { recursive: true });
      }
    }
    // 只链接第三方 npm 包，按 Dockerfile 顺序叠加 workspace 本地版本；内部源码必须来自 COPY。
    const modules = join(artifact, 'node_modules');
    mkdirSync(modules);
    for (const root of [join(repository, 'node_modules'), join(brain, 'node_modules')]) {
      for (const name of readdirSync(root).filter(name => !name.startsWith('.'))) {
        const entries = name.startsWith('@') ? readdirSync(join(root, name)).map(child => `${name}/${child}`) : [name];
        for (const entry of entries) {
          const target = join(modules, entry);
          mkdirSync(dirname(target), { recursive: true });
          rmSync(target, { recursive: true, force: true });
          symlinkSync(join(root, entry), target);
        }
      }
    }
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', probe], {
      cwd: artifact, encoding: 'utf8', timeout: 15_000,
      env: { NODE_ENV: 'test', DB_NAME: 'cecelia_scratch', DB_HOST: '127.0.0.1', DB_PORT: '1', DB_USER: 'artifact_test', HOME: artifact },
    });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
  } finally {
    rmSync(artifact, { recursive: true, force: true });
  }
});
