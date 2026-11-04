import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

it('历史根回填CLI拒执行且不能初始化数据库或模型客户端', () => {
  // 不执行原网络依赖：去除import声明后，在不提供pg/OpenAI的沙箱检查退役入口。
  const source = readFileSync(new URL('../../../../backfill-memory-embeddings.mjs', import.meta.url), 'utf8');
  const writes = [];
  const process = { stderr: { write: value => writes.push(value) }, exitCode: 0 };
  const executable = source.replace(/^import .*;\n/gm, '');
  expect(() => runInNewContext(executable, { process })).not.toThrow();
  expect(writes.join('')).toContain('retired_memory_embedding_backfill');
  expect(process.exitCode).toBe(1);
});
