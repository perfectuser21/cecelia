/**
 * skill-inventory-reconcile.js — 三平台采集结果 → skill_registry 机器列（纯函数，Skill 台账投影 PR1a）
 *
 * 判定点（decisions 表）：
 *  11af333b 同名即同一 skill：去 openclaw/ 前缀后按 name 精确相等归一行，内容差异记副本漂移
 *  bc98dda7 原件：zenithjoy-skills 仓库根目录 > OpenClaw 实际加载那份 > ~/.agents/skills > ~/.claude/skills 本地 > 仅跑场机
 *  84972cc1 Codex：复用 skill-dist-drift 的跑场机 codex-gwremote 清单 + mmv ~/.agents/skills
 *  e22aab26 下线：所有来源都成功且跑场机清单新鲜才判缺席；断链立即 broken；缺席满 24h 才 gone；来源骤降 >10% 熔断
 */
export const PLATFORMS = Object.freeze({ CC: 'claude-code', OC: 'openclaw', CODEX: 'codex' });
export const GRACE_MS = 24 * 3600 * 1000;
const DRIFT_FRESH_MS = 3 * 3600 * 1000;
const DEV_CHAIN = /^(dev|plan|code-review-gate|engine-.+|harness-.+|capability.*|decomp.*)$/;
const TIER_C_BODY = /Skill\s*\(|claude -p\b/;
const TIER_B_BODY = /~?\/\.claude\/|\bAgent\s*\(|subagent_type|\bTask\s*\(|mcp__/;
const SOURCE_KIND = {
  'openclaw-workspace': 'openclaw-workspace', 'openclaw-managed': 'openclaw-managed',
  'openclaw-workshop': 'openclaw-workshop', 'agents-skills-personal': 'agents-personal',
};

export function normalizeName(name) {
  return String(name || '').replace(/^openclaw\//, '');
}

export function frontmatterDescription(md) {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(String(md || ''));
  if (!fm) return null;
  const lines = fm[1].split(/\r?\n/);
  const i = lines.findIndex((l) => /^description:/.test(l));
  if (i < 0) return null;
  const inline = lines[i].replace(/^description:\s*/, '').trim();
  if (inline && !/^[|>][-+]?$/.test(inline)) return inline.replace(/^["']|["']$/g, '').trim() || null;
  const block = [];
  for (let j = i + 1; j < lines.length && /^\s+\S/.test(lines[j]); j++) block.push(lines[j].trim());
  return block.join(' ').trim() || null;
}

export function suggestTier(name, content, platforms) {
  if (platforms.includes(PLATFORMS.OC)) return null;
  const body = String(content || '');
  if (DEV_CHAIN.test(name) || TIER_C_BODY.test(body)) return 'C';
  if (TIER_B_BODY.test(body)) return 'B';
  return 'A';
}

function codexView(driftState, now) {
  const fresh = driftState && driftState.truth?.status === 'ok'
    && Number.isFinite(Date.parse(driftState.checked_at)) && now - Date.parse(driftState.checked_at) <= DRIFT_FRESH_MS;
  if (!fresh) return { fresh: false, codexOk: () => false, runnerExtra: new Set() };
  const codexDirs = [];
  const runnerExtra = new Set();
  for (const m of driftState.machines || []) {
    for (const d of m.dirs || []) {
      if (d.label === 'codex-gwremote' && ['ok', 'drift'].includes(d.status) && (d.missing_total ?? 0) <= 30) {
        codexDirs.push(new Set(d.missing || []));
      }
      if (d.label === 'claude' && Array.isArray(d.extra)) d.extra.forEach((n) => runnerExtra.add(n));
    }
  }
  return { fresh: true, codexOk: (n) => codexDirs.some((missing) => !missing.has(n)), runnerExtra };
}

export function buildRecords(inventory, { driftState = null, now = Date.now() } = {}) {
  const src = inventory?.sources || {};
  const contents = inventory?.contents || {};
  const view = codexView(driftState, now);
  const acc = new Map();
  const get = (name) => {
    const n = normalizeName(name);
    if (!acc.has(n)) acc.set(n, { name: n, platforms: new Set(), copies: [], assigned: new Set(), cands: {} });
    return acc.get(n);
  };
  const ok = (s) => src[s]?.status === 'ok';

  const repoByName = new Map((ok('repo') ? src.repo.items : []).map((i) => [i.name, i]));
  for (const i of ok('claude') ? src.claude.items : []) {
    const r = get(i.name);
    r.platforms.add(PLATFORMS.CC);
    if (view.codexOk(i.name)) r.platforms.add(PLATFORMS.CODEX);
    r.copies.push({ platform: PLATFORMS.CC, path: i.path, digest: i.digest, lines: i.lines });
    if (/\/zenithjoy-skills\//.test(i.real_path || '')) r.cands.repo ??= repoByName.get(i.name) || i;
    else r.cands.claude ??= i;
  }
  for (const i of ok('agents') ? src.agents.items : []) {
    const r = get(i.name);
    r.platforms.add(PLATFORMS.CODEX);
    if (/\/\.claude[^/]*\/plugins\/cache\//.test(i.real_path || '')) r.platforms.add(PLATFORMS.CC);
    r.copies.push({ platform: 'agents', path: i.path, digest: i.digest, lines: i.lines });
    r.cands.agents ??= i;
  }
  for (const i of ok('openclaw') ? src.openclaw.items : []) {
    const r = get(i.name);
    r.platforms.add(PLATFORMS.OC);
    (i.assigned || []).forEach((a) => r.assigned.add(a));
    if (i.source !== 'agents-skills-personal') {
      r.copies.push({ platform: PLATFORMS.OC, path: i.path, digest: i.digest, lines: i.lines, agents: i.agents || [] });
      r.cands.openclaw ??= i;
    }
    r.ocKind ??= SOURCE_KIND[i.source];
  }
  for (const n of view.runnerExtra) {
    if (acc.has(n)) continue;
    const r = get(n);
    r.platforms.add(PLATFORMS.CC);
    r.runnerOnly = true;
  }

  const records = [...acc.values()].map((r) => {
    const [kind, canon] = r.cands.repo ? ['repo', r.cands.repo]
      : r.cands.openclaw ? [r.ocKind || 'openclaw-workspace', r.cands.openclaw]
      : r.cands.agents ? ['agents-personal', r.cands.agents]
      : r.cands.claude ? ['claude-local', r.cands.claude]
      : ['runner-only', null];
    const platforms = [...r.platforms].sort();
    const content = canon ? contents[canon.digest] ?? null : null;
    return {
      name: r.name,
      description: content ? frontmatterDescription(content) : null,
      platforms_installed: platforms,
      source_kind: kind,
      source_path: canon ? canon.path : null,
      content_md: content,
      content_digest: canon ? canon.digest : null,
      copies: r.copies,
      drift_copies: canon ? r.copies.filter((c) => c.digest !== canon.digest).length : 0,
      files: canon ? canon.files || [] : [],
      assigned_agents: [...r.assigned].sort(),
      tier_suggested: suggestTier(r.name, content, platforms),
    };
  });

  const brokenNames = new Set([...(ok('claude') ? src.claude.broken : []), ...(ok('agents') ? src.agents.broken : [])]
    .map(normalizeName).filter((n) => !acc.has(n)));
  const counts = Object.fromEntries(['claude', 'agents', 'openclaw', 'repo']
    .map((s) => [s, ok(s) ? src[s].items.length : null]));
  const sourcesOk = ['claude', 'agents', 'openclaw', 'repo'].every(ok) && view.fresh;
  return { records, sourcesOk, brokenNames, counts };
}

export function trippedSources(prevCounts, counts, ratio = 0.1) {
  if (!prevCounts) return [];
  return Object.keys(counts).filter((k) => Number.isFinite(prevCounts[k]) && prevCounts[k] > 0
    && Number.isFinite(counts[k]) && counts[k] < prevCounts[k] * (1 - ratio));
}

export function decideAbsent(row, { isBroken, canJudge, now, graceMs = GRACE_MS }) {
  if (isBroken) return { presence: 'broken', absent_since: null };
  if (!canJudge) return { presence: row.presence, absent_since: row.absent_since ?? null };
  const since = row.absent_since ? Date.parse(row.absent_since) : NaN;
  if (!Number.isFinite(since)) return { presence: row.presence, absent_since: new Date(now).toISOString() };
  if (now - since >= graceMs) return { presence: 'gone', absent_since: new Date(since).toISOString() };
  return { presence: row.presence, absent_since: new Date(since).toISOString() };
}
