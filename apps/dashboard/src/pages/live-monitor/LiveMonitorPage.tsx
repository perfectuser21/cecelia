/**
 * LiveMonitor v13 — 会话提供商标记（Anthropic / MiniMax）
 * TOP:    系统目标（OKR） + 今日快照
 * MID:    活跃项目（按 project 分组的 in_progress/queued 任务）
 * BOT:    实时 Agents（前台/后台 + Kill 按钮） + 等待队列
 * FOOT:   基础设施
 *
 * 时间：startTime (ps/CST) → "Xh前" 相对格式
 * 项目：/api/brain/tasks?status=in_progress|queued + /api/tasks/projects
 */

import { useState, useEffect, useCallback } from 'react';

// ── Types ────────────────────────────────────────────────────────

interface ObjFocus {
  objective_title: string;
  priority: string;
  progress: number;
  key_results: Array<{ id: string; title: string; progress: number }>;
}

interface BrainStatus {
  daily_focus: ObjFocus | null;
  task_digest: {
    stats: { open_p0: number; open_p1: number; in_progress: number; queued: number; overdue: number };
  };
}

interface TickStatus {
  actions_today: number;
  alertness: { levelName: string };
  slot_budget: { dispatchAllowed: boolean; pressure: number };
  last_dispatch: { task_title: string; dispatched_at: string; success: boolean } | null;
  max_concurrent: number;
}

interface BrainTask {
  id: string;
  title: string;
  priority: 'P0' | 'P1' | 'P2';
  status: string;
  project_id: string | null;
  created_at: string;
}

interface Project {
  id: string;
  name: string;
  parent_id: string | null;
}

interface ClusterProcess {
  pid: number;
  cpu: string;
  memory: string;
  startTime: string;
  command: string;
}

interface ClusterServer {
  slots: { max: number; used: number; available: number; processes: ClusterProcess[] };
}

interface ClusterStatus {
  total_slots: number;
  total_used: number;
  total_available: number;
  servers: ClusterServer[];
}

interface VpsStats {
  cpu: { usage: number; loadAverage: { '1min': number }; cores: number };
  memory: { usagePercent: number; used: number; total: number };
  disk: { usagePercent: number };
  uptime: number;
}

interface Service { containerName: string; status: string }
interface SessionInfo { cwd: string | null; projectName: string | null; provider?: string; model?: string | null }
interface ProviderInfo { provider: string; model: string | null }
type KillState = 'idle' | 'confirm' | 'killing' | 'sent';

// ── Helpers ──────────────────────────────────────────────────────

const ALERT_COLOR: Record<string, string> = {
  CALM: '#10b981', NORMAL: '#3b82f6', ALERT: '#f59e0b', CRITICAL: '#ef4444',
};
const ALERT_LABEL: Record<string, string> = {
  CALM: '平静', NORMAL: '正常', ALERT: '警觉', CRITICAL: '危急',
};
const ALERT_DESC: Record<string, string> = {
  CALM: '系统平稳运行，无异常',
  NORMAL: '系统正常，按计划执行',
  ALERT: '大脑高度活跃：任务量较大或有失败记录',
  CRITICAL: '系统异常：熔断器触发或资源耗尽，需人工介入',
};

const metricColor = (p: number) => p > 80 ? '#ef4444' : p > 60 ? '#f59e0b' : '#10b981';
const krColor = (p: number) => p >= 80 ? '#10b981' : p >= 50 ? '#f59e0b' : '#ef4444';
const clip = (s: string, n: number) => s.length > n ? s.slice(0, n - 1) + '…' : s;

/** ps startTime (CST 本地时间) → 相对时间字符串 */
function fmtRelTime(startTime: string): string {
  const now = Date.now();
  if (startTime.includes(':')) {
    const [h, m] = startTime.split(':').map(Number);
    const d = new Date();
    d.setHours(h, m, 0, 0);
    let ms = d.getTime();
    if (ms > now) ms -= 86400000; // 昨天启动
    const diff = Math.round((now - ms) / 60000);
    if (diff < 60) return `${diff}m 前`;
    const hh = Math.floor(diff / 60);
    const mm = diff % 60;
    return mm > 0 ? `${hh}h${mm}m 前` : `${hh}h 前`;
  }
  // "Feb14" 格式
  const MON: Record<string, number> = {
    Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11,
  };
  const mon = startTime.slice(0, 3);
  const day = parseInt(startTime.slice(3), 10);
  const startDate = new Date(new Date().getFullYear(), MON[mon] ?? 0, day);
  const diffDays = Math.round((now - startDate.getTime()) / 86400000);
  return diffDays === 0 ? '今天' : `${diffDays}天前`;
}

function fmtAgo(iso: string) {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h${m % 60}m`;
}
function fmtUptime(s: number) {
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600);
  return d > 0 ? `${d}d ${h}h` : `${h}h`;
}
function fmtBytes(b: number) {
  return b >= 1e9 ? `${(b / 1e9).toFixed(1)}G` : `${(b / 1e6).toFixed(0)}M`;
}

function classifyProcess(cmd: string): 'foreground' | 'background' | 'wrapper' {
  if (cmd.startsWith('bash -c') || cmd.startsWith('sh -c')) return 'wrapper';
  if (cmd.includes('claude -p ')) return 'background';
  if (cmd === 'claude' || cmd.startsWith('claude ')) return 'foreground';
  return 'wrapper';
}

function isStale(startTime: string) { return !startTime.includes(':'); }

function parseBackgroundCmd(cmd: string): { skill: string; taskTitle: string } {
  const skillMatch = cmd.match(/claude -p (\/\w+)/);
  const skill = skillMatch?.[1] ?? '/unknown';
  const taskTitle = cmd.replace(/^claude -p \/\w+\s*/, '').replace(/^#\s*/, '').slice(0, 80);
  return { skill, taskTitle };
}

/** 清理任务标题中的冗余前缀 */
function cleanTaskTitle(title: string): string {
  return title.replace(/^Initiative 拆解:\s*/i, '').replace(/^I\d+(?:\.\d+)*:\s*/i, '');
}

// ── UI atoms ─────────────────────────────────────────────────────

function Dot({ color, pulse }: { color: string; pulse?: boolean }) {
  return (
    <span style={{
      display: 'inline-block', width: 7, height: 7, borderRadius: '50%',
      background: color, flexShrink: 0,
      boxShadow: pulse ? `0 0 6px ${color}` : undefined,
      animation: pulse ? 'lmPulse 1.5s ease-in-out infinite' : undefined,
    }} />
  );
}

function PBadge({ p }: { p: string }) {
  const m: Record<string, [string, string]> = {
    P0: ['rgba(239,68,68,.18)', '#f87171'],
    P1: ['rgba(245,158,11,.18)', '#fbbf24'],
    P2: ['rgba(59,130,246,.18)', '#60a5fa'],
  };
  const [bg, color] = m[p] ?? m.P2;
  return <span style={{ background: bg, color, fontFamily: 'monospace', fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 3, flexShrink: 0 }}>{p}</span>;
}

const PROVIDER_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  anthropic: { bg: 'rgba(99,102,241,.15)', color: '#818cf8', label: 'Anthropic' },
  minimax: { bg: 'rgba(16,185,129,.15)', color: '#34d399', label: 'MiniMax' },
};

function ProviderBadge({ provider, model }: { provider: string; model?: string | null }) {
  const style = PROVIDER_STYLE[provider] ?? { bg: 'rgba(107,114,128,.15)', color: '#9ca3af', label: provider };
  const modelShort = model
    ? model.includes('haiku') ? 'Haiku' : model.includes('sonnet') ? 'Sonnet' : model.includes('opus') ? 'Opus' : null
    : null;
  return (
    <span title={model ?? undefined} style={{
      fontFamily: 'monospace', fontSize: 10, fontWeight: 600,
      background: style.bg, color: style.color,
      padding: '1px 6px', borderRadius: 4, flexShrink: 0,
      display: 'inline-flex', alignItems: 'center', gap: 4,
    }}>
      {style.label}
      {modelShort && <span style={{ opacity: 0.7, fontWeight: 400 }}>·{modelShort}</span>}
    </span>
  );
}

function PBar({ pct, color, h = 5 }: { pct: number; color: string; h?: number }) {
  return (
    <div style={{ background: '#1f2937', borderRadius: 99, height: h, overflow: 'hidden' }}>
      <div style={{ width: `${Math.min(Math.max(pct, 0), 100)}%`, height: '100%', background: color, borderRadius: 99, transition: 'width .5s ease' }} />
    </div>
  );
}

function Ring({ pct, color, size = 52, label, value }: { pct: number; color: string; size?: number; label: string; value: string }) {
  const r = size / 2 - 5;
  const circ = 2 * Math.PI * r;
  const dash = (Math.min(Math.max(pct, 0), 100) / 100) * circ;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
      <div style={{ position: 'relative', width: size, height: size }}>
        <svg width={size} height={size} style={{ transform: 'rotate(-90deg)', display: 'block' }}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#1f2937" strokeWidth={5} />
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={5}
            strokeDasharray={`${dash} ${circ - dash}`} strokeLinecap="round"
            style={{ transition: 'stroke-dasharray .5s ease' }} />
        </svg>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'monospace', fontSize: 11, fontWeight: 700, color }}>
          {value}
        </div>
      </div>
      <div style={{ fontSize: 9, color: '#6e7681', letterSpacing: .5, textTransform: 'uppercase' }}>{label}</div>
    </div>
  );
}

function Skel() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {[70, 90, 55].map((w, i) => (
        <div key={i} style={{ height: 12, background: '#1f2937', borderRadius: 4, width: `${w}%`, animation: 'lmPulse 1.5s ease-in-out infinite', animationDelay: `${i * 0.2}s` }} />
      ))}
    </div>
  );
}

// ── Agent row ─────────────────────────────────────────────────────

function AgentRow({ type, pid, cpu, mem, startTime, title, skill, accent, onKilled, providerInfo }: {
  type: 'foreground' | 'background';
  pid: number; cpu: string; mem: string; startTime: string;
  title: string; skill?: string; accent: string;
  onKilled?: (pid: number) => void;
  providerInfo?: ProviderInfo | null;
}) {
  const [open, setOpen] = useState(false);
  const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(null);
  const [killState, setKillState] = useState<KillState>('idle');
  const stale = isStale(startTime);
  const rowAccent = stale ? '#6e7681' : accent;
  const cpuVal = parseFloat(cpu);
  const relTime = fmtRelTime(startTime);

  useEffect(() => {
    if (!open || sessionInfo) return;
    fetch(`/api/cluster/session-info/${pid}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => d && setSessionInfo(d))
      .catch(() => null);
  }, [open, pid, sessionInfo]);

  function handleKill(e: React.MouseEvent) {
    e.stopPropagation();
    if (killState === 'idle') {
      setKillState('confirm');
      setTimeout(() => setKillState(s => s === 'confirm' ? 'idle' : s), 3000);
    } else if (killState === 'confirm') {
      setKillState('killing');
      fetch('/api/cluster/kill-session', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pid }),
      }).then(r => r.json()).then(d => {
        if (d.ok) { setKillState('sent'); setTimeout(() => onKilled?.(pid), 5000); }
        else setKillState('idle');
      }).catch(() => setKillState('idle'));
    }
  }

  return (
    <div
      onClick={() => setOpen(o => !o)}
      style={{
        borderRadius: 8, cursor: 'pointer',
        background: open ? '#0d1117' : (stale ? 'rgba(110,118,129,.05)' : 'transparent'),
        border: `1px solid ${open ? rowAccent + '40' : (stale ? '#30363d' : 'transparent')}`,
        borderLeft: `3px solid ${killState === 'sent' ? '#6e7681' : rowAccent}`,
        transition: 'all .15s', overflow: 'hidden',
        opacity: stale ? 0.65 : (killState === 'sent' ? 0.4 : 1),
      }}
    >
      {/* Row header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px' }}>
        <Dot color={rowAccent} pulse={type === 'background' && !stale} />
        {stale && (
          <span style={{ fontFamily: 'monospace', fontSize: 10, color: '#f59e0b', background: 'rgba(245,158,11,.12)', padding: '1px 6px', borderRadius: 4, flexShrink: 0 }}>
            旧
          </span>
        )}
        {providerInfo && (
          <ProviderBadge provider={providerInfo.provider} model={providerInfo.model} />
        )}
        {skill && (
          <span style={{ fontFamily: 'monospace', fontSize: 10, color: '#58a6ff', background: 'rgba(88,166,255,.1)', padding: '1px 6px', borderRadius: 4, flexShrink: 0 }}>
            {skill}
          </span>
        )}
        <span style={{ fontSize: 12, color: stale ? '#6e7681' : '#c9d1d9', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {killState === 'sent' ? '已发送终止信号…' : clip(title, 60)}
        </span>
        <span style={{ fontFamily: 'monospace', fontSize: 11, color: cpuVal > 30 ? '#f59e0b' : '#484f58', flexShrink: 0 }}>{cpu}</span>
        <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#484f58', flexShrink: 0 }}>{mem}</span>
        <span style={{ fontFamily: 'monospace', fontSize: 10, color: stale ? '#f59e0b' : '#6e7681', flexShrink: 0 }}>{relTime}</span>
        {type === 'foreground' && killState !== 'sent' && (
          <button onClick={handleKill} style={{
            padding: '2px 9px', borderRadius: 5, border: 'none', cursor: 'pointer',
            fontSize: 11, fontWeight: 700, fontFamily: 'monospace', flexShrink: 0,
            background: killState === 'confirm' ? 'rgba(239,68,68,.8)' : 'rgba(239,68,68,.12)',
            color: killState === 'confirm' ? '#fff' : '#f87171', transition: 'all .15s',
          }}>
            {killState === 'killing' ? '…' : killState === 'confirm' ? '确认' : 'Kill'}
          </button>
        )}
        <span style={{ fontSize: 9, color: '#484f58', transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s', flexShrink: 0 }}>▶</span>
      </div>

      {/* Expanded detail */}
      {open && (
        <div style={{ padding: '0 12px 10px', borderTop: `1px solid ${rowAccent}20`, paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {[
              { l: 'PID', v: String(pid) },
              { l: 'CPU', v: cpu },
              { l: '内存', v: mem },
              { l: '启动', v: relTime },
              ...(providerInfo ? [{ l: 'Provider', v: (PROVIDER_STYLE[providerInfo.provider]?.label ?? providerInfo.provider) + (providerInfo.model ? ` (${providerInfo.model})` : '') }] : []),
              ...(skill ? [{ l: 'Skill', v: skill }] : []),
            ].map(({ l, v }) => (
              <div key={l}>
                <div style={{ fontSize: 9, color: '#484f58', textTransform: 'uppercase', letterSpacing: .8, marginBottom: 2 }}>{l}</div>
                <div style={{ fontFamily: 'monospace', fontSize: 11, color: '#8b949e' }}>{v}</div>
              </div>
            ))}
          </div>
          {type === 'foreground' && (
            <div style={{ background: '#0d1117', borderRadius: 6, padding: '8px 12px' }}>
              <div style={{ fontSize: 9, color: '#484f58', textTransform: 'uppercase', letterSpacing: .8, marginBottom: 4 }}>工作目录</div>
              {sessionInfo
                ? <div>
                    <div style={{ fontFamily: 'monospace', fontSize: 12, color: '#58a6ff', marginBottom: 2 }}>{sessionInfo.projectName ?? '(unknown)'}</div>
                    <div style={{ fontFamily: 'monospace', fontSize: 10, color: '#484f58' }}>{sessionInfo.cwd ?? '无法读取'}</div>
                  </div>
                : <div style={{ fontFamily: 'monospace', fontSize: 11, color: '#484f58', animation: 'lmPulse 1.5s ease-in-out infinite' }}>读取中…</div>
              }
            </div>
          )}
          {stale && (
            <div style={{ background: 'rgba(245,158,11,.08)', border: '1px solid rgba(245,158,11,.2)', borderRadius: 6, padding: '8px 12px', fontSize: 11, color: '#f59e0b' }}>
              ⚠ 此进程已运行 {relTime}，可能是已关闭终端的残留会话。点击 Kill 可安全终止。
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Active Projects ───────────────────────────────────────────────

interface SubGroup {
  id: string;
  name: string;
  inProgress: BrainTask[];
  queued: BrainTask[];
}
interface RootGroup {
  id: string;
  name: string;
  subs: Map<string, SubGroup>;
}

function ActiveProjects({ inProgressTasks, queuedTasks, projects }: {
  inProgressTasks: BrainTask[];
  queuedTasks: BrainTask[];
  projects: Project[];
}) {
  // 完整项目 map (id → Project)
  const fullProjMap = new Map<string, Project>(projects.map(p => [p.id, p]));

  // 沿 parent_id 链向上遍历，返回根项目
  function findRoot(id: string): Project | undefined {
    let cur = fullProjMap.get(id);
    if (!cur) return undefined;
    const seen = new Set<string>();
    while (cur.parent_id && !seen.has(cur.id)) {
      seen.add(cur.id);
      const parent = fullProjMap.get(cur.parent_id);
      if (!parent) break;
      cur = parent;
    }
    return cur;
  }

  const allTasks = [...inProgressTasks, ...queuedTasks];
  const rootMap = new Map<string, RootGroup>();

  for (const t of allTasks) {
    const leafId = t.project_id ?? '__none__';
    const leafName = leafId === '__none__' ? '未分配' : (fullProjMap.get(leafId)?.name ?? leafId.slice(0, 12));

    let rootId: string;
    let rootName: string;
    if (leafId === '__none__') {
      rootId = '__none__';
      rootName = '未分配项目';
    } else {
      const root = findRoot(leafId);
      rootId = root?.id ?? leafId;
      rootName = root?.name ?? leafName;
    }

    if (!rootMap.has(rootId)) {
      rootMap.set(rootId, { id: rootId, name: rootName, subs: new Map() });
    }
    const rg = rootMap.get(rootId)!;
    if (!rg.subs.has(leafId)) {
      rg.subs.set(leafId, { id: leafId, name: leafName, inProgress: [], queued: [] });
    }
    const sg = rg.subs.get(leafId)!;
    if (t.status === 'in_progress') sg.inProgress.push(t);
    else sg.queued.push(t);
  }

  // 按进行中数量降序排列根项目
  const sortedRoots = [...rootMap.values()].sort((a, b) => {
    const aIP = [...a.subs.values()].reduce((s, sg) => s + sg.inProgress.length, 0);
    const bIP = [...b.subs.values()].reduce((s, sg) => s + sg.inProgress.length, 0);
    if (bIP !== aIP) return bIP - aIP;
    const aQ = [...a.subs.values()].reduce((s, sg) => s + sg.queued.length, 0);
    const bQ = [...b.subs.values()].reduce((s, sg) => s + sg.queued.length, 0);
    return bQ - aQ;
  });

  if (sortedRoots.length === 0) {
    return (
      <div style={{ padding: 16, textAlign: 'center', color: '#484f58', fontSize: 12, border: '1px dashed #21262d', borderRadius: 8 }}>
        暂无进行中的项目
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
      {sortedRoots.map(rg => {
        const totalIP = [...rg.subs.values()].reduce((s, sg) => s + sg.inProgress.length, 0);
        const totalQ = [...rg.subs.values()].reduce((s, sg) => s + sg.queued.length, 0);
        const hasActive = totalIP > 0;
        const accent = hasActive ? '#10b981' : '#f59e0b';
        const sortedSubs = [...rg.subs.values()].sort((a, b) => b.inProgress.length - a.inProgress.length);
        return (
          <div key={rg.id} style={{
            background: '#0d1117', borderRadius: 10,
            border: '1px solid #21262d',
            borderLeft: `3px solid ${accent}`,
            padding: '12px 14px',
          }}>
            {/* 根项目 header */}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 10 }}>
              <Dot color={accent} pulse={hasActive} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#c9d1d9', lineHeight: 1.3, marginBottom: 5 }}>
                  {clip(rg.name, 40)}
                </div>
                <div style={{ display: 'flex', gap: 5 }}>
                  {totalIP > 0 && (
                    <span style={{ fontSize: 10, color: '#10b981', background: 'rgba(16,185,129,.12)', padding: '1px 6px', borderRadius: 4 }}>
                      ● {totalIP} 进行中
                    </span>
                  )}
                  {totalQ > 0 && (
                    <span style={{ fontSize: 10, color: '#f59e0b', background: 'rgba(245,158,11,.12)', padding: '1px 6px', borderRadius: 4 }}>
                      ◎ {totalQ} 排队
                    </span>
                  )}
                </div>
              </div>
            </div>
            {/* 子项目行（或任务行，当任务直挂根项目时） */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {sortedSubs.map(sg => {
                const isRoot = sg.id === rg.id;
                const sgAccent = sg.inProgress.length > 0 ? '#10b981' : '#484f58';
                const allItems = [...sg.inProgress, ...sg.queued];
                if (isRoot) {
                  // 任务直挂根项目，显示任务行
                  return (
                    <div key={sg.id}>
                      {allItems.slice(0, 3).map(t => (
                        <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0' }}>
                          <PBadge p={t.priority} />
                          <span style={{ fontSize: 10, color: t.status === 'in_progress' ? '#8b949e' : '#484f58', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {clip(cleanTaskTitle(t.title), 36)}
                          </span>
                          {t.status === 'in_progress' && <Dot color="#10b981" pulse />}
                        </div>
                      ))}
                    </div>
                  );
                }
                return (
                  <div key={sg.id} style={{
                    display: 'flex', alignItems: 'center', gap: 7,
                    padding: '5px 8px', background: '#161b22', borderRadius: 6,
                  }}>
                    <Dot color={sgAccent} pulse={sg.inProgress.length > 0} />
                    <span style={{ fontSize: 11, color: '#8b949e', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {clip(sg.name, 30)}
                    </span>
                    <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                      {sg.inProgress.length > 0 && (
                        <span style={{ fontFamily: 'monospace', fontSize: 10, color: '#10b981' }}>{sg.inProgress.length}进</span>
                      )}
                      {sg.queued.length > 0 && (
                        <span style={{ fontFamily: 'monospace', fontSize: 10, color: '#f59e0b' }}>{sg.queued.length}排</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Main ─────────────────────────────────────────────────────────

export default function LiveMonitorPage() {
  const [brainStatus, setBrainStatus] = useState<BrainStatus | null>(null);
  const [tick, setTick] = useState<TickStatus | null>(null);
  const [activeTasks, setActiveTasks] = useState<BrainTask[]>([]);
  const [queuedTasks, setQueuedTasks] = useState<BrainTask[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [cluster, setCluster] = useState<ClusterStatus | null>(null);
  const [vps, setVps] = useState<VpsStats | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [cd, setCd] = useState(5);
  const [fullscreen, setFullscreen] = useState(false);
  const [killedPids, setKilledPids] = useState<Set<number>>(new Set());
  const [providerMap, setProviderMap] = useState<Record<number, ProviderInfo>>({});
  const handleKilled = useCallback((pid: number) => setKilledPids(s => new Set([...s, pid])), []);

  const load = useCallback(async () => {
    const r = await Promise.allSettled([
      fetch('/api/brain/status').then(x => x.json()),
      fetch('/api/brain/tick/status').then(x => x.json()),
      fetch('/api/brain/tasks?status=in_progress').then(x => x.json()),
      fetch('/api/brain/tasks?status=queued').then(x => x.json()),
      fetch('/api/tasks/projects').then(x => x.json()),
      fetch('/api/brain/cluster/status').then(x => x.json()),
      fetch('/api/v1/vps-monitor/stats').then(x => x.json()),
      fetch('/api/v1/vps-monitor/services').then(x => x.json()),
    ]);
    if (r[0].status === 'fulfilled') setBrainStatus(r[0].value);
    if (r[1].status === 'fulfilled') setTick(r[1].value);
    if (r[2].status === 'fulfilled') setActiveTasks(Array.isArray(r[2].value) ? r[2].value : []);
    if (r[3].status === 'fulfilled') setQueuedTasks(Array.isArray(r[3].value) ? r[3].value : []);
    if (r[4].status === 'fulfilled' && Array.isArray(r[4].value)) setProjects(r[4].value);
    if (r[5].status === 'fulfilled') {
      const c = r[5].value?.cluster ?? null;
      setCluster(c);
      // 批量获取所有进程的 provider 信息
      const procs = c?.servers?.[0]?.slots?.processes ?? [];
      if (procs.length > 0) {
        const pids = procs.map((p: ClusterProcess) => p.pid).join(',');
        fetch(`/api/cluster/session-providers?pids=${pids}`)
          .then(x => x.ok ? x.json() : {})
          .then(data => setProviderMap(data))
          .catch(() => null);
      }
    }
    if (r[6].status === 'fulfilled') setVps(r[6].value);
    if (r[7].status === 'fulfilled') setServices(r[7].value?.services || []);
    setUpdatedAt(new Date());
    setCd(5);
  }, []);

  useEffect(() => {
    load();
    const poll = setInterval(load, 5000);
    const cdTimer = setInterval(() => setCd(c => c <= 1 ? 5 : c - 1), 1000);
    return () => { clearInterval(poll); clearInterval(cdTimer); };
  }, [load]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') setFullscreen(false); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, []);

  // Derived
  const focus = brainStatus?.daily_focus;
  const stats = brainStatus?.task_digest?.stats;
  const alertName = tick?.alertness?.levelName ?? 'NORMAL';
  const alertColor = ALERT_COLOR[alertName] ?? '#6e7681';
  const svcUp = services.filter(s => s.status === 'running').length;
  const svcDown = services.filter(s => s.status !== 'running').length;

  const allProcs = (cluster?.servers?.[0]?.slots?.processes ?? []).filter(p => !killedPids.has(p.pid));
  const foregroundProcs = allProcs.filter(p => classifyProcess(p.command) === 'foreground');
  const backgroundProcs = allProcs.filter(p => classifyProcess(p.command) === 'background');
  const totalAgents = foregroundProcs.length + backgroundProcs.length;

  const wrapStyle: React.CSSProperties = fullscreen
    ? { position: 'fixed', inset: 0, zIndex: 9999, overflowY: 'auto', background: '#0d1117' }
    : { background: '#0d1117', minHeight: '100vh' };

  return (
    <>
      <style>{`
        @keyframes lmPulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.4;transform:scale(.7)} }
        .lm-btn { opacity:.6; transition:opacity .2s,background .15s; }
        .lm-btn:hover { opacity:1; background:#21262d !important; }
      `}</style>

      <div style={{ ...wrapStyle, color: '#e6edf3', fontFamily: '"Inter", system-ui, sans-serif' }}>

        {/* ══ TOP BAR ══ */}
        <div style={{
          height: 46, background: '#161b22', borderBottom: '1px solid #21262d',
          display: 'flex', alignItems: 'center', padding: '0 20px', gap: 12,
          position: 'sticky', top: 0, zIndex: 100,
        }}>
          <Dot color="#10b981" pulse />
          <span style={{ fontFamily: 'monospace', fontSize: 11, fontWeight: 700, color: '#10b981', letterSpacing: 2 }}>LIVE</span>
          <span style={{ color: '#30363d' }}>│</span>
          <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#6e7681' }}>CECELIA NOC</span>

          <div title={ALERT_DESC[alertName] ?? ''} style={{ background: alertColor + '1a', border: `1px solid ${alertColor}40`, borderRadius: 20, padding: '2px 12px', display: 'flex', alignItems: 'center', gap: 6, cursor: 'help' }}>
            <Dot color={alertColor} />
            <span style={{ fontFamily: 'monospace', fontSize: 11, fontWeight: 700, color: alertColor }}>{ALERT_LABEL[alertName] ?? alertName}</span>
          </div>

          {[
            { n: foregroundProcs.length, label: '前台', color: '#3b82f6' },
            { n: backgroundProcs.length, label: '后台', color: backgroundProcs.length > 0 ? '#10b981' : '#6e7681' },
            { n: queuedTasks.length, label: '排队', color: queuedTasks.length > 3 ? '#f59e0b' : '#6e7681' },
          ].map(({ n, label, color }) => (
            <span key={label} style={{ background: '#21262d', borderRadius: 6, padding: '2px 10px', fontFamily: 'monospace', fontSize: 11 }}>
              <span style={{ color, fontWeight: 700 }}>{n}</span>
              <span style={{ color: '#484f58', marginLeft: 4 }}>{label}</span>
            </span>
          ))}

          <div style={{ flex: 1 }} />
          <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#484f58' }}>
            {updatedAt?.toLocaleTimeString('zh-CN') ?? '—'}
          </span>
          <span style={{ background: '#21262d', fontFamily: 'monospace', fontSize: 11, color: '#6e7681', padding: '2px 8px', borderRadius: 6 }}>↻ {cd}s</span>
          <button onClick={() => setFullscreen(f => !f)} className="lm-btn"
            style={{ background: 'transparent', border: '1px solid #30363d', borderRadius: 6, padding: '4px 12px', color: '#8b949e', cursor: 'pointer', fontSize: 12 }}>
            {fullscreen ? '⊠ 收起' : '⛶ 全屏'}
          </button>
        </div>

        <div style={{ padding: '16px 20px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* ══ OKR + 今日快照 ══ */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>

            {/* 当前 OKR */}
            <div style={{ background: '#161b22', border: '1px solid #21262d', borderRadius: 12, padding: '18px 20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: '#c084fc', letterSpacing: 1.4, textTransform: 'uppercase' }}>当前 OKR</span>
                <span style={{ fontSize: 10, color: '#484f58', background: '#21262d', padding: '1px 6px', borderRadius: 4 }}>今日焦点</span>
                <div style={{ flex: 1, height: 1, background: '#21262d' }} />
              </div>
              {focus ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 16, alignItems: 'start' }}>
                  <div style={{ textAlign: 'center', minWidth: 56 }}>
                    <div style={{ fontFamily: 'monospace', fontSize: 44, fontWeight: 700, lineHeight: 1, color: krColor(focus.progress), letterSpacing: -2 }}>
                      {focus.progress}
                    </div>
                    <div style={{ fontFamily: 'monospace', fontSize: 12, color: '#6e7681' }}>%</div>
                    <div style={{ marginTop: 6 }}>
                      <span style={{ fontFamily: 'monospace', fontSize: 10, background: 'rgba(245,158,11,.15)', color: '#fbbf24', padding: '1px 6px', borderRadius: 3 }}>{focus.priority}</span>
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 13, color: '#c9d1d9', marginBottom: 12, lineHeight: 1.4 }}>{clip(focus.objective_title, 52)}</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {focus.key_results.map(kr => {
                        const tag = kr.title.match(/^(KR\d+)/)?.[1] ?? 'KR';
                        const label = kr.title.replace(/^KR\d+:\s*/, '').split('——')[0].trim();
                        const c = krColor(kr.progress);
                        return (
                          <div key={kr.id}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                              <span style={{ fontFamily: 'monospace', fontSize: 10, fontWeight: 700, color: c, background: c + '1a', padding: '1px 5px', borderRadius: 3, flexShrink: 0 }}>{tag}</span>
                              <span style={{ fontSize: 11, color: '#8b949e', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
                              <span style={{ fontFamily: 'monospace', fontSize: 11, fontWeight: 700, color: c, flexShrink: 0 }}>{kr.progress}%</span>
                            </div>
                            <PBar pct={kr.progress} color={c} h={3} />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ) : <Skel />}
            </div>

            {/* 今日快照 */}
            <div style={{ background: '#161b22', border: '1px solid #21262d', borderRadius: 12, padding: '18px 20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: '#58a6ff', letterSpacing: 1.4, textTransform: 'uppercase' }}>今日快照</span>
                <div style={{ flex: 1, height: 1, background: '#21262d' }} />
                {tick && <span style={{ fontFamily: 'monospace', fontSize: 10, color: '#484f58' }}>{tick.actions_today} ticks</span>}
              </div>

              {stats ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8, marginBottom: 14 }}>
                  {[
                    { label: 'P0 待办', value: stats.open_p0, color: stats.open_p0 > 0 ? '#f87171' : '#484f58' },
                    { label: 'P1 待办', value: stats.open_p1, color: stats.open_p1 > 0 ? '#fbbf24' : '#484f58' },
                    { label: '进行中', value: stats.in_progress, color: '#10b981' },
                    { label: '排队中', value: stats.queued, color: stats.queued > 0 ? '#f59e0b' : '#484f58' },
                    { label: '逾期', value: stats.overdue, color: stats.overdue > 0 ? '#ef4444' : '#484f58' },
                  ].map(({ label, value, color }) => (
                    <div key={label} style={{ background: '#0d1117', borderRadius: 8, padding: '10px 8px', textAlign: 'center' }}>
                      <div style={{ fontFamily: 'monospace', fontSize: 24, fontWeight: 700, color, lineHeight: 1 }}>{value}</div>
                      <div style={{ fontSize: 9, color: '#484f58', textTransform: 'uppercase', letterSpacing: .6, marginTop: 5 }}>{label}</div>
                    </div>
                  ))}
                </div>
              ) : <Skel />}

              <div style={{ display: 'flex', gap: 10 }}>
                <div style={{ background: '#0d1117', borderRadius: 8, padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
                  {[
                    { n: foregroundProcs.length, label: '前台', color: '#3b82f6' },
                    { n: backgroundProcs.length, label: '后台', color: '#10b981' },
                    { n: totalAgents, label: 'Agent', color: '#c9d1d9' },
                  ].map(({ n, label, color }, i) => (
                    <div key={label} style={{ display: 'flex', alignItems: 'center' }}>
                      {i > 0 && <div style={{ width: 1, height: 24, background: '#21262d', marginRight: 10 }} />}
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontFamily: 'monospace', fontSize: 18, fontWeight: 700, color }}>{n}</div>
                        <div style={{ fontSize: 9, color: '#484f58', textTransform: 'uppercase', letterSpacing: .6, marginTop: 2 }}>{label}</div>
                      </div>
                    </div>
                  ))}
                </div>
                {tick?.last_dispatch && (
                  <div style={{ background: '#0d1117', borderRadius: 8, padding: '8px 14px', flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 9, color: '#484f58', textTransform: 'uppercase', letterSpacing: .8, marginBottom: 4 }}>上次派发</div>
                    <div style={{ fontSize: 12, color: '#c9d1d9', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {clip(tick.last_dispatch.task_title, 40)}
                    </div>
                    <div style={{ fontFamily: 'monospace', fontSize: 10, color: '#484f58', marginTop: 2 }}>
                      {fmtAgo(tick.last_dispatch.dispatched_at)} · {tick.slot_budget.dispatchAllowed ? 'OPEN' : 'HOLD'}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ══ 活跃项目 ══ */}
          <div style={{ background: '#161b22', border: '1px solid #21262d', borderRadius: 12, padding: '18px 20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: '#f59e0b', letterSpacing: 1.4, textTransform: 'uppercase' }}>活跃项目</span>
              <span style={{
                background: activeTasks.length > 0 ? 'rgba(245,158,11,.15)' : '#21262d',
                color: activeTasks.length > 0 ? '#fbbf24' : '#6e7681',
                fontFamily: 'monospace', fontSize: 11, padding: '1px 8px', borderRadius: 10, fontWeight: 700,
              }}>
                {activeTasks.length} 进行中 · {queuedTasks.length} 排队
              </span>
              <div style={{ flex: 1, height: 1, background: '#21262d' }} />
            </div>
            <ActiveProjects inProgressTasks={activeTasks} queuedTasks={queuedTasks} projects={projects} />
          </div>

          {/* ══ 实时 Agents ══ */}
          <div style={{ background: '#161b22', border: '1px solid #21262d', borderRadius: 12, padding: '18px 20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: '#e6edf3', letterSpacing: 1.4, textTransform: 'uppercase' }}>实时 Agents</span>
              <span style={{ background: totalAgents > 0 ? 'rgba(16,185,129,.15)' : '#21262d', color: totalAgents > 0 ? '#10b981' : '#6e7681', fontFamily: 'monospace', fontSize: 11, padding: '1px 8px', borderRadius: 10, fontWeight: 700 }}>
                {totalAgents} active
              </span>
              <div style={{ flex: 1, height: 1, background: '#21262d' }} />
              <span style={{ fontSize: 10, color: '#484f58' }}>slots {cluster?.total_used ?? '—'} / {cluster?.total_slots ?? '—'}</span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              {/* 前台 */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <Dot color="#3b82f6" />
                  <span style={{ fontSize: 11, fontWeight: 600, color: '#3b82f6' }}>前台 · 交互式</span>
                  <span style={{ fontFamily: 'monospace', fontSize: 10, color: '#3b82f6', background: 'rgba(59,130,246,.15)', padding: '0 6px', borderRadius: 8 }}>{foregroundProcs.length}</span>
                </div>
                {foregroundProcs.length === 0 ? (
                  <div style={{ padding: 12, textAlign: 'center', color: '#484f58', fontSize: 12, border: '1px dashed #21262d', borderRadius: 8 }}>暂无前台会话</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {foregroundProcs.map(p => (
                      <AgentRow key={p.pid} type="foreground" pid={p.pid} cpu={p.cpu} mem={p.memory}
                        startTime={p.startTime} title="Claude Code 交互式会话"
                        accent="#3b82f6" onKilled={handleKilled}
                        providerInfo={providerMap[p.pid] ?? { provider: 'anthropic', model: null }} />
                    ))}
                  </div>
                )}
              </div>
              {/* 后台 */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <Dot color="#10b981" pulse={backgroundProcs.length > 0} />
                  <span style={{ fontSize: 11, fontWeight: 600, color: '#10b981' }}>后台 · Brain 派发</span>
                  <span style={{ fontFamily: 'monospace', fontSize: 10, color: '#10b981', background: 'rgba(16,185,129,.15)', padding: '0 6px', borderRadius: 8 }}>{backgroundProcs.length}</span>
                </div>
                {backgroundProcs.length === 0 ? (
                  <div style={{ padding: 12, textAlign: 'center', color: '#484f58', fontSize: 12, border: '1px dashed #21262d', borderRadius: 8 }}>暂无后台任务</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {backgroundProcs.map(p => {
                      const { skill, taskTitle } = parseBackgroundCmd(p.command);
                      return (
                        <AgentRow key={p.pid} type="background" pid={p.pid} cpu={p.cpu} mem={p.memory}
                          startTime={p.startTime} title={taskTitle} skill={skill} accent="#10b981"
                          providerInfo={providerMap[p.pid] ?? null} />
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* 等待队列 */}
            {queuedTasks.length > 0 && (
              <div style={{ marginTop: 14, borderTop: '1px solid #21262d', paddingTop: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: '#f59e0b', letterSpacing: 1, textTransform: 'uppercase' }}>等待队列</span>
                  <span style={{ fontFamily: 'monospace', fontSize: 10, color: '#f59e0b', background: 'rgba(245,158,11,.15)', padding: '0 6px', borderRadius: 8 }}>{queuedTasks.length}</span>
                  <div style={{ flex: 1, height: 1, background: '#21262d' }} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 6 }}>
                  {queuedTasks.slice(0, 8).map((t, i) => (
                    <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderRadius: 6, background: '#0d1117', border: '1px solid #21262d' }}>
                      <span style={{ fontFamily: 'monospace', fontSize: 10, color: '#484f58', flexShrink: 0 }}>#{i + 1}</span>
                      <PBadge p={t.priority} />
                      <span style={{ fontSize: 11, color: '#8b949e', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{clip(t.title, 45)}</span>
                      <span style={{ fontFamily: 'monospace', fontSize: 10, color: '#484f58', flexShrink: 0 }}>{fmtAgo(t.created_at)}</span>
                    </div>
                  ))}
                  {queuedTasks.length > 8 && (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 7, borderRadius: 6, background: '#0d1117', border: '1px dashed #21262d', color: '#484f58', fontSize: 11 }}>
                      +{queuedTasks.length - 8} 个任务
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* ══ 基础设施 ══ */}
          <div style={{ background: '#161b22', border: '1px solid #21262d', borderRadius: 12, padding: '12px 20px' }}>
            <div style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 9, color: '#484f58', letterSpacing: 1.2, textTransform: 'uppercase', flexShrink: 0 }}>基础设施</span>
              {vps && (
                <>
                  <Ring pct={vps.cpu.usage} color={metricColor(vps.cpu.usage)} label="CPU" value={`${vps.cpu.usage.toFixed(0)}%`} />
                  <Ring pct={vps.memory.usagePercent} color={metricColor(vps.memory.usagePercent)} label="RAM" value={`${vps.memory.usagePercent.toFixed(0)}%`} />
                  <Ring pct={vps.disk.usagePercent} color={metricColor(vps.disk.usagePercent)} label="DISK" value={`${vps.disk.usagePercent}%`} />
                  <div style={{ width: 1, height: 40, background: '#21262d' }} />
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, max-content)', gap: '2px 16px' }}>
                    {[
                      { l: 'LOAD', v: String(vps.cpu.loadAverage['1min']) },
                      { l: 'CORES', v: String(vps.cpu.cores) },
                      { l: 'MEM', v: `${fmtBytes(vps.memory.used)}/${fmtBytes(vps.memory.total)}` },
                      { l: 'UPTIME', v: fmtUptime(vps.uptime) },
                    ].map(({ l, v }) => (
                      <div key={l}>
                        <div style={{ fontSize: 9, color: '#484f58', letterSpacing: 1, textTransform: 'uppercase' }}>{l}</div>
                        <div style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 600, color: '#c9d1d9' }}>{v}</div>
                      </div>
                    ))}
                  </div>
                </>
              )}
              <div style={{ width: 1, height: 40, background: '#21262d' }} />
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                {svcUp > 0 && <span style={{ background: 'rgba(16,185,129,.15)', color: '#10b981', fontSize: 12, fontWeight: 700, padding: '2px 10px', borderRadius: 20 }}>{svcUp} up</span>}
                {svcDown > 0 && <span style={{ background: 'rgba(239,68,68,.15)', color: '#ef4444', fontSize: 12, fontWeight: 700, padding: '2px 10px', borderRadius: 20 }}>{svcDown} down</span>}
                {services.slice(0, 6).map(s => (
                  <div key={s.containerName} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Dot color={s.status === 'running' ? '#10b981' : '#ef4444'} />
                    <span style={{ fontSize: 11, color: '#6e7681' }}>{s.containerName}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
