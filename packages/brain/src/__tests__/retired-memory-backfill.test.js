import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

it('历史根回填CLI拒执行且不能初始化数据库或模型客户端', () => {
  // 沙箱不提供模块加载或网络能力；出现import或客户端初始化时必须失败。
  const source = readFileSync(new URL('../../../../backfill-memory-embeddings.mjs', import.meta.url), 'utf8');
  const writes = [];
  const process = { stderr: { write: value => writes.push(value) }, exitCode: 0 };
  expect(() => runInNewContext(source, { process })).not.toThrow();
  expect(writes.join('')).toContain('retired_memory_embedding_backfill');
  expect(process.exitCode).toBe(1);
});
