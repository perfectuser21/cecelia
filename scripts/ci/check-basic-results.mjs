import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REQUIRED_JOBS = ['plan', 'security', 'checks', 'resource-canaries', 'runtime-integration', 'pwa-upgrade', 'skill-contracts', 'codeql'];

export function checkResults(needs) {
  if (!needs || typeof needs !== 'object' || Array.isArray(needs)) throw new Error('CI 结果必须是对象');
  const missing = REQUIRED_JOBS.filter(job => !Object.hasOwn(needs, job));
  const unknown = Object.keys(needs).filter(job => !REQUIRED_JOBS.includes(job));
  if (missing.length || unknown.length) throw new Error(`CI 父任务集合不完整或包含未知任务：${[...missing, ...unknown].join(',')}`);
  for (const job of REQUIRED_JOBS) {
    if (needs[job]?.result !== 'success') throw new Error(`${job} 未完成：${needs[job]?.result || 'missing'}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    checkResults(JSON.parse(process.env.NEEDS_JSON || 'null'));
    process.stdout.write('源码 CI 全部通过\n');
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
