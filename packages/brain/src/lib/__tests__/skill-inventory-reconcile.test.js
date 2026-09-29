/**
 * 归并与判定（纯函数）：原件优先级 / Codex 口径 / tier 建议 / 缺席 24h / 断链 / 熔断。
 * 判定点：11af333b 同名即同一 skill、e22aab26 下线判定、bc98dda7 原件取在用那份、84972cc1 Codex 口径。
 */
import { describe, it, expect } from 'vitest';
import {
  normalizeName, frontmatterDescription, suggestTier, buildRecords, trippedSources, decideAbsent,
} from '../skill-inventory-reconcile.js';

const item = (name, digest, extra = {}) => ({ name, path: `/p/${name}/SKILL.md`, real_path: `/p/${name}/SKILL.md`, digest, lines: 3, truncated: false, files: ['SKILL.md'], ...extra });
const inv = (over = {}) => ({
  ok: true,
  contents: { d1: '---\ndescription: 甲描述\n---\n# a', d2: '# 旧副本', d3: '---\ndescription: |\n  多行\n  描述\n---\n', d4: '# bs' },
  sources: {
    claude: { status: 'ok', items: [item('alpha', 'd1', { real_path: '/h/perfect21/zenithjoy-skills/alpha/SKILL.md' }), item('solo', 'd3')], broken: ['ghost'] },
    agents: { status: 'ok', items: [item('brainstorming', 'd4', { real_path: '/h/.claude-account1/plugins/cache/superpowers/x/brainstorming/SKILL.md' })], broken: [] },
    repo: { status: 'ok', items: [item('alpha', 'd1', { path: '/h/perfect21/zenithjoy-skills/alpha/SKILL.md' })] },
    openclaw: { status: 'ok', items: [
      { ...item('alpha', 'd2', { path: '/ws/skills/alpha/SKILL.md' }), source: 'openclaw-workspace', agents: ['a'], assigned: ['a'] },
      { ...item('openclaw/beta', 'd2', { path: '/ws/skills/beta/SKILL.md' }), source: 'openclaw-workspace', agents: ['a', 'b'], assigned: ['a'] },
      { ...item('brainstorming', 'd4'), source: 'agents-skills-personal', agents: ['a'], assigned: [] },
    ] },
    ...over,
  },
});
const drift = (over = {}) => ({
  checked_at: new Date().toISOString(), truth: { status: 'ok' },
  machines: [{ id: 'xian-m4', dirs: [
    { label: 'claude', status: 'drift', extra: ['review'], missing: [], missing_total: 0 },
    { label: 'codex-gwremote', status: 'drift', missing: ['solo'], missing_total: 1 },
  ] }],
  ...over,
});

describe('基础函数', () => {
  it('normalizeName 去 openclaw/ 前缀', () => {
    expect(normalizeName('openclaw/beta')).toBe('beta');
    expect(normalizeName('alpha')).toBe('alpha');
  });
  it('frontmatterDescription 支持单行与 | 多行', () => {
    expect(frontmatterDescription('---\ndescription: 甲描述\n---\n')).toBe('甲描述');
    expect(frontmatterDescription('---\ndescription: |\n  多行\n  描述\n---\n')).toBe('多行 描述');
    expect(frontmatterDescription('# 无 frontmatter')).toBeNull();
  });
  it('suggestTier：已在 OpenClaw → null；研发链 → C；CC 专属机制 → B；其余 A', () => {
    expect(suggestTier('beta', '', ['openclaw'])).toBeNull();
    expect(suggestTier('harness-planner', '', ['claude-code'])).toBe('C');
    expect(suggestTier('x', '然后 Skill({"skill":"dev"})', ['claude-code'])).toBe('C');
    expect(suggestTier('x', '读 ~/.claude/skills/y', ['claude-code'])).toBe('B');
    expect(suggestTier('x', '用 mcp__notion__search', ['claude-code'])).toBe('B');
    expect(suggestTier('nas', '普通说明', ['claude-code'])).toBe('A');
  });
});

describe('buildRecords', () => {
  const { records, sourcesOk, brokenNames, counts } = buildRecords(inv(), { driftState: drift(), now: Date.now() });
  const by = Object.fromEntries(records.map((r) => [r.name, r]));

  it('同名归一行，前缀去掉', () => {
    expect(Object.keys(by).sort()).toEqual(['alpha', 'beta', 'brainstorming', 'review', 'solo']);
  });
  it('原件优先 repo，OpenClaw 旧副本记漂移', () => {
    expect(by.alpha.source_kind).toBe('repo');
    expect(by.alpha.content_digest).toBe('d1');
    expect(by.alpha.drift_copies).toBe(1);
    expect(by.alpha.platforms_installed).toEqual(['claude-code', 'codex', 'openclaw']);
    expect(by.alpha.description).toBe('甲描述');
  });
  it('OpenClaw 独有 → 原件取在用那份，标 openclaw-workspace，assigned 汇总', () => {
    expect(by.beta.source_kind).toBe('openclaw-workspace');
    expect(by.beta.source_path).toBe('/ws/skills/beta/SKILL.md');
    expect(by.beta.assigned_agents).toEqual(['a']);
    expect(by.beta.platforms_installed).toEqual(['openclaw']);
  });
  it('superpowers：插件缓存路径 → 同时算 claude-code；~/.agents → codex', () => {
    expect(by.brainstorming.platforms_installed).toEqual(['claude-code', 'codex', 'openclaw']);
    expect(by.brainstorming.source_kind).toBe('agents-personal');
  });
  it('Codex：跑场机 codex-gwremote missing 清单里的不算 codex', () => {
    expect(by.solo.platforms_installed).toEqual(['claude-code']);
    expect(by.solo.description).toBe('多行 描述');
  });
  it('跑场机独有（extra）也算在，source_kind=runner-only', () => {
    expect(by.review.source_kind).toBe('runner-only');
    expect(by.review.platforms_installed).toEqual(['claude-code']);
  });
  it('断链、来源健康度、计数', () => {
    expect([...brokenNames]).toEqual(['ghost']);
    expect(sourcesOk).toBe(true);
    expect(counts).toEqual({ claude: 2, agents: 1, openclaw: 3, repo: 1 });
  });
  it('任一来源 fail 或跑场机清单过期 → sourcesOk=false', () => {
    expect(buildRecords(inv({ openclaw: { status: 'fail', error: 'x' } }), { driftState: drift(), now: Date.now() }).sourcesOk).toBe(false);
    const stale = drift({ checked_at: new Date(Date.now() - 4 * 3600e3).toISOString() });
    expect(buildRecords(inv(), { driftState: stale, now: Date.now() }).sourcesOk).toBe(false);
    expect(buildRecords(inv(), { driftState: null, now: Date.now() }).sourcesOk).toBe(false);
  });
  it('missing_total>30（清单被截断）→ 这台不给 codex', () => {
    const d = drift();
    d.machines[0].dirs[1] = { label: 'codex-gwremote', status: 'drift', missing: [], missing_total: 31 };
    const r = buildRecords(inv(), { driftState: d, now: Date.now() }).records.find((x) => x.name === 'solo');
    expect(r.platforms_installed).toEqual(['claude-code']);
  });
});

describe('熔断与缺席判定', () => {
  it('某来源比上轮少 >10% 就熔断', () => {
    expect(trippedSources({ claude: 100, openclaw: 50 }, { claude: 89, openclaw: 50 })).toEqual(['claude']);
    expect(trippedSources({ claude: 100 }, { claude: 91 })).toEqual([]);
    expect(trippedSources(null, { claude: 1 })).toEqual([]);
  });
  const now = Date.parse('2026-09-30T00:00:00Z');
  it('断链 → broken（立即）', () => {
    expect(decideAbsent({ presence: 'present', absent_since: null }, { isBroken: true, canJudge: true, now }))
      .toEqual({ presence: 'broken', absent_since: null });
  });
  it('不能判（来源不全/熔断）→ 原样不动', () => {
    const row = { presence: 'present', absent_since: null };
    expect(decideAbsent(row, { isBroken: false, canJudge: false, now })).toEqual(row);
  });
  it('首次缺席记时间；满 24h 才 gone', () => {
    const first = decideAbsent({ presence: 'present', absent_since: null }, { isBroken: false, canJudge: true, now });
    expect(first).toEqual({ presence: 'present', absent_since: new Date(now).toISOString() });
    const later = decideAbsent({ presence: 'present', absent_since: '2026-09-28T23:00:00Z' }, { isBroken: false, canJudge: true, now });
    expect(later.presence).toBe('gone');
    const early = decideAbsent({ presence: 'unknown', absent_since: '2026-09-29T12:00:00Z' }, { isBroken: false, canJudge: true, now });
    expect(early.presence).toBe('unknown');
  });
});
