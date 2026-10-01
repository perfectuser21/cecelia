import { it, expect } from 'vitest';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const brain = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const repository = resolve(brain, '../..');

it('真实 Dockerfile 的运行产物能导入执行目录并读取部署策略', () => {
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
    const result = spawnSync(process.execPath, ['--input-type=module', '-e',
      "const {legacyRecords}=await import('./src/execution-directory/legacy-policy.js'); const nodes=legacyRecords({env:{}}); if(nodes.length!==3||nodes.some(n=>!n.profile)) throw new Error('部署策略缺失');"],
    { cwd: artifact, encoding: 'utf8', timeout: 15_000 });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  } finally {
    rmSync(artifact, { recursive: true, force: true });
  }
});
