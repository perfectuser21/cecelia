// 仓库配置表（C4）：repos.json 是 runner 多仓库口径的唯一来源；cecelia 行为不变，zenithjoy 先登记不启用。
import { describe, it, expect } from 'vitest';
import { loadRepos, resolveRepo, enabledRepos, resolveEntry, repoView, repoViews, reposFile, REPOS_FILE, normalizeRepoName, REQUIRED_FIELDS } from '../lib/repos.mjs';
import { PRODUCTION_TARGET_RE } from '../../lib/qa-report.mjs';
import { QA_SMOKE_DIR } from '../../lib/qa-smoke.mjs';

const repos = loadRepos();
const byKey = (key) => repos.find((r) => r.key === key);

describe('repos.json', () => {
  it('每个条目必填字段齐全；key / slug / clone / worktree_base / state_ns 互不重复；恰有一个默认仓', () => {
    for (const r of repos) {
      for (const f of REQUIRED_FIELDS) expect(r, `${r.key}.${f}`).toHaveProperty(f);
    }
    for (const f of ['key', 'clone', 'worktree_base', 'state_ns', 'slug']) {
      expect(new Set(repos.map((r) => r[f])).size, f).toBe(repos.length);
    }
    expect(repos.filter((r) => r.default)).toHaveLength(1);
  });

  it('cecelia：默认仓、启用、自动合并、状态命名空间为空（沿用旧文件名，零迁移），与现行代码口径一致', () => {
    const c = byKey('cecelia');
    expect(c).toMatchObject({ default: true, enabled: true, automerge: true, state_ns: '', slug: 'perfectuser21/cecelia',
      clone: '~/perfect21/cecelia-cw-runner', worktree_base: '~/worktrees/cecelia-cw', base_fresh_check: 'lint-base-fresh' });
    expect(c.required_checks).toEqual(['ci-passed', 'Harness V5 Gate Passed', 'Smoke Glob Runner Passed']);
    expect(new RegExp(c.production_re.join('|')).source).toBe(PRODUCTION_TARGET_RE.source);
    expect(c.qa_smoke.dir).toBe(QA_SMOKE_DIR);
    expect(c.preview).toMatchObject({ type: 'brain_preview', base_repo: 'cecelia' });
  });

  it('zenithjoy：先登记不启用、不自动合并（合入 main 会自动部署生产手机控制器）、12 个必需检查、生产判定不含 MMV 公网 IP', () => {
    const z = byKey('zenithjoy-workspace');
    expect(z).toMatchObject({ enabled: false, automerge: false, slug: 'perfectuser21/zenithjoy-workspace', state_ns: 'zenithjoy-workspace',
      base_fresh_check: null, version_fragment: null });
    expect(z.required_checks).toHaveLength(12);
    const prod = new RegExp(z.production_re.join('|'));
    expect(prod.test('curl http://100.86.118.99:5200/x')).toBe(true);
    expect(prod.test('ssh hk-vps uptime')).toBe(true);
    expect(prod.test('curl http://38.23.47.81:5305/api/x')).toBe(false);
    expect(z.production_re.join(' ')).not.toContain('38');
  });
});

describe('resolveRepo：别名归一', () => {
  it('缺省（null/undefined/空串）归默认仓 cecelia', () => {
    expect(resolveRepo(null, repos)).toBe('cecelia');
    expect(resolveRepo(undefined, repos)).toBe('cecelia');
    expect(resolveRepo('', repos)).toBe('cecelia');
  });

  it('短名、owner/repo、URL（含 .git、大小写、尾斜杠、ssh 写法）都归到同一个 key', () => {
    for (const v of ['zenithjoy', 'zenithjoy-workspace', 'ZenithJoy-Workspace', 'perfectuser21/zenithjoy-workspace',
      'https://github.com/perfectuser21/zenithjoy-workspace.git', 'https://github.com/perfectuser21/zenithjoy-workspace/',
      'git@github.com:perfectuser21/zenithjoy-workspace.git']) {
      expect(resolveRepo(v, repos), v).toBe('zenithjoy-workspace');
    }
    expect(resolveRepo('https://github.com/perfectuser21/cecelia', repos)).toBe('cecelia');
    expect(normalizeRepoName(' https://github.com/PerfectUser21/Cecelia.git ')).toBe('perfectuser21/cecelia');
  });

  it('未登记的仓库返回 null（不猜）', () => {
    expect(resolveRepo('unknown', repos)).toBeNull();
    expect(resolveRepo('https://github.com/someone/else.git', repos)).toBeNull();
    expect(resolveRepo(42, repos)).toBeNull();
  });
});

describe('enabledRepos：CODING_WF_REPOS 开关', () => {
  it('默认 = repos.json 里 enabled=true 的（只有 cecelia）', () => {
    expect(enabledRepos({}, repos).map((r) => r.key)).toEqual(['cecelia']);
  });

  it('显式列出：按别名归一；enabled=false 的仓库即使列出也不启用（双闸）；未登记的忽略', () => {
    expect(enabledRepos({ CODING_WF_REPOS: 'cecelia, zenithjoy ,nope' }, repos).map((r) => r.key)).toEqual(['cecelia']);
    const opened = repos.map((r) => ({ ...r, enabled: true }));
    expect(enabledRepos({ CODING_WF_REPOS: 'cecelia,zenithjoy' }, opened).map((r) => r.key)).toEqual(['cecelia', 'zenithjoy-workspace']);
    expect(enabledRepos({ CODING_WF_REPOS: 'zenithjoy' }, opened).map((r) => r.key)).toEqual(['zenithjoy-workspace']);
  });
});

describe('resolveEntry / repoView：每仓库的运行时视图', () => {
  it('展开 ~；默认仓的 clone / worktree 根允许旧环境变量覆盖（兼容 CODING_WF_REPO / CODING_WF_WORKTREE_BASE）', () => {
    const c = resolveEntry(byKey('cecelia'), { HOME: '/h' });
    expect(c).toMatchObject({ key: 'cecelia', clone: '/h/perfect21/cecelia-cw-runner', worktreeBase: '/h/worktrees/cecelia-cw', stateNs: '', automerge: true });
    const o = resolveEntry(byKey('cecelia'), { HOME: '/h', CODING_WF_REPO: '/r', CODING_WF_WORKTREE_BASE: '/w' });
    expect(o).toMatchObject({ clone: '/r', worktreeBase: '/w' });
    const z = resolveEntry(byKey('zenithjoy-workspace'), { HOME: '/h', CODING_WF_REPO: '/r' });
    expect(z).toMatchObject({ clone: '/h/perfect21/zenithjoy-cw-runner', worktreeBase: '/h/worktrees/zenithjoy-cw', stateNs: 'zenithjoy-workspace', automerge: false });
  });

  it('repoView 把 cfg 的仓库相关字段换成该仓库的，其余保持', () => {
    const cfg = { logDir: '/l', ghBin: 'gh', repo: '/a', worktreeBase: '/aw', repoKey: 'cecelia', stateNs: '' };
    const z = resolveEntry(byKey('zenithjoy-workspace'), { HOME: '/h' });
    expect(repoView(cfg, z)).toMatchObject({ logDir: '/l', ghBin: 'gh', repo: '/h/perfect21/zenithjoy-cw-runner', worktreeBase: '/h/worktrees/zenithjoy-cw',
      repoKey: 'zenithjoy-workspace', repoSlug: 'perfectuser21/zenithjoy-workspace', stateNs: 'zenithjoy-workspace' });
  });

  // C5：门禁按仓库遍历时，判卷代码 clone 不跟着换；合并开关 / 落后 main 检查 / 安装命令 / 预览类型取该仓库的
  it('repoView 带上该仓库的 automerge、base_fresh_check、install、preview；trustedRepo 保持默认仓 clone', () => {
    const cfg = { logDir: '/l', repo: '/a', trustedRepo: '/a', worktreeBase: '/aw' };
    const z = resolveEntry(byKey('zenithjoy-workspace'), { HOME: '/h' });
    expect(repoView(cfg, z)).toMatchObject({ trustedRepo: '/a', repoAutomerge: false, baseFreshCheck: null,
      install: ['npm', 'ci', '--ignore-scripts'], previewType: 'local' });
    const c = resolveEntry(byKey('cecelia'), { HOME: '/h' });
    expect(repoView(cfg, c)).toMatchObject({ trustedRepo: '/a', repoAutomerge: true, baseFreshCheck: 'lint-base-fresh',
      install: ['npm', 'ci', '--legacy-peer-deps', '--ignore-scripts'], previewType: 'brain_preview', previewBaseRepo: 'cecelia' });
  });

  it('repoViews：cfg.repos 逐个出视图（repos.json 顺序）；没有 cfg.repos 时就是 cfg 本身', () => {
    const cfg = { logDir: '/l', repo: '/a', trustedRepo: '/a', repos: [resolveEntry(byKey('cecelia'), { HOME: '/h' }), resolveEntry(byKey('zenithjoy-workspace'), { HOME: '/h' })] };
    expect(repoViews(cfg).map((v) => v.repoKey)).toEqual(['cecelia', 'zenithjoy-workspace']);
    const bare = { logDir: '/l', repo: '/a' };
    expect(repoViews(bare)).toEqual([bare]);
  });

  it('CODING_WF_REPOS_FILE 覆盖配置表路径（测试 / 演练用）', () => {
    expect(reposFile({ CODING_WF_REPOS_FILE: '/x/repos.json' })).toBe('/x/repos.json');
    expect(reposFile({})).toBe(REPOS_FILE);
  });
});
