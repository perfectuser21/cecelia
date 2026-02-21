/**
 * LiveMonitor v9 — 今日为视角的指挥中心
 * TOP:    今日概览（目标层级 + 任务快照）
 * BOTTOM: 实时活动（前台/后台 Agent + 等待队列）
 * 前台 = claude (interactive) 🔵  后台 = claude -p (Brain dispatched) 🟢
 */

import { useState, useEffect, useCallback } from 'react';

// ── Types ────────────────────────────────────────────────────────

interface ObjFocus {
  objective_title: string;
  priority: string;
  progress: number;
  reason: string;
  key_results: Array<{ id: string; title: string; progress: number }>;
}

interface BrainStatus {
  daily_focus: ObjFocus | null;
  task_digest: {
    stats: { open_p0: number; open_p1: number; in_progress: number; queued: number; overdue: number };
  };
  recent_decisions: Array<{ ts: string; action: string; trigger: string; status: string }>;
}

interface TickStatus {
  actions_today: number;
  alertness: { levelName: string };
  slot_budget: { dispatchAllowed: boolean; pressure: number };
  circuit_breakers: Record<string, { state: string; failures: number }>;
  last_dispatch: { task_title: string; dispatched_at: string; success: boolean } | null;
  resources: { effectiveSlots: number };
  quarantine: { total: number };
  max_concurrent: number;
}

interface BrainTask {
  id: string;
  title: string;
  priority: 'P0' | 'P1' | 'P2';
  status: string;
  trigger_source: string;
  started_at: string | null;
  created_at: string;
  task_type: string;
  project_id: string | null;
}

interface ClusterProcess {
  pid: number;
  cpu: string;
  memory: string;
  startTime: string;
  command: string;
}

interface ClusterServer {
  id: string;
  name: string;
  location: string;
  status: string;
  resources: { cpu_pct: number; mem_used_pct: number; cpu_load: number; cpu_cores: number; mem_total_gb: number; mem_free_gb: number };
  slots: { max: number; dynamic_max: number; used: number; available: number; processes: ClusterProcess[] };
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
interface N8nStats { todayStats: { running: number; success: number; error: number } }

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
  ALERT: '大脑高度活跃：任务量较大或有失败记录，加强监控中',
  CRITICAL: '系统异常：熔断器触发或资源耗尽，需人工介入',
};

const metricColor = (p: number) => p > 80 ? '#ef4444' : p > 60 ? '#f59e0b' : '#10b981';
const krColor = (p: number) => p >= 80 ? '#10b981' : p >= 50 ? '#f59e0b' : '#ef4444';
const clip = (s: string, n: number) => s.length > n ? s.slice(0, n - 1) + '…' : s;

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

/** 解析进程类型：前台 vs 后台 */
function classifyProcess(cmd: string): 'foreground' | 'background' | 'wrapper' {
  if (cmd.startsWith('bash -c') || cmd.startsWith('sh -c')) return 'wrapper';
  if (cmd.includes('claude -p ')) return 'background';
  if (cmd === 'claude' || cmd.startsWith('claude ')) return 'foreground';
  return 'wrapper';
}

/**
 * startTime 格式判断：
 * - "01:22"  → 今天启动 (HH:MM)
 * - "Feb14"  → 超过24小时 (MonDD)
 * - "Feb14" 与今天日期不同 → stale
 */
function isStaleProcess(startTime: string): boolean {
  // 如果包含冒号 → 今天的进程
  if (startTime.includes(':')) return false;
  // 否则是日期格式 (MonDD) → 超过24小时
  return true;
}

/** 从后台进程 command 提取 skill + 任务名 */
function parseBackgroundCmd(cmd: string): { skill: string; taskTitle: string } {
  const skillMatch = cmd.match(/claude -p (\/\w+)/);
  const skill = skillMatch?.[1] ?? '/unknown';
  // 取 # 后面的内容作为 task title，或取整段
  const afterSkill = cmd.replace(/^claude -p \/\w+\s*/, '');
  const taskTitle = afterSkill.replace(/^#\s*/, '').slice(0, 80);
  return { skill, taskTitle };
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

// ── Agent row component ───────────────────────────────────────────

interface SessionInfo {
  cwd: string | null;
  projectName: string | null;
  cmdline: string;
}

type KillState = 'idle' | 'confirm' | 'killing' | 'sent';

function AgentRow({
  type, pid, cpu, mem, startTime, title, skill, accent, onKilled,
}: {
  type: 'foreground' | 'background';
  pid: number; cpu: string; mem: string; startTime: string;
  title: string; skill?: string; accent: string;
  onKilled?: (pid: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(null);
  const [killState, setKillState] = useState<KillState>('idle');
  const stale = isStaleProcess(startTime);
  const rowAccent = stale ? '#6e7681' : accent;
  const cpuVal = parseFloat(cpu);

  // 展开时 fetch 项目目录
  useEffect(() => {
    if (!open || sessionInfo) return;
    fetch(`/api/cluster/session-info/${pid}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => d && setSessionInfo(d))
      .catch(() => null);
  }, [open, pid, sessionInfo]);

  function handleKillClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (killState === 'idle') {
      setKillState('confirm');
      // 3秒后自动取消确认
      setTimeout(() => setKillState(s => s === 'confirm' ? 'idle' : s), 3000);
    } else if (killState === 'confirm') {
      setKillState('killing');
      fetch('/api/cluster/kill-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pid }),
      }).then(r => r.json()).then(() => {
        setKillState('sent');
        setTimeout(() => onKilled?.(pid), 5000);
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
        transition: 'all .15s',
        overflow: 'hidden',
        opacity: stale ? 0.65 : (killState === 'sent' ? 0.4 : 1),
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px' }}>
        <Dot color={rowAccent} pulse={type === 'background' && !stale} />
        <span style={{
          fontFamily: 'monospace', fontSize: 10, fontWeight: 700,
          color: rowAccent, background: rowAccent + '18',
          padding: '1px 7px', borderRadius: 4, flexShrink: 0,
        }}>
          {type === 'foreground' ? '前台' : '后台'}
        </span>
        {stale && (
          <span style={{
            fontFamily: 'monospace', fontSize: 10, color: '#f59e0b',
            background: 'rgba(245,158,11,.12)', padding: '1px 6px',
            borderRadius: 4, flexShrink: 0,
          }} title="运行超24小时，可能是旧会话">
            空闲?
          </span>
        )}
        {skill && (
          <span style={{ fontFamily: 'monospace', fontSize: 10, color: '#58a6ff', background: 'rgba(88,166,255,.1)', padding: '1px 6px', borderRadius: 4, flexShrink: 0 }}>
            {skill}
          </span>
        )}
        <span style={{ fontSize: 12, color: stale ? '#6e7681' : '#c9d1d9', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {killState === 'sent' ? '已发送终止信号，进程即将退出…' : clip(title, 70)}
        </span>
        <span style={{ fontFamily: 'monospace', fontSize: 11, color: cpuVal > 30 ? '#f59e0b' : (cpuVal > 5 ? '#6e7681' : '#484f58'), flexShrink: 0 }}>
          CPU {cpu}
        </span>
        <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#484f58', flexShrink: 0 }}>
          MEM {mem}
        </span>
        <span style={{ fontFamily: 'monospace', fontSize: 10, color: stale ? '#f59e0b' : '#484f58', flexShrink: 0 }}>
          {startTime}
        </span>
        {/* Kill 按钮：仅前台进程 */}
        {type === 'foreground' && killState !== 'sent' && (
          <button
            onClick={handleKillClick}
            style={{
              padding: '2px 10px', borderRadius: 5, border: 'none', cursor: 'pointer',
              fontSize: 11, fontWeight: 700, fontFamily: 'monospace', flexShrink: 0,
              background: killState === 'confirm' ? 'rgba(239,68,68,.8)' : 'rgba(239,68,68,.12)',
              color: killState === 'confirm' ? '#fff' : '#f87171',
              transition: 'all .15s',
            }}
          >
            {killState === 'killing' ? '…' : killState === 'confirm' ? '确认' : 'Kill'}
          </button>
        )}
        <span style={{ fontSize: 9, color: '#484f58', transform: open ? 'rotate(90deg)' : 'rotate(0)', transition: 'transform .15s', flexShrink: 0 }}>▶</span>
      </div>
      {open && (
        <div style={{ padding: '0 12px 10px', borderTop: `1px solid ${rowAccent}20`, paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {[
              { l: 'PID', v: String(pid) },
              { l: '类型', v: type === 'foreground' ? '前台 / 交互式' : '后台 / Brain 派发' },
              { l: 'CPU', v: cpu },
              { l: '内存', v: mem },
              { l: '启动时间', v: startTime },
              ...(skill ? [{ l: 'Skill', v: skill }] : []),
            ].map(({ l, v }) => (
              <div key={l}>
                <div style={{ fontSize: 9, color: '#484f58', textTransform: 'uppercase', letterSpacing: .8, marginBottom: 2 }}>{l}</div>
                <div style={{ fontFamily: 'monospace', fontSize: 11, color: '#8b949e' }}>{v}</div>
              </div>
            ))}
          </div>
          {/* 项目目录（前台进程） */}
          {type === 'foreground' && (
            <div style={{ background: '#0d1117', borderRadius: 6, padding: '8px 12px' }}>
              <div style={{ fontSize: 9, color: '#484f58', textTransform: 'uppercase', letterSpacing: .8, marginBottom: 4 }}>工作目录</div>
              {sessionInfo ? (
                <div>
                  <div style={{ fontFamily: 'monospace', fontSize: 11, color: '#58a6ff', marginBottom: 2 }}>
                    {sessionInfo.projectName ?? '(unknown)'}
                  </div>
                  <div style={{ fontFamily: 'monospace', fontSize: 10, color: '#484f58' }}>
                    {sessionInfo.cwd ?? '无法读取'}
                  </div>
                </div>
              ) : (
                <div style={{ fontFamily: 'monospace', fontSize: 11, color: '#484f58', animation: 'lmPulse 1.5s ease-in-out infinite' }}>读取中…</div>
              )}
            </div>
          )}
          {stale && (
            <div style={{ background: 'rgba(245,158,11,.08)', border: '1px solid rgba(245,158,11,.2)', borderRadius: 6, padding: '8px 12px', fontSize: 11, color: '#f59e0b' }}>
              ⚠ 此进程运行超过 24 小时，可能是已关闭终端的残留会话。点击 Kill 按钮可安全终止（历史记录不会丢失）。
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main ─────────────────────────────────────────────────────────

export default function LiveMonitorPage() {
  const [brainStatus, setBrainStatus] = useState<BrainStatus | null>(null);
  const [tick, setTick] = useState<TickStatus | null>(null);
  const [active, setActive] = useState<BrainTask[]>([]);
  const [queued, setQueued] = useState<BrainTask[]>([]);
  const [cluster, setCluster] = useState<ClusterStatus | null>(null);
  const [vps, setVps] = useState<VpsStats | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [n8n, setN8n] = useState<N8nStats | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [cd, setCd] = useState(5);
  const [fullscreen, setFullscreen] = useState(false);
  const [killedPids, setKilledPids] = useState<Set<number>>(new Set());
  const handleKilled = useCallback((pid: number) => {
    setKilledPids(s => new Set([...s, pid]));
  }, []);

  const load = useCallback(async () => {
    const r = await Promise.allSettled([
      fetch('/api/brain/status').then(x => x.json()),
      fetch('/api/brain/tick/status').then(x => x.json()),
      fetch('/api/brain/tasks?status=in_progress').then(x => x.json()),
      fetch('/api/brain/tasks?status=queued').then(x => x.json()),
      fetch('/api/brain/cluster/status').then(x => x.json()),
      fetch('/api/v1/vps-monitor/stats').then(x => x.json()),
      fetch('/api/v1/vps-monitor/services').then(x => x.json()),
      fetch('/api/v1/n8n-live-status/instances/local/overview').then(x => x.json()),
    ]);
    if (r[0].status === 'fulfilled') setBrainStatus(r[0].value);
    if (r[1].status === 'fulfilled') setTick(r[1].value);
    if (r[2].status === 'fulfilled') setActive(Array.isArray(r[2].value) ? r[2].value : []);
    if (r[3].status === 'fulfilled') setQueued(Array.isArray(r[3].value) ? r[3].value : []);
    if (r[4].status === 'fulfilled') setCluster(r[4].value?.cluster ?? null);
    if (r[5].status === 'fulfilled') setVps(r[5].value);
    if (r[6].status === 'fulfilled') setServices(r[6].value?.services || []);
    if (r[7].status === 'fulfilled') setN8n(r[7].value);
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

  // ── Derived data ──────────────────────────────────────────────
  const focus = brainStatus?.daily_focus;
  const stats = brainStatus?.task_digest?.stats;
  const alertName = tick?.alertness?.levelName ?? 'NORMAL';
  const alertColor = ALERT_COLOR[alertName] ?? '#6e7681';
  const alertLabel = ALERT_LABEL[alertName] ?? alertName;
  const svcUp = services.filter(s => s.status === 'running').length;
  const svcDown = services.filter(s => s.status !== 'running').length;

  // All processes from cluster (US server)，过滤掉已手动 kill 的
  const allProcs: ClusterProcess[] = (cluster?.servers?.[0]?.slots?.processes ?? [])
    .filter(p => !killedPids.has(p.pid));
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
        .lm-scroll::-webkit-scrollbar { width: 3px; }
        .lm-scroll::-webkit-scrollbar-thumb { background: #30363d; border-radius: 2px; }
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
          <span style={{ color: '#21262d' }}>│</span>
          <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#6e7681' }}>CECELIA NOC</span>

          <div
            title={`${alertLabel}：${ALERT_DESC[alertName] ?? ''}`}
            style={{ background: alertColor + '1a', border: `1px solid ${alertColor}40`, borderRadius: 20, padding: '2px 12px', display: 'flex', alignItems: 'center', gap: 6, cursor: 'help' }}
          >
            <Dot color={alertColor} />
            <span style={{ fontFamily: 'monospace', fontSize: 11, fontWeight: 700, color: alertColor }}>{alertLabel}</span>
          </div>

          {/* Agent count chips */}
          <span style={{ background: '#21262d', borderRadius: 6, padding: '2px 10px', fontFamily: 'monospace', fontSize: 11 }}>
            <span style={{ color: '#3b82f6', fontWeight: 700 }}>{foregroundProcs.length}</span>
            <span style={{ color: '#484f58', marginLeft: 4 }}>前台</span>
          </span>
          <span style={{ background: '#21262d', borderRadius: 6, padding: '2px 10px', fontFamily: 'monospace', fontSize: 11 }}>
            <span style={{ color: active.length > 0 ? '#10b981' : '#6e7681', fontWeight: 700 }}>{backgroundProcs.length}</span>
            <span style={{ color: '#484f58', marginLeft: 4 }}>后台</span>
          </span>
          <span style={{ background: '#21262d', borderRadius: 6, padding: '2px 10px', fontFamily: 'monospace', fontSize: 11 }}>
            <span style={{ color: queued.length > 3 ? '#f59e0b' : '#6e7681', fontWeight: 700 }}>{queued.length}</span>
            <span style={{ color: '#484f58', marginLeft: 4 }}>排队</span>
          </span>

          <div style={{ flex: 1 }} />

          <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#484f58' }}>
            {updatedAt?.toLocaleTimeString('zh-CN') ?? '—'}
          </span>
          <span style={{ background: '#21262d', fontFamily: 'monospace', fontSize: 11, color: '#6e7681', padding: '2px 8px', borderRadius: 6 }}>
            ↻ {cd}s
          </span>
          <button
            onClick={() => setFullscreen(f => !f)}
            className="lm-btn"
            style={{ background: 'transparent', border: '1px solid #30363d', borderRadius: 6, padding: '4px 12px', color: '#8b949e', cursor: 'pointer', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <span>{fullscreen ? '⊠' : '⛶'}</span>
            <span>{fullscreen ? '收起' : '全屏'}</span>
          </button>
        </div>

        <div style={{ padding: '16px 20px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* ══ TOP: 今日概览 ══ */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>

            {/* 系统目标 / OKR */}
            <div style={{ background: '#161b22', border: '1px solid #21262d', borderRadius: 12, padding: '18px 20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: '#c084fc', letterSpacing: 1.4, textTransform: 'uppercase' }}>系统目标</span>
                <span style={{ fontSize: 10, color: '#484f58', background: '#21262d', padding: '1px 6px', borderRadius: 4 }}>本月 OKR</span>
                <div style={{ flex: 1, height: 1, background: '#21262d' }} />
              </div>
              {focus ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 16, alignItems: 'start' }}>
                  {/* Big number */}
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontFamily: 'monospace', fontSize: 48, fontWeight: 700, lineHeight: 1, color: krColor(focus.progress), letterSpacing: -3 }}>
                      {focus.progress}
                    </div>
                    <div style={{ fontFamily: 'monospace', fontSize: 13, color: '#6e7681', marginTop: 2 }}>%</div>
                    <div style={{ marginTop: 6 }}>
                      <span style={{ fontFamily: 'monospace', fontSize: 10, background: 'rgba(245,158,11,.15)', color: '#fbbf24', padding: '1px 6px', borderRadius: 3 }}>{focus.priority}</span>
                    </div>
                  </div>
                  {/* KRs */}
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

            {/* 今日任务快照 */}
            <div style={{ background: '#161b22', border: '1px solid #21262d', borderRadius: 12, padding: '18px 20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: '#58a6ff', letterSpacing: 1.4, textTransform: 'uppercase' }}>今日快照</span>
                <div style={{ flex: 1, height: 1, background: '#21262d' }} />
                {tick && (
                  <span style={{ fontFamily: 'monospace', fontSize: 10, color: '#484f58' }}>
                    {tick.actions_today} ticks 今日
                  </span>
                )}
              </div>

              {/* Task stat grid */}
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

              {/* Agent summary + dispatch info */}
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ background: '#0d1117', borderRadius: 8, padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontFamily: 'monospace', fontSize: 18, fontWeight: 700, color: '#3b82f6' }}>{foregroundProcs.length}</div>
                    <div style={{ fontSize: 9, color: '#484f58', textTransform: 'uppercase', letterSpacing: .6, marginTop: 2 }}>前台</div>
                  </div>
                  <div style={{ width: 1, height: 28, background: '#21262d' }} />
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontFamily: 'monospace', fontSize: 18, fontWeight: 700, color: '#10b981' }}>{backgroundProcs.length}</div>
                    <div style={{ fontSize: 9, color: '#484f58', textTransform: 'uppercase', letterSpacing: .6, marginTop: 2 }}>后台</div>
                  </div>
                  <div style={{ width: 1, height: 28, background: '#21262d' }} />
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontFamily: 'monospace', fontSize: 18, fontWeight: 700, color: '#c9d1d9' }}>{totalAgents}</div>
                    <div style={{ fontSize: 9, color: '#484f58', textTransform: 'uppercase', letterSpacing: .6, marginTop: 2 }}>合计</div>
                  </div>
                </div>
                {tick?.last_dispatch && (
                  <div style={{ background: '#0d1117', borderRadius: 8, padding: '8px 14px', flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 9, color: '#484f58', textTransform: 'uppercase', letterSpacing: .8, marginBottom: 4 }}>上次派发</div>
                    <div style={{ fontSize: 12, color: '#c9d1d9', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {clip(tick.last_dispatch.task_title, 48)}
                    </div>
                    <div style={{ fontFamily: 'monospace', fontSize: 10, color: '#484f58', marginTop: 2 }}>
                      {fmtAgo(tick.last_dispatch.dispatched_at)} · {tick.slot_budget.dispatchAllowed ? '派发 OPEN' : '派发 HOLD'}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ══ BOTTOM: 实时活动 ══ */}
          <div style={{ background: '#161b22', border: '1px solid #21262d', borderRadius: 12, padding: '18px 20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: '#e6edf3', letterSpacing: 1.4, textTransform: 'uppercase' }}>实时活动</span>
              <span style={{ background: totalAgents > 0 ? 'rgba(16,185,129,.15)' : '#21262d', color: totalAgents > 0 ? '#10b981' : '#6e7681', fontFamily: 'monospace', fontSize: 11, padding: '1px 8px', borderRadius: 10, fontWeight: 700 }}>
                {totalAgents} active
              </span>
              <div style={{ flex: 1, height: 1, background: '#21262d' }} />
              <span style={{ fontSize: 10, color: '#484f58' }}>
                slots: {cluster?.total_used ?? '—'} / {cluster?.total_slots ?? '—'}  ·  可用: {cluster?.total_available ?? '—'}
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>

              {/* 前台 Agents */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <Dot color="#3b82f6" />
                  <span style={{ fontSize: 11, fontWeight: 600, color: '#3b82f6' }}>前台 · 交互式会话</span>
                  <span style={{ fontFamily: 'monospace', fontSize: 10, color: '#3b82f6', background: 'rgba(59,130,246,.15)', padding: '0 6px', borderRadius: 8 }}>{foregroundProcs.length}</span>
                </div>
                {foregroundProcs.length === 0 ? (
                  <div style={{ padding: '12px', textAlign: 'center', color: '#484f58', fontSize: 12, border: '1px dashed #21262d', borderRadius: 8 }}>暂无前台会话</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {foregroundProcs.map(p => (
                      <AgentRow
                        key={p.pid}
                        type="foreground"
                        pid={p.pid} cpu={p.cpu} mem={p.memory} startTime={p.startTime}
                        title={`Claude Code 交互式会话`}
                        accent="#3b82f6"
                        onKilled={handleKilled}
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* 后台 Agents */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <Dot color="#10b981" pulse={backgroundProcs.length > 0} />
                  <span style={{ fontSize: 11, fontWeight: 600, color: '#10b981' }}>后台 · Brain 派发</span>
                  <span style={{ fontFamily: 'monospace', fontSize: 10, color: '#10b981', background: 'rgba(16,185,129,.15)', padding: '0 6px', borderRadius: 8 }}>{backgroundProcs.length}</span>
                </div>
                {backgroundProcs.length === 0 ? (
                  <div style={{ padding: '12px', textAlign: 'center', color: '#484f58', fontSize: 12, border: '1px dashed #21262d', borderRadius: 8 }}>暂无后台任务</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {backgroundProcs.map(p => {
                      const { skill, taskTitle } = parseBackgroundCmd(p.command);
                      return (
                        <AgentRow
                          key={p.pid}
                          type="background"
                          pid={p.pid} cpu={p.cpu} mem={p.memory} startTime={p.startTime}
                          title={taskTitle}
                          skill={skill}
                          accent="#10b981"
                        />
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* 等待队列 */}
            {queued.length > 0 && (
              <div style={{ marginTop: 14, borderTop: '1px solid #21262d', paddingTop: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: '#f59e0b', letterSpacing: 1, textTransform: 'uppercase' }}>等待队列</span>
                  <span style={{ fontFamily: 'monospace', fontSize: 10, color: '#f59e0b', background: 'rgba(245,158,11,.15)', padding: '0 6px', borderRadius: 8 }}>{queued.length}</span>
                  <div style={{ flex: 1, height: 1, background: '#21262d' }} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 6 }}>
                  {queued.slice(0, 8).map((t, i) => (
                    <div key={t.id} style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '7px 10px', borderRadius: 6,
                      background: '#0d1117', border: '1px solid #21262d',
                    }}>
                      <span style={{ fontFamily: 'monospace', fontSize: 10, color: '#484f58', flexShrink: 0 }}>#{i + 1}</span>
                      <PBadge p={t.priority} />
                      <span style={{ fontSize: 11, color: '#8b949e', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {clip(t.title, 45)}
                      </span>
                      <span style={{ fontFamily: 'monospace', fontSize: 10, color: '#484f58', flexShrink: 0 }}>{fmtAgo(t.created_at)}</span>
                    </div>
                  ))}
                  {queued.length > 8 && (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '7px', borderRadius: 6, background: '#0d1117', border: '1px dashed #21262d', color: '#484f58', fontSize: 11 }}>
                      +{queued.length - 8} 个任务排队中
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* ══ BOTTOM: Infrastructure ══ */}
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

              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {svcUp > 0 && <span style={{ background: 'rgba(16,185,129,.15)', color: '#10b981', fontSize: 12, fontWeight: 700, padding: '2px 10px', borderRadius: 20 }}>{svcUp} up</span>}
                {svcDown > 0 && <span style={{ background: 'rgba(239,68,68,.15)', color: '#ef4444', fontSize: 12, fontWeight: 700, padding: '2px 10px', borderRadius: 20 }}>{svcDown} down</span>}
                {services.slice(0, 6).map(s => (
                  <div key={s.containerName} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Dot color={s.status === 'running' ? '#10b981' : '#ef4444'} />
                    <span style={{ fontSize: 11, color: '#6e7681' }}>{s.containerName}</span>
                  </div>
                ))}
              </div>

              {n8n && (
                <>
                  <div style={{ width: 1, height: 40, background: '#21262d' }} />
                  <div style={{ display: 'flex', gap: 14 }}>
                    {[
                      { l: 'N8N RUN', v: n8n.todayStats.running, c: '#10b981' },
                      { l: 'SUCCESS', v: n8n.todayStats.success, c: '#10b981' },
                      { l: 'ERRORS', v: n8n.todayStats.error, c: n8n.todayStats.error > 0 ? '#ef4444' : '#6e7681' },
                    ].map(({ l, v, c }) => (
                      <div key={l} style={{ textAlign: 'center' }}>
                        <div style={{ fontFamily: 'monospace', fontSize: 16, fontWeight: 700, color: c }}>{v}</div>
                        <div style={{ fontSize: 9, color: '#484f58', textTransform: 'uppercase', letterSpacing: .8 }}>{l}</div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
