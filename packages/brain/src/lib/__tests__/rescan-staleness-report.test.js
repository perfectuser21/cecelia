// 读取rescan停滞哨兵并隔离错误；真实停滞判定见cron/rescan-staleness-patrol.test.js。
import { describe, it, expect, vi } from 'vitest';
import {
  readRescanStalenessState,
} from '../rescan-staleness-report.js';

describe('rescan状态读取与错误隔离', () => {
  it('readRescanStalenessState：形状不符（别的 key 混进来）→ 返回 null 不误报', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [{ value_json: { unrelated: true } }] }) };
    await expect(readRescanStalenessState(pool)).resolves.toBeNull();
  });

  it('readRescanStalenessState：查询失败 → best-effort 返回 null', async () => {
    const pool = { query: vi.fn().mockRejectedValue(new Error('db down')) };
    await expect(readRescanStalenessState(pool)).resolves.toBeNull();
  });
});
