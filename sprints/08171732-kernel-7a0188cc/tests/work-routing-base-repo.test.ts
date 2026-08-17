/**
 * work-routing-base-repo.test.ts —— 合同冻结测试（TDD Red）
 *
 * 覆盖父路: 独立小路（无父路）—— packages/brain 建任务口回填 base_repo。
 *
 * 对应 PRD 修法 C（work-routing-store.js）：
 *   createRoutedTask 对 coding_mutation 任务在 payload 缺 base_repo 时，从
 *   map_scope_repositories 的 repo/aliases 推出规范 clone URL 写入 payload.base_repo；
 *   短名/别名一律规范化为完整 URL（https://github.com/<owner>/<repo>.git）。
 *
 * 本文件测该规范化的纯逻辑 seam（generator 导出 canonicalRepoCloneUrl）。
 * DB 写路径（code ↔ tasks 表）的真验见合同 ## E2E 验收（local_api，psql 真查落库）。
 */
import { describe, it, expect } from 'vitest';
import { canonicalRepoCloneUrl } from '../../../packages/brain/src/work-routing-store.js';

// map_scope_repositories → loadRepositoryFacts 的形状（{ scope_key, repo, path, aliases }）
const FACTS = [
  { scope_key: 'cecelia-core', repo: 'cecelia', path: '/workspace', aliases: ['cecelia', 'perfectuser21/cecelia'] },
  { scope_key: 'zj-core', repo: 'zenithjoy', path: '/zj', aliases: ['zenithjoy', 'zenithjoy-workspace'] },
];

describe('canonicalRepoCloneUrl 规范化 [BEHAVIOR]', () => {
  it('C1: 短名 cecelia → https://github.com/perfectuser21/cecelia.git', () => {
    expect(canonicalRepoCloneUrl('cecelia', FACTS)).toBe('https://github.com/perfectuser21/cecelia.git');
  });

  it('C2: 短名 zenithjoy → https://github.com/perfectuser21/zenithjoy-workspace.git', () => {
    expect(canonicalRepoCloneUrl('zenithjoy', FACTS)).toBe('https://github.com/perfectuser21/zenithjoy-workspace.git');
  });

  it('C3: 已是完整 URL → 幂等返回同一 URL（结尾 .git 规范化）', () => {
    const url = 'https://github.com/perfectuser21/cecelia.git';
    expect(canonicalRepoCloneUrl(url, FACTS)).toBe(url);
    expect(canonicalRepoCloneUrl('https://github.com/perfectuser21/cecelia', FACTS)).toBe(url);
  });

  it('C4: 未知短名（不在 repoMap / facts）→ 不猜测，返回 null', () => {
    expect(canonicalRepoCloneUrl('totally-unknown-repo', FACTS)).toBeNull();
  });
});
