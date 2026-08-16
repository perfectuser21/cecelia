/**
 * 冻结合同测试 — work-routing 建任务口 base_repo 回填（修法 C）。
 *
 * Golden Path Step 1：coding_mutation 任务在 metadata/payload 缺 base_repo 时，
 * 从 map_scope_repositories 的 repo/aliases 推出规范 clone URL 写入 payload.base_repo；
 * 短名/别名一律规范化为完整 URL。
 *
 * 目标（Generator 需从 work-routing-store.js 导出，供 createRoutedTask payload 组装复用）：
 *   - canonicalBaseRepoUrl(repoOrAlias) -> string|null
 *
 * 落库 payload.base_repo 的真实 DB 写入由 Final E2E（scratch 库真 psql）覆盖；
 * 本单测只锁纯 URL 规范化逻辑（禁 mock 边：DB 写路径不在此单测 mock，走 Final E2E）。
 */
import { describe, it, expect } from 'vitest';
import { canonicalBaseRepoUrl } from '../../../packages/brain/src/work-routing-store.js';

describe('canonicalBaseRepoUrl [BEHAVIOR]', () => {
  it('短名 cecelia 规范化为完整 GitHub clone URL', () => {
    expect(canonicalBaseRepoUrl('cecelia')).toBe(
      'https://github.com/perfectuser21/cecelia.git',
    );
  });

  it('owner/repo 形式规范化为完整 clone URL', () => {
    expect(canonicalBaseRepoUrl('perfectuser21/cecelia')).toBe(
      'https://github.com/perfectuser21/cecelia.git',
    );
  });

  it('zenithjoy-workspace 短名规范化为完整 clone URL', () => {
    expect(canonicalBaseRepoUrl('zenithjoy')).toBe(
      'https://github.com/perfectuser21/zenithjoy-workspace.git',
    );
  });

  it('空值/无法解析时返回 null 不臆造 URL', () => {
    expect(canonicalBaseRepoUrl('')).toBe(null);
    expect(canonicalBaseRepoUrl(null)).toBe(null);
    expect(canonicalBaseRepoUrl('totally-unknown-xyz')).toBe(null);
  });
});
