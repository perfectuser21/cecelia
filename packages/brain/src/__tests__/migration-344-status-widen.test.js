import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// migration 343 CHECK 枚举漏生产在用 status（working 28 行 / broken 3 行）
// → Gate3 部署 ATRewriteTable 23514（2026-07-14 生产实证）。
// 本回归钉死：约束枚举必须涵盖生产真实分布；344 幂等兜住已 apply 窄版的库。
const MIG_DIR = path.resolve(fileURLToPath(import.meta.url), '../../../migrations');

describe('migration 343/344 journey_features status CHECK 拓宽', () => {
  it('343 的 CHECK 枚举涵盖生产在用全部 status（含 working/broken）', () => {
    const sql = readFileSync(path.join(MIG_DIR, '343_journey_features_guard_ref.sql'), 'utf8');
    expect(sql).toMatch(/'working'/);
    expect(sql).toMatch(/'broken'/);
  });

  it('344 幂等拓宽存在（DROP IF EXISTS + 重建宽枚举）', () => {
    const sql = readFileSync(path.join(MIG_DIR, '344_journey_features_status_check_widen.sql'), 'utf8');
    expect(sql).toMatch(/DROP CONSTRAINT IF EXISTS journey_features_status_check/);
    expect(sql).toMatch(/'working'/);
    expect(sql).toMatch(/'broken'/);
    expect(sql).toMatch(/'live'/);
  });
});
