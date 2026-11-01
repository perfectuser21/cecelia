import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function checkResults(needs) {
  if (!needs || typeof needs !== 'object' || Array.isArray(needs)) throw new Error('CI 结果必须是对象');
  for (const job of ['plan', 'security', 'checks']) {
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
