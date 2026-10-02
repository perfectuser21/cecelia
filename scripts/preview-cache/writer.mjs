#!/usr/bin/env node
// 固定npm writer；cache归属只由真实写入入口产生。HTTP不暴露本入口。
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { createCacheService } from './service.mjs';
import { ROOT, PR, directory, fail } from './storage.mjs';
const [pr, kind] = process.argv.slice(2);
try {
  if (!PR.test(pr || '') || !['frontend', 'brain'].includes(kind) || process.argv.length !== 4
      || (process.env.PREVIEW_BASE_DIR && process.env.PREVIEW_BASE_DIR !== ROOT)) throw fail('INVALID_WRITER_REQUEST');
  const cwd = join(ROOT, `preview-${pr}`, ...(kind === 'frontend' ? ['apps', 'dashboard'] : []));
  await directory(cwd);
  const result = await createCacheService().withWriter(pr, cache => new Promise((resolve, reject) => {
    const args = kind === 'frontend' ? ['ci', '--cache', cache]
      : ['ci', '--workspace=packages/brain', '--omit=dev', '--omit=optional', '--ignore-scripts', '--cache', cache,
        '--logs-dir', join(ROOT, `.npm-logs-preview-${pr}`)];
    const child = spawn('npm', args, { cwd, stdio: 'inherit', shell: false });
    child.once('error', reject); child.once('exit', (code, signal) => resolve(signal ? 1 : code));
  }));
  process.exitCode = result;
} catch (error) { console.error(`[preview-cache] ${error.code || 'WRITER_FAILED'}`); process.exitCode = 1; }
