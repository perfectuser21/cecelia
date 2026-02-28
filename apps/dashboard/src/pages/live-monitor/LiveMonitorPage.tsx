/**
 * LiveMonitor v14 — v3.3 全面重构布局
 * LEFT (240px): 🖥️ US VPS (donut CPU + bars) | 🖥️ HK VPS | 💳 Account (rings) | 🤖 Agents (compact dots)
 * RIGHT (1fr):  📊 OKR 总览 (Global→Area 分层) | 📁 Projects by Area + Queue
 */

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

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
  type: string;
  status: string;
  parent_id: string | null;
  goal_id: string | null;
}

interface GoalItem {
  id: string;
  title: string;
  type: 'area_okr' | 'global_okr' | 'kr';
  status: string;
  priority: string;
  progress: number;
  parent_id: string | null;
  custom_props?: { start_date?: string; end_date?: string };
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

interface AccountUsage {
  five_hour_pct: number;
  seven_day_pct: number;
  resets_at: string | null;
}

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

/** 圆盘图 — 用于 VPS CPU 显示 */
function Donut({ pct, color, size = 64 }: { pct: number; color: string; size?: number }) {
  const r = size / 2 - 8;
  const circ = 2 * Math.PI * r;
  const dash = (Math.min(Math.max(pct, 0), 100) / 100) * circ;
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)', display: 'block' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#1a2233" strokeWidth={10} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={10}
          strokeDasharray={`${dash} ${circ - dash}`} strokeLinecap="round"
          style={{ transition: 'stroke-dasharray .5s ease' }} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'monospace', fontSize: 13, fontWeight: 700, color }}>
        {pct.toFixed(0)}%
      </div>
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

// ── Account Usage Rings（嵌入左栏 Account 卡片）────────────────────

const ACCOUNTS = ['account1', 'account2', 'account3'];
const usageColor = (pct: number) => pct >= 80 ? '#ef4444' : pct >= 50 ? '#f59e0b' : '#10b981';

function AccUsageRings() {
  const [usage, setUsage] = useState<Record<string, AccountUsage> | null>(null);

  const fetchUsage = useCallback(async () => {
    try {
      const res = await fetch('/api/brain/account-usage');
      if (!res.ok) return;
      const data = await res.json();
      if (data.ok) setUsage(data.usage);
    } catch { /* 静默，不影响左栏显示 */ }
  }, []);

  useEffect(() => {
    fetchUsage();
    const t = setInterval(fetchUsage, 60000);
    return () => clearInterval(t);
  }, [fetchUsage]);

  if (!usage) return null;

  const bestId = Object.entries(usage).reduce<{ id: string; pct: number } | null>((best, [id, u]) => {
    if (!best || u.five_hour_pct < best.pct) return { id, pct: u.five_hour_pct };
    return best;
  }, null)?.id;

  return (
    <>
      {ACCOUNTS.map(id => {
        const u = usage[id];
        const pct = u?.five_hour_pct ?? 0;
        const isBest = id === bestId;
        const color = isBest ? '#818cf8' : usageColor(pct);
        const label = id.replace('account', 'ACC');
        const resetsAt = u?.resets_at
          ? new Date(u.resets_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
          : null;
        return (
          <div key={id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
            <Ring pct={pct} color={color} label={label} value={`${pct}%`} />
            {resetsAt && (
              <div style={{ fontSize: 8, color: '#484f58', fontFamily: 'monospace', marginTop: -2 }}>
                ↺{resetsAt}
              </div>
            )}
            {u?.seven_day_pct !== undefined && (
              <div style={{ fontSize: 8, color: '#484f58', fontFamily: 'monospace' }}>
                7d:{u.seven_day_pct}%
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

// ── Projects by Area ──────────────────────────────────────────────

const INACTIVE_STATUSES = new Set(['completed', 'archived', 'cancelled', 'done']);

function projStatusColor(s: string): string {
  if (s === 'in_progress' || s === 'active') return '#10b981';
  if (s === 'planning' || s === 'planned') return '#f59e0b';
  if (INACTIVE_STATUSES.has(s)) return '#484f58';
  return '#6e7681';
}
function projStatusLabel(s: string): string {
  const m: Record<string, string> = {
    in_progress: '进行中', active: '活跃', planning: '规划中', planned: '已规划',
    completed: '完成', archived: '归档', cancelled: '取消', done: '完成',
  };
  return m[s] ?? s;
}

function ProjectsByArea({ projects, allGoals, queuedTasks }: {
  projects: Project[];
  allGoals: GoalItem[];
  queuedTasks: BrainTask[];
}) {
  const navigate = useNavigate();
  const projMap = new Map(projects.map(p => [p.id, p]));

  /** 沿 goal_id → allGoals 链，找到归属的 area_okr.id */
  function findAreaId(goalId: string | null): string | null {
    if (!goalId) return null;
    const goal = allGoals.find(g => g.id === goalId);
    if (!goal) return null;
    if (goal.type === 'area_okr') return goal.id;
    if (goal.parent_id) {
      const parent = allGoals.find(g => g.id === goal.parent_id);
      if (parent?.type === 'area_okr') return parent.id;
    }
    return null;
  }

  const areaOkrs = allGoals.filter(g => g.type === 'area_okr' && !g.parent_id && !INACTIVE_STATUSES.has(g.status));
  const activeProjects = projects.filter(p => p.type === 'project' && !INACTIVE_STATUSES.has(p.status));
  const activeInits = projects.filter(p => p.type === 'initiative' && !INACTIVE_STATUSES.has(p.status));

  // 按 area 分组 projects
  const projsByArea = new Map<string, Project[]>();
  const noAreaProjs: Project[] = [];
  for (const proj of activeProjects) {
    const areaId = findAreaId(proj.goal_id);
    if (areaId) {
      if (!projsByArea.has(areaId)) projsByArea.set(areaId, []);
      projsByArea.get(areaId)!.push(proj);
    } else {
      noAreaProjs.push(proj);
    }
  }

  // Initiatives 按 parent project 分组
  const initsByProj = new Map<string, Project[]>();
  for (const ini of activeInits) {
    const key = ini.parent_id ?? '__none__';
    if (!initsByProj.has(key)) initsByProj.set(key, []);
    initsByProj.get(key)!.push(ini);
  }

  /** 计算某 area 下的 queued 任务数 */
  function countQueuedForArea(areaId: string): number {
    return queuedTasks.filter(t => {
      if (!t.project_id) return false;
      const proj = projMap.get(t.project_id);
      if (!proj) return false;
      if (findAreaId(proj.goal_id) === areaId) return true;
      if (proj.parent_id) {
        const parent = projMap.get(proj.parent_id);
        if (parent && findAreaId(parent.goal_id) === areaId) return true;
      }
      return false;
    }).length;
  }

  const areaGroups = areaOkrs.map(area => ({
    area,
    projs: projsByArea.get(area.id) ?? [],
    queuedCount: countQueuedForArea(area.id),
  })).filter(g => g.projs.length > 0);

  const hasAny = areaGroups.length > 0 || noAreaProjs.length > 0;

  if (!hasAny) {
    return (
      <div style={{ padding: 16, textAlign: 'center', color: '#484f58', fontSize: 12, border: '1px dashed #21262d', borderRadius: 8 }}>
        暂无活跃项目
      </div>
    );
  }

  function renderAreaGroup(label: string, projs: Project[], queuedCount: number) {
    return (
      <div style={{ marginBottom: 16 }}>
        {/* Area header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span style={{ fontSize: 9, fontWeight: 700, color: '#c084fc', letterSpacing: 1.2, textTransform: 'uppercase', flexShrink: 0 }}>{clip(label, 24)}</span>
          <div style={{ flex: 1, height: 1, background: 'rgba(192,132,252,.2)' }} />
          {queuedCount > 0 && (
            <span style={{ fontSize: 9, color: '#f59e0b', background: 'rgba(245,158,11,.12)', padding: '1px 6px', borderRadius: 10, flexShrink: 0, fontFamily: 'monospace' }}>
              {queuedCount} queued
            </span>
          )}
        </div>
        {/* Project cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 8 }}>
          {projs.map(proj => {
            const inis = initsByProj.get(proj.id) ?? [];
            const hasActive = inis.some(i => i.status === 'in_progress' || i.status === 'active');
            const projQueued = queuedTasks.filter(t => {
              if (!t.project_id) return false;
              const tp = projMap.get(t.project_id);
              return tp?.id === proj.id || tp?.parent_id === proj.id;
            }).length;
            const accent = hasActive ? '#3b82f6' : '#6e7681';
            return (
              <div key={proj.id}
                onClick={() => navigate('/work/projects')}
                style={{
                  background: '#0d1117', borderRadius: 8,
                  border: '1px solid #21262d',
                  borderLeft: `3px solid ${accent}`,
                  padding: '10px 12px', cursor: 'pointer',
                  transition: 'border-color .15s',
                }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = '#58a6ff')}
                onMouseLeave={e => (e.currentTarget.style.borderColor = '#21262d')}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                  <Dot color={accent} pulse={hasActive} />
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#c9d1d9', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {clip(proj.name, 30)}
                  </span>
                  {projQueued > 0 && (
                    <span style={{ fontSize: 9, color: '#f59e0b', background: 'rgba(245,158,11,.12)', padding: '1px 5px', borderRadius: 8, flexShrink: 0, fontFamily: 'monospace' }}>
                      {projQueued}q
                    </span>
                  )}
                </div>
                {inis.length === 0 ? (
                  <div style={{ fontSize: 10, color: '#484f58', fontStyle: 'italic', paddingLeft: 4 }}>暂无活跃 Initiative</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {inis.slice(0, 3).map(ini => {
                      const sc = projStatusColor(ini.status);
                      return (
                        <div key={ini.id} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '3px 7px', background: '#161b22', borderRadius: 5 }}>
                          <Dot color={sc} pulse={ini.status === 'in_progress'} />
                          <span style={{ fontSize: 10, color: '#8b949e', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {clip(ini.name, 28)}
                          </span>
                          <span style={{ fontSize: 9, color: sc, fontFamily: 'monospace', flexShrink: 0 }}>
                            {projStatusLabel(ini.status)}
                          </span>
                        </div>
                      );
                    })}
                    {inis.length > 3 && (
                      <div style={{ fontSize: 9, color: '#484f58', paddingLeft: 7 }}>+{inis.length - 3} 更多</div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div>
      {areaGroups.map(({ area, projs, queuedCount }) => (
        <div key={area.id}>
          {renderAreaGroup(area.title, projs, queuedCount)}
        </div>
      ))}
      {noAreaProjs.length > 0 && renderAreaGroup('未关联 Area', noAreaProjs, 0)}
    </div>
  );
}

// ── Main ─────────────────────────────────────────────────────────

export default function LiveMonitorPage() {
  const navigate = useNavigate();
  const [brainStatus, setBrainStatus] = useState<BrainStatus | null>(null);
  const [tick, setTick] = useState<TickStatus | null>(null);
  const [activeTasks, setActiveTasks] = useState<BrainTask[]>([]);
  const [queuedTasks, setQueuedTasks] = useState<BrainTask[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [cluster, setCluster] = useState<ClusterStatus | null>(null);
  const [vps, setVps] = useState<VpsStats | null>(null);
  const [hkVps, setHkVps] = useState<VpsStats | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [cd, setCd] = useState(5);
  const [fullscreen, setFullscreen] = useState(false);
  const [killedPids, setKilledPids] = useState<Set<number>>(new Set());
  const [providerMap, setProviderMap] = useState<Record<number, ProviderInfo>>({});
  const [allGoals, setAllGoals] = useState<GoalItem[]>([]);
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
      fetch('/api/cluster/scan-sessions').then(x => x.json()),
      fetch('/api/goals?limit=200').then(x => x.json()),
      fetch('/api/v1/vps-monitor/hk-stats').then(x => x.json()),
    ]);
    if (r[0].status === 'fulfilled') setBrainStatus(r[0].value);
    if (r[1].status === 'fulfilled') setTick(r[1].value);
    if (r[2].status === 'fulfilled') setActiveTasks(Array.isArray(r[2].value) ? r[2].value : []);
    if (r[3].status === 'fulfilled') setQueuedTasks(Array.isArray(r[3].value) ? r[3].value : []);
    if (r[4].status === 'fulfilled' && Array.isArray(r[4].value)) setProjects(r[4].value);
    if (r[9].status === 'fulfilled') {
      const goals = Array.isArray(r[9].value) ? r[9].value : [];
      setAllGoals(goals.filter((g: any) => ['area_okr', 'global_okr', 'kr'].includes(g.type)));
    }
    if (r[10].status === 'fulfilled' && !r[10].value?.error) setHkVps(r[10].value);
    if (r[5].status === 'fulfilled') {
      const c = r[5].value?.cluster ?? null;
      // Brain 容器无 --pid=host，ps aux 看不到宿主机进程。
      // 用 Core server（宿主机 pm2）扫描的结果覆盖 US 服务器的 processes。
      const scanResult = r[8].status === 'fulfilled' ? r[8].value : null;
      if (c?.servers?.[0] && scanResult?.processes) {
        c.servers[0].slots.processes = scanResult.processes;
        c.servers[0].slots.used = scanResult.total ?? scanResult.processes.length;
      }
      setCluster(c);
      // 批量获取所有进程的 provider 信息
      const procs: ClusterProcess[] = c?.servers?.[0]?.slots?.processes ?? [];
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
  const stats = brainStatus?.task_digest?.stats;
  const alertName = tick?.alertness?.levelName ?? 'NORMAL';
  const alertColor = ALERT_COLOR[alertName] ?? '#6e7681';
  const svcUp = services.filter(s => s.status === 'running').length;
  const svcDown = services.filter(s => s.status !== 'running').length;

  const allProcs = (cluster?.servers?.[0]?.slots?.processes ?? []).filter(p => !killedPids.has(p.pid));
  const foregroundProcs = allProcs.filter(p => classifyProcess(p.command) === 'foreground');
  const backgroundProcs = allProcs.filter(p => classifyProcess(p.command) === 'background');
  const totalAgents = foregroundProcs.length + backgroundProcs.length;

  const activeGlobals = allGoals.filter(g => g.type === 'global_okr' && !INACTIVE_STATUSES.has(g.status));
  const activeAreas = allGoals.filter(g => g.type === 'area_okr' && !g.parent_id && !INACTIVE_STATUSES.has(g.status));
  const todayMs = new Date(new Date().setHours(0, 0, 0, 0)).getTime();

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

        {/* ══ STATS STRIP ══ */}
        <div style={{ background: '#161b22', borderBottom: '1px solid #21262d', padding: '6px 20px', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          {stats && [
            { label: 'P0', value: stats.open_p0, color: stats.open_p0 > 0 ? '#f87171' : '#484f58' },
            { label: 'P1', value: stats.open_p1, color: stats.open_p1 > 0 ? '#fbbf24' : '#484f58' },
            { label: '进行中', value: stats.in_progress, color: '#10b981' },
            { label: '排队', value: stats.queued, color: stats.queued > 0 ? '#f59e0b' : '#484f58' },
            { label: '逾期', value: stats.overdue, color: stats.overdue > 0 ? '#ef4444' : '#484f58' },
          ].map(({ label, value, color }, i) => (
            <span key={label} style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
              {i > 0 && <span style={{ color: '#30363d', margin: '0 2px' }}>·</span>}
              <span style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 700, color }}>{value}</span>
              <span style={{ fontSize: 9, color: '#484f58' }}>{label}</span>
            </span>
          ))}
          {tick && (
            <>
              <span style={{ color: '#30363d', margin: '0 2px' }}>·</span>
              <span style={{ fontFamily: 'monospace', fontSize: 10, color: '#484f58' }}>{tick.actions_today} ticks</span>
            </>
          )}
          {tick?.last_dispatch && (
            <>
              <span style={{ color: '#30363d', margin: '0 2px' }}>·</span>
              <span style={{ fontSize: 9, color: '#484f58', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>
                派发: {clip(tick.last_dispatch.task_title, 22)} {fmtAgo(tick.last_dispatch.dispatched_at)}
              </span>
            </>
          )}
        </div>

        <div style={{ padding: '16px 20px 24px' }}>

          {/* ══ MAIN GRID: 240px | 1fr ══ */}
          <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: 14, alignItems: 'start' }}>

            {/* ── LEFT COLUMN ── */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

              {/* 🖥️ US VPS */}
              <div style={{ background: '#161b22', border: '1px solid #21262d', borderRadius: 10, padding: '12px 14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                  <span style={{ fontSize: 14 }}>🖥️</span>
                  <span style={{ fontSize: 10, fontWeight: 700, color: '#8b949e', letterSpacing: 1, textTransform: 'uppercase' }}>US VPS</span>
                  {vps && <span style={{ marginLeft: 'auto', fontSize: 9, color: '#484f58', fontFamily: 'monospace' }}>{fmtUptime(vps.uptime)}</span>}
                </div>
                {vps ? (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                        <Donut pct={vps.cpu.usage} color={metricColor(vps.cpu.usage)} />
                        <span style={{ fontSize: 9, color: '#484f58', textTransform: 'uppercase', letterSpacing: .5 }}>CPU</span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {([
                        { l: 'RAM', v: vps.memory.usagePercent },
                        { l: 'Disk', v: vps.disk.usagePercent },
                      ] as { l: string; v: number }[]).map(({ l, v }) => (
                        <div key={l}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                            <span style={{ fontSize: 9, color: '#484f58', textTransform: 'uppercase', letterSpacing: .5 }}>{l}</span>
                            <span style={{ fontSize: 9, fontFamily: 'monospace', color: metricColor(v) }}>{v.toFixed(0)}%</span>
                          </div>
                          <PBar pct={v} color={metricColor(v)} h={4} />
                        </div>
                      ))}
                      {svcDown > 0 && (
                        <span style={{ fontSize: 9, color: '#ef4444', background: 'rgba(239,68,68,.1)', padding: '2px 6px', borderRadius: 8, textAlign: 'center' }}>
                          {svcDown} services down
                        </span>
                      )}
                      {svcUp > 0 && svcDown === 0 && (
                        <span style={{ fontSize: 9, color: '#10b981', background: 'rgba(16,185,129,.08)', padding: '2px 6px', borderRadius: 8, textAlign: 'center' }}>
                          all services up
                        </span>
                      )}
                    </div>
                  </>
                ) : <Skel />}
              </div>

              {/* 🖥️ HK VPS */}
              <div style={{ background: '#161b22', border: '1px solid #21262d', borderRadius: 10, padding: '12px 14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                  <span style={{ fontSize: 14 }}>🖥️</span>
                  <span style={{ fontSize: 10, fontWeight: 700, color: '#8b949e', letterSpacing: 1, textTransform: 'uppercase' }}>HK VPS</span>
                  {hkVps && <span style={{ marginLeft: 'auto', fontSize: 9, color: '#484f58', fontFamily: 'monospace' }}>{fmtUptime(hkVps.uptime)}</span>}
                </div>
                {hkVps ? (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                        <Donut pct={hkVps.cpu.usage} color={metricColor(hkVps.cpu.usage)} />
                        <span style={{ fontSize: 9, color: '#484f58', textTransform: 'uppercase', letterSpacing: .5 }}>CPU</span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {([
                        { l: 'RAM', v: hkVps.memory.usagePercent },
                        { l: 'Disk', v: hkVps.disk.usagePercent },
                      ] as { l: string; v: number }[]).map(({ l, v }) => (
                        <div key={l}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                            <span style={{ fontSize: 9, color: '#484f58', textTransform: 'uppercase', letterSpacing: .5 }}>{l}</span>
                            <span style={{ fontSize: 9, fontFamily: 'monospace', color: metricColor(v) }}>{v.toFixed(0)}%</span>
                          </div>
                          <PBar pct={v} color={metricColor(v)} h={4} />
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <div style={{ padding: 8, textAlign: 'center', color: '#484f58', fontSize: 11 }}>—</div>
                )}
              </div>

              {/* 💳 Account */}
              <div style={{ background: '#161b22', border: '1px solid #21262d', borderRadius: 10, padding: '12px 14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
                  <span style={{ fontSize: 14 }}>💳</span>
                  <span style={{ fontSize: 10, fontWeight: 700, color: '#8b949e', letterSpacing: 1, textTransform: 'uppercase' }}>Account</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-around' }}>
                  <AccUsageRings />
                </div>
              </div>

              {/* 🤖 Agents */}
              <div style={{ background: '#161b22', border: '1px solid #21262d', borderRadius: 10, padding: '12px 14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                  <span style={{ fontSize: 14 }}>🤖</span>
                  <span style={{ fontSize: 10, fontWeight: 700, color: '#8b949e', letterSpacing: 1, textTransform: 'uppercase' }}>Agents</span>
                  <span style={{ marginLeft: 'auto', fontSize: 9, fontFamily: 'monospace', color: totalAgents > 0 ? '#10b981' : '#484f58' }}>
                    {cluster?.total_used ?? totalAgents}/{cluster?.total_slots ?? 8}
                  </span>
                </div>
                {/* 槽位圆点 */}
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 10 }}>
                  {Array.from({ length: cluster?.total_slots ?? 8 }, (_, i) => (
                    <span key={i} style={{
                      width: 10, height: 10, borderRadius: '50%', display: 'inline-block',
                      background: i < totalAgents ? '#10b981' : '#21262d',
                      boxShadow: i < totalAgents ? '0 0 5px rgba(16,185,129,.6)' : undefined,
                      transition: 'background .3s',
                    }} />
                  ))}
                </div>
                {/* 进程简列 */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {backgroundProcs.slice(0, 4).map(p => {
                    const { skill, taskTitle } = parseBackgroundCmd(p.command);
                    return (
                      <div key={p.pid} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <Dot color="#10b981" pulse />
                        <span style={{ fontFamily: 'monospace', fontSize: 9, color: '#58a6ff', flexShrink: 0 }}>{skill}</span>
                        <span style={{ fontSize: 9, color: '#6e7681', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {clip(taskTitle, 20)}
                        </span>
                      </div>
                    );
                  })}
                  {foregroundProcs.length > 0 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <Dot color="#3b82f6" />
                      <span style={{ fontSize: 9, color: '#6e7681' }}>{foregroundProcs.length} 前台会话</span>
                    </div>
                  )}
                  {totalAgents === 0 && (
                    <div style={{ fontSize: 10, color: '#484f58', textAlign: 'center', paddingTop: 2 }}>空闲</div>
                  )}
                </div>
              </div>

            </div>

            {/* ── RIGHT COLUMN ── */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

              {/* 📊 OKR 总览 */}
              <div
                onClick={() => navigate('/okr')}
                style={{ background: '#161b22', border: '1px solid #21262d', borderRadius: 12, padding: '16px 18px', cursor: 'pointer', transition: 'border-color .15s' }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = '#58a6ff')}
                onMouseLeave={e => (e.currentTarget.style.borderColor = '#21262d')}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: '#c084fc', letterSpacing: 1.4, textTransform: 'uppercase' }}>OKR 总览</span>
                  <span style={{ fontSize: 9, color: '#484f58' }}>
                    {activeAreas.length} Area · {allGoals.filter(g => g.type === 'kr' && (g.status === 'in_progress' || g.status === 'ready')).length} 活跃 KR
                  </span>
                  <div style={{ flex: 1, height: 1, background: '#21262d' }} />
                  <span style={{ fontSize: 10, color: '#484f58' }}>↗</span>
                </div>

                {/* Global OKR 层 */}
                {activeGlobals.length > 0 ? (
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 9, fontWeight: 700, color: '#f59e0b', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 }}>全局目标</div>
                    {activeGlobals.map(g => {
                      const gc = krColor(g.progress ?? 0);
                      return (
                        <div key={g.id} style={{ marginBottom: 6 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                            <span style={{ fontFamily: 'monospace', fontSize: 9, background: 'rgba(245,158,11,.15)', color: '#f59e0b', padding: '0 5px', borderRadius: 3, flexShrink: 0 }}>GLOBAL</span>
                            <span style={{ fontSize: 11, color: '#c9d1d9', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{clip(g.title, 50)}</span>
                            <span style={{ fontFamily: 'monospace', fontSize: 11, fontWeight: 700, color: gc, flexShrink: 0 }}>{g.progress ?? 0}%</span>
                          </div>
                          <PBar pct={g.progress ?? 0} color={gc} h={3} />
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div style={{ marginBottom: 10, padding: '5px 8px', fontSize: 10, color: '#484f58', background: '#0d1117', borderRadius: 6 }}>
                    全局目标未设置
                  </div>
                )}

                {/* 分隔线 */}
                <div style={{ height: 1, background: '#21262d', margin: '8px 0 12px' }} />

                {/* Area OKR 层 */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {activeAreas.length > 0 ? activeAreas.map(area => {
                    const c = krColor(area.progress ?? 0);
                    const krCount = allGoals.filter(g => g.type === 'kr' && g.parent_id === area.id && g.status !== 'cancelled').length;
                    const endDate = area.custom_props?.end_date;
                    const daysLeft = endDate ? Math.ceil((new Date(endDate).setHours(0, 0, 0, 0) - todayMs) / 86400000) : null;
                    return (
                      <div key={area.id}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                          <span style={{ fontFamily: 'monospace', fontSize: 9, background: 'rgba(192,132,252,.15)', color: '#c084fc', padding: '0 5px', borderRadius: 3, flexShrink: 0 }}>AREA</span>
                          <span style={{ fontSize: 11, color: '#c9d1d9', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{clip(area.title, 50)}</span>
                          <span style={{ fontFamily: 'monospace', fontSize: 11, fontWeight: 700, color: c, flexShrink: 0 }}>{area.progress ?? 0}%</span>
                          {krCount > 0 && <span style={{ fontFamily: 'monospace', fontSize: 9, color: '#484f58', flexShrink: 0 }}>{krCount}KR</span>}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ flex: 1 }}><PBar pct={area.progress ?? 0} color={c} h={4} /></div>
                          {daysLeft !== null && (
                            <span style={{ fontSize: 9, fontFamily: 'monospace', color: daysLeft < 0 ? '#ef4444' : daysLeft < 30 ? '#f59e0b' : '#484f58', flexShrink: 0 }}>
                              {daysLeft < 0 ? `逾${-daysLeft}d` : `${daysLeft}d`}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  }) : <Skel />}
                </div>
              </div>

              {/* 📁 Projects by Area */}
              <div style={{ background: '#161b22', border: '1px solid #21262d', borderRadius: 12, padding: '16px 18px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: '#3b82f6', letterSpacing: 1.4, textTransform: 'uppercase' }}>Projects</span>
                  {(() => {
                    const cnt = projects.filter(p => p.type === 'initiative' && !INACTIVE_STATUSES.has(p.status)).length;
                    return (
                      <span style={{ background: cnt > 0 ? 'rgba(59,130,246,.15)' : '#21262d', color: cnt > 0 ? '#60a5fa' : '#6e7681', fontFamily: 'monospace', fontSize: 11, padding: '1px 8px', borderRadius: 10, fontWeight: 700 }}>
                        {cnt} 活跃 Initiative
                      </span>
                    );
                  })()}
                  <div style={{ flex: 1, height: 1, background: '#21262d' }} />
                  <span style={{ fontSize: 10, color: '#484f58' }} onClick={e => { e.stopPropagation(); navigate('/work'); }} role="button">↗</span>
                </div>
                <ProjectsByArea projects={projects} allGoals={allGoals} queuedTasks={queuedTasks} />
              </div>

            </div>

          </div>
        </div>
      </div>
    </>
  );
}
