/**
 * WarRoomPage — Harness 战情室（统一 feed）
 *
 * 三栏全屏指挥中心：
 *   左  Area/线导航 + 状态图例（点击过滤中栏）
 *   中  按 Area → Group 分组的任务 feed（不只 harness，含 dev/pipeline/scraper）
 *   右  选中任务详情（active sprint 展示进度/节点，其余展示基本信息 + 下钻入口）
 *
 * 数据：GET /api/brain/warroom/feed（warroom-classify.js 聚合，见 packages/brain）
 * 下钻：sprint → /pipeline/:id（HarnessPipelineDetailPage），其余 → /tasks/:id/prd
 *
 * 设计刻意走深色"指挥中心"风格（不跟随主题），对齐已确认的 HTML 原型。
 */

import { useEffect, useMemo, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Zap, Server, Layers, GitPullRequest, RefreshCw, Radio, Clock,
  FileText, ExternalLink, Activity, CircleDot,
} from 'lucide-react';

// ====================== 数据契约（对齐 /api/brain/warroom/feed）======================

export type WarStatus = 'active' | 'done' | 'failed' | 'canceled';
export type WarKind = 'sprint' | 'pipeline' | 'scraper' | 'task';

export interface FeedTask {
  id: string;
  kind: WarKind;
  title: string;
  status: WarStatus;
  raw_status: string;
  priority: string | number | null;
  created_at: string;
  elapsed_ms: number | null;
  progress_pct: number | null;
  current_node: string | null;
  fail_reason: string | null;
  pr_url: string | null;
  /** 由所属 sprint 的 harness_report 合并而来（最终验收结论 PASS/FAIL） */
  verdict?: string | null;
  /** harness_report findings 数量 */
  findings_count?: number | null;
  detail_route: string;
}

export interface FeedGroup {
  groupKey: string;
  groupName: string;
  count: number;
  tasks: FeedTask[];
}

export interface FeedArea {
  areaKey: string;
  areaName: string;
  order: number;
  count: number;
  groups: FeedGroup[];
}

export interface FeedStats {
  active: number;
  done_today: number;
  failed_today: number;
  pr_this_month: number;
}

export interface FeedResponse {
  stats: FeedStats;
  areas: FeedArea[];
  total: number;
  generated_at: string;
}

// ====================== 纯展示函数（单测覆盖）======================

/** 毫秒耗时 → 紧凑串（5s / 1m30s / 1h5m / 1d1h）；非正数返回空 */
export function formatElapsed(ms: number | null): string {
  if (ms == null || ms <= 0) return '';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) {
    const rs = s % 60;
    return rs ? `${m}m${rs}s` : `${m}m`;
  }
  const h = Math.floor(m / 60);
  if (h < 24) {
    const rm = m % 60;
    return rm ? `${h}h${rm}m` : `${h}h`;
  }
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh ? `${d}d${rh}h` : `${d}d`;
}

/** ISO 时间 → 相对中文（刚刚 / N分钟前 / N小时前 / N天前）；空值返回空 */
export function relativeTime(iso: string | null): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const diff = Date.now() - t;
  if (diff < 60_000) return '刚刚';
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `${m}分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}小时前`;
  const d = Math.floor(h / 24);
  return `${d}天前`;
}

/** 战情室 4 态 → 文案 + 圆点色 + 标签 pill 样式 + 标题文字色 */
export function statusMeta(status: WarStatus): {
  label: string;
  dot: string;
  pill: string;
  text: string;
} {
  switch (status) {
    case 'active':
      return { label: '进行中', dot: 'bg-blue-400', pill: 'bg-blue-500/15 text-blue-400 border border-blue-500/25', text: 'text-slate-200' };
    case 'done':
      return { label: '已完成', dot: 'bg-emerald-500', pill: 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20', text: 'text-slate-400' };
    case 'failed':
      return { label: '失败', dot: 'bg-red-500', pill: 'bg-red-500/10 text-red-400 border border-red-500/15', text: 'text-slate-400' };
    case 'canceled':
      return { label: '取消', dot: 'bg-slate-500', pill: 'bg-slate-700/50 text-slate-500 border border-slate-700', text: 'text-slate-600' };
    default:
      return { label: '未知', dot: 'bg-slate-500', pill: 'bg-slate-700/50 text-slate-500 border border-slate-700', text: 'text-slate-400' };
  }
}

/** 任务种类 → 标签 */
export function kindLabel(kind: WarKind): string {
  switch (kind) {
    case 'sprint': return 'Sprint';
    case 'pipeline': return 'Pipeline';
    case 'scraper': return '采集';
    default: return 'Task';
  }
}

/** 按 areaKey 过滤 areas；'all' 返回全部 */
export function filterArea(areas: FeedArea[], key: string): FeedArea[] {
  if (key === 'all') return areas;
  return areas.filter((a) => a.areaKey === key);
}

/** 优先级显示：归一为单个 P 前缀（"P1"→"P1"，2→"P2"），空值返回空 */
export function formatPriority(p: string | number | null): string {
  if (p == null || p === '') return '';
  const s = String(p);
  return /^p/i.test(s) ? s.toUpperCase() : `P${s}`;
}

/** 最终验收结论(harness_report.final_e2e_verdict) → 徽章样式；空/未知返回 null（不渲染） */
export function verdictMeta(v: string | null | undefined): { label: string; pill: string } | null {
  if (!v) return null;
  const up = String(v).toUpperCase();
  if (up === 'PASS') return { label: 'PASS', pill: 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30' };
  if (up === 'FAIL') return { label: 'FAIL', pill: 'bg-red-500/15 text-red-300 border border-red-500/30' };
  return { label: up, pill: 'bg-slate-500/15 text-slate-300 border border-slate-500/30' };
}

/** 按任务 kind 过滤：只留匹配任务，剔除空 group/空 area，count 重算；'all' 原样返回 */
export function filterByKind(areas: FeedArea[], kind: string): FeedArea[] {
  if (kind === 'all') return areas;
  const out: FeedArea[] = [];
  for (const a of areas) {
    const groups: FeedGroup[] = [];
    for (const g of a.groups) {
      const tasks = g.tasks.filter((t) => t.kind === kind);
      if (tasks.length) groups.push({ ...g, tasks, count: tasks.length });
    }
    if (groups.length) {
      out.push({ ...a, groups, count: groups.reduce((n, g) => n + g.count, 0) });
    }
  }
  return out;
}

/** 默认选中：首个 active 任务，无则首个任务，空则 null */
export function pickDefaultTask(areas: FeedArea[]): FeedTask | null {
  let first: FeedTask | null = null;
  for (const a of areas) {
    for (const g of a.groups) {
      for (const t of g.tasks) {
        if (!first) first = t;
        if (t.status === 'active') return t;
      }
    }
  }
  return first;
}

// ====================== 子组件 ======================

const AREA_ICON: Record<string, typeof Server> = {
  cecelia: Server,
  zenithjoy: Layers,
  infra: CircleDot,
};
const AREA_ACCENT: Record<string, string> = {
  cecelia: 'text-cyan-500',
  zenithjoy: 'text-amber-500',
  infra: 'text-slate-400',
};
// 竖条强调色：静态类名，确保 Tailwind JIT 收录（不可用动态拼接）
const AREA_BAR: Record<string, string> = {
  cecelia: 'bg-cyan-500',
  zenithjoy: 'bg-amber-500',
  infra: 'bg-slate-400',
};

// kind 徽章配色（静态类名，Tailwind JIT 可收录）
const KIND_BADGE: Record<WarKind, string> = {
  sprint: 'bg-violet-500/10 text-violet-300 border border-violet-500/20',
  pipeline: 'bg-teal-500/10 text-teal-300 border border-teal-500/20',
  scraper: 'bg-amber-500/10 text-amber-300 border border-amber-500/20',
  task: 'bg-slate-500/10 text-slate-300 border border-slate-500/20',
};

function KindBadge({ kind }: { kind: WarKind }) {
  return (
    <span className={`text-[9px] tracking-wide px-1.5 py-px rounded font-semibold ${KIND_BADGE[kind]}`}>
      {kindLabel(kind)}
    </span>
  );
}

function StatChip({ dot, value, label, valueClass }: { dot: string; value: number; label: string; valueClass?: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className={`w-1.5 h-1.5 rounded-full ${dot}`} />
      <span className={`font-mono ${valueClass || 'text-slate-300'}`}>{value}</span>
      <span className="text-slate-600">{label}</span>
    </div>
  );
}

function FeedRow({ task, active, onSelect }: { task: FeedTask; active: boolean; onSelect: (t: FeedTask) => void }) {
  const meta = statusMeta(task.status);
  const rel = relativeTime(task.created_at);
  const isActive = task.status === 'active';
  return (
    <div
      onClick={() => onSelect(task)}
      className={`group flex items-center gap-2.5 px-3 py-2 text-[11px] cursor-pointer border-l-2 transition-colors ${
        active ? 'bg-blue-500/[0.06] border-blue-500' : 'border-transparent hover:bg-slate-400/[0.04] hover:border-blue-500/60'
      }`}
    >
      <div className="flex-shrink-0 w-1.5 flex items-center justify-center">
        <div className={`w-1.5 h-1.5 rounded-full ${meta.dot} ${isActive ? 'wr-pulse' : ''}`} />
      </div>
      <div className="flex-1 min-w-0">
        <div className={`truncate ${isActive ? 'font-medium text-slate-200' : meta.text}`}>{task.title}</div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-slate-600">{rel}</span>
          {isActive && task.current_node && (
            <>
              <span className="text-slate-700">·</span>
              <span className="text-blue-400">{task.current_node}</span>
            </>
          )}
          {isActive && task.progress_pct != null && (
            <>
              <span className="text-slate-700">·</span>
              <div className="h-[2px] w-16 flex-shrink-0 rounded-full bg-slate-800 overflow-hidden">
                <div className="h-full rounded-full bg-blue-500" style={{ width: `${task.progress_pct}%` }} />
              </div>
              <span className="text-slate-600 flex-shrink-0">{task.progress_pct}%</span>
            </>
          )}
          {task.status === 'failed' && task.fail_reason && (
            <span className="text-red-400/60 truncate">{task.fail_reason}</span>
          )}
        </div>
      </div>
      <div className="flex-shrink-0 flex items-center gap-1.5">
        {task.pr_url && (
          <a
            href={task.pr_url}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-blue-600 hover:text-blue-400 flex items-center gap-0.5"
          >
            <GitPullRequest className="w-2.5 h-2.5" />
          </a>
        )}
        <KindBadge kind={task.kind} />
        {(() => {
          const v = verdictMeta(task.verdict);
          return v ? <span className={`text-[9px] tracking-wide px-1.5 py-px rounded font-bold ${v.pill}`}>{v.label}</span> : null;
        })()}
        <span className={`text-[9px] tracking-wide px-1.5 py-px rounded font-semibold uppercase ${meta.pill}`}>{meta.label}</span>
        {task.priority != null && <span className="text-slate-700 font-mono text-[10px]">{formatPriority(task.priority)}</span>}
      </div>
    </div>
  );
}

const COLLAPSE_LIMIT = 6;

function GroupBlock({
  area, group, selectedId, onSelect, expanded, onToggle,
}: {
  area: FeedArea;
  group: FeedGroup;
  selectedId: string | null;
  onSelect: (t: FeedTask) => void;
  expanded: boolean;
  onToggle: () => void;
}) {
  const visible = expanded ? group.tasks : group.tasks.slice(0, COLLAPSE_LIMIT);
  const hidden = group.tasks.length - visible.length;
  return (
    <div className="mb-3">
      <div className="flex items-center gap-1.5 px-2 py-0.5 mb-0.5">
        <div className="w-1.5 h-1.5 rounded-full bg-slate-600/40 flex-shrink-0" />
        <span className="text-[10px] text-slate-600 font-semibold tracking-wider uppercase">{group.groupName}</span>
        <span className="text-[9px] text-slate-700">{group.count}</span>
      </div>
      {visible.map((t) => (
        <FeedRow key={t.id} task={t} active={t.id === selectedId} onSelect={onSelect} />
      ))}
      {(hidden > 0 || expanded) && group.tasks.length > COLLAPSE_LIMIT && (
        <div className="px-3 py-1.5">
          <button onClick={onToggle} className="text-[10px] text-slate-700 hover:text-slate-500 transition-colors">
            {expanded ? `收起 ${group.groupName}` : `展开其余 ${hidden} 条（${group.groupName}）`}
          </button>
        </div>
      )}
      {/* area 引用以保持签名稳定（分组色将来按 area 区分时使用） */}
      <span className="hidden">{area.areaKey}</span>
    </div>
  );
}

function AreaBlock({
  area, selectedId, onSelect, expandedKeys, onToggle,
}: {
  area: FeedArea;
  selectedId: string | null;
  onSelect: (t: FeedTask) => void;
  expandedKeys: Set<string>;
  onToggle: (key: string) => void;
}) {
  const Icon = AREA_ICON[area.areaKey] || CircleDot;
  const accent = AREA_ACCENT[area.areaKey] || 'text-slate-400';
  return (
    <div className="px-3 pt-3 pb-1">
      <div className="flex items-center gap-2 mb-2">
        <div className={`w-px h-3 ${AREA_BAR[area.areaKey] || 'bg-slate-400'}`} />
        <div className="flex items-center gap-1.5">
          <Icon className={`w-2.5 h-2.5 ${accent}`} />
          <span className="text-[9px] tracking-[0.12em] uppercase font-bold text-slate-500">{area.areaName}</span>
        </div>
        <div className="flex-1 h-px bg-slate-800" />
        <span className="text-[9px] text-slate-700">{area.count} 个</span>
      </div>
      {area.groups.map((g) => (
        <GroupBlock
          key={g.groupKey}
          area={area}
          group={g}
          selectedId={selectedId}
          onSelect={onSelect}
          expanded={expandedKeys.has(`${area.areaKey}/${g.groupKey}`)}
          onToggle={() => onToggle(`${area.areaKey}/${g.groupKey}`)}
        />
      ))}
    </div>
  );
}

function DetailPanel({ task, onOpen }: { task: FeedTask | null; onOpen: (t: FeedTask) => void }) {
  if (!task) {
    return (
      <div className="flex-1 flex items-center justify-center text-[11px] text-slate-700 px-4 text-center">
        点击中栏任意任务查看详情
      </div>
    );
  }
  const meta = statusMeta(task.status);
  const isActive = task.status === 'active';
  const elapsed = formatElapsed(task.elapsed_ms);
  return (
    <>
      <div className="px-3 py-2 border-b border-slate-800/60 flex-shrink-0">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-1.5">
            <div className={`w-1.5 h-1.5 rounded-full ${meta.dot} ${isActive ? 'wr-pulse' : ''}`} />
            <span className={`text-[10px] font-semibold tracking-wider uppercase ${isActive ? 'text-blue-400' : 'text-slate-500'}`}>
              {kindLabel(task.kind)} · {meta.label}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            {(() => {
              const v = verdictMeta(task.verdict);
              return v ? <span className={`text-[9px] tracking-wide px-1.5 py-px rounded font-bold ${v.pill}`}>{v.label}</span> : null;
            })()}
            {isActive && (
              <span className="flex items-center gap-0.5 text-[10px] text-red-500/70">
                <Radio className="w-2.5 h-2.5 text-red-500" /> LIVE
              </span>
            )}
          </div>
        </div>
        <div className="text-[11px] text-slate-300 leading-snug">{task.title}</div>
        <div className="text-[10px] text-slate-600 mt-0.5">
          {task.priority != null && <span>{formatPriority(task.priority)} · </span>}
          {elapsed ? `${elapsed} 历时` : relativeTime(task.created_at)}
        </div>
      </div>

      {isActive && (task.progress_pct != null || task.current_node) && (
        <div className="px-3 py-2 border-b border-slate-800/40 flex-shrink-0">
          <div className="flex justify-between text-[9px] text-slate-600 mb-1">
            <span>{task.current_node ? `当前节点 · ${task.current_node}` : '进行中'}</span>
            {task.progress_pct != null && <span className="text-blue-400">{task.progress_pct}%</span>}
          </div>
          <div className="h-[2px] rounded-full bg-slate-800 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-blue-600 to-violet-600"
              style={{ width: `${task.progress_pct ?? 8}%` }}
            />
          </div>
        </div>
      )}

      {task.status === 'failed' && task.fail_reason && (
        <div className="px-3 py-2 border-b border-slate-800/40 flex-shrink-0">
          <div className="text-[9px] text-slate-600 mb-1 tracking-wider uppercase">失败原因</div>
          <div className="text-[10px] text-red-400/80 leading-relaxed break-words">{task.fail_reason}</div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-3 py-2 text-[10px] text-slate-500 space-y-1.5">
        <div className="flex justify-between"><span className="text-slate-700">种类</span><span>{kindLabel(task.kind)}</span></div>
        <div className="flex justify-between"><span className="text-slate-700">原始状态</span><span className="font-mono">{task.raw_status}</span></div>
        {task.verdict && <div className="flex justify-between"><span className="text-slate-700">最终验收</span><span className={`font-mono font-semibold ${verdictMeta(task.verdict)?.label === 'FAIL' ? 'text-red-400' : 'text-emerald-400'}`}>{verdictMeta(task.verdict)?.label}</span></div>}
        {task.findings_count != null && <div className="flex justify-between"><span className="text-slate-700">findings</span><span className="font-mono">{task.findings_count}</span></div>}
        <div className="flex justify-between"><span className="text-slate-700">创建</span><span>{relativeTime(task.created_at)}</span></div>
        {elapsed && <div className="flex justify-between"><span className="text-slate-700">历时</span><span className="font-mono">{elapsed}</span></div>}
        <div className="flex justify-between gap-2"><span className="text-slate-700 flex-shrink-0">ID</span><span className="font-mono truncate">{task.id}</span></div>
      </div>

      <div className="border-t border-slate-800/60 p-2 flex gap-1.5 flex-shrink-0">
        <button
          onClick={() => onOpen(task)}
          className="flex-1 flex items-center justify-center gap-1 text-[10px] text-slate-200 bg-violet-600/80 hover:bg-violet-500 rounded py-1.5 transition-colors"
        >
          <FileText className="w-3 h-3" /> 打开详情
        </button>
        {task.pr_url && (
          <a
            href={task.pr_url}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-center gap-1 px-2 text-[10px] text-blue-400 hover:text-blue-300 bg-blue-500/5 hover:bg-blue-500/10 border border-blue-500/20 rounded py-1.5 transition-colors"
          >
            <ExternalLink className="w-3 h-3" /> PR
          </a>
        )}
      </div>
    </>
  );
}

// ====================== 主页面 ======================

const WR_STYLE = `
@keyframes wr-blink { 0%,100%{opacity:1} 50%{opacity:0.3} }
@keyframes wr-pulse-ring { 0%{box-shadow:0 0 0 0 rgba(59,130,246,0.4)} 70%{box-shadow:0 0 0 5px rgba(59,130,246,0)} 100%{box-shadow:0 0 0 0 rgba(59,130,246,0)} }
.wr-pulse { animation: wr-blink 1.3s ease-in-out infinite, wr-pulse-ring 2s infinite; }
.wr-root ::-webkit-scrollbar { width:3px; height:3px; }
.wr-root ::-webkit-scrollbar-thumb { background:#1e293b; border-radius:9px; }
`;

const FILTERS: Array<{ key: string; label: string }> = [
  { key: 'all', label: 'ALL' },
  { key: 'cecelia', label: 'CECELIA' },
  { key: 'zenithjoy', label: 'ZENITHJOY' },
];

// kind 过滤项（区分 harness sprint 与 dev/pipeline/采集）
const KIND_FILTERS: Array<{ key: string; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'sprint', label: 'Sprint' },
  { key: 'task', label: 'Task' },
  { key: 'pipeline', label: 'Pipeline' },
  { key: 'scraper', label: '采集' },
];

export default function WarRoomPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<FeedResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [areaFilter, setAreaFilter] = useState('all');
  const [kindFilter, setKindFilter] = useState('all');
  const [selected, setSelected] = useState<FeedTask | null>(null);
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const [clock, setClock] = useState('');

  const fetchFeed = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      const res = await fetch('/api/brain/warroom/feed');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: FeedResponse = await res.json();
      setData(json);
      setError(null);
      setSelected((prev) => {
        if (prev) {
          // 保持选中项随刷新更新数据
          for (const a of json.areas) for (const g of a.groups) for (const t of g.tasks) {
            if (t.id === prev.id) return t;
          }
        }
        return pickDefaultTask(json.areas);
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFeed();
    const poll = setInterval(() => fetchFeed(true), 15_000);
    return () => clearInterval(poll);
  }, [fetchFeed]);

  useEffect(() => {
    const tick = () => {
      const d = new Date();
      const p = (n: number) => String(n).padStart(2, '0');
      setClock(`${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`);
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);

  const areas = data?.areas ?? [];
  const stats = data?.stats ?? { active: 0, done_today: 0, failed_today: 0, pr_this_month: 0 };
  const visibleAreas = useMemo(
    () => filterByKind(filterArea(areas, areaFilter), kindFilter),
    [areas, areaFilter, kindFilter],
  );

  const toggleGroup = useCallback((key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  const openDetail = useCallback((t: FeedTask) => navigate(t.detail_route), [navigate]);

  return (
    <div className="wr-root h-full flex flex-col bg-[#0a0e1a] text-slate-400 font-mono select-none">
      <style>{WR_STYLE}</style>

      {/* ── 顶栏 ── */}
      <div className="flex items-center h-9 px-4 border-b border-slate-800/80 bg-slate-900/60 flex-shrink-0 gap-4 text-xs">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded bg-gradient-to-br from-violet-500 to-blue-600 flex items-center justify-center">
            <Zap className="w-2.5 h-2.5 text-white" />
          </div>
          <span className="text-slate-300 font-semibold tracking-wider">战情室 WAR ROOM</span>
        </div>
        <div className="h-3 w-px bg-slate-800" />
        <div className="flex items-center gap-5">
          <StatChip dot="bg-blue-400" value={stats.active} label="进行中" valueClass="text-blue-400" />
          <StatChip dot="bg-emerald-500" value={stats.done_today} label="今日完成" />
          <StatChip dot="bg-red-500" value={stats.failed_today} label="今日失败" valueClass="text-red-400" />
          <div className="flex items-center gap-1.5">
            <GitPullRequest className="w-2.5 h-2.5 text-violet-400" />
            <span className="text-slate-300 font-mono">{stats.pr_this_month}</span>
            <span className="text-slate-600">本月 PR</span>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-3">
          <div className="flex items-center gap-1 bg-slate-800/80 border border-slate-700/50 rounded px-1 py-0.5">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setAreaFilter(f.key)}
                className={`px-2 py-0.5 rounded transition-colors ${
                  areaFilter === f.key ? 'bg-slate-700 text-slate-200' : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1 bg-slate-800/80 border border-slate-700/50 rounded px-1 py-0.5">
            {KIND_FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setKindFilter(f.key)}
                className={`px-2 py-0.5 rounded transition-colors ${
                  kindFilter === f.key ? 'bg-violet-600/40 text-violet-100' : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <span className="text-slate-600 font-mono">{clock}</span>
          <button onClick={() => fetchFeed()} className="text-slate-600 hover:text-slate-300 transition-colors" title="刷新">
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* ── 三栏 ── */}
      <div className="flex flex-1 overflow-hidden">
        {/* 左：Area 导航 */}
        <div className="w-44 flex-shrink-0 border-r border-slate-800/60 bg-slate-900/30 overflow-y-auto px-3 pt-3 pb-4">
          <div className="text-[9px] tracking-[0.12em] uppercase text-slate-600 font-bold mb-2">Areas</div>
          <button
            onClick={() => setAreaFilter('all')}
            className={`w-full flex items-center gap-1.5 px-1.5 py-1 rounded text-xs mb-1 transition-colors ${
              areaFilter === 'all' ? 'bg-blue-500/10 text-blue-300' : 'hover:bg-slate-400/5'
            }`}
          >
            <Activity className="w-3 h-3 text-cyan-500 flex-shrink-0" />
            <span className="font-semibold text-slate-300">全部</span>
            <span className="ml-auto bg-slate-700 text-slate-400 text-[9px] rounded px-1">{data?.total ?? 0}</span>
          </button>
          {areas.map((a) => {
            const Icon = AREA_ICON[a.areaKey] || CircleDot;
            const accent = AREA_ACCENT[a.areaKey] || 'text-slate-400';
            const selectedArea = areaFilter === a.areaKey;
            return (
              <div key={a.areaKey} className="mb-1">
                <button
                  onClick={() => setAreaFilter(a.areaKey)}
                  className={`w-full flex items-center gap-1.5 px-1.5 py-1 rounded text-xs transition-colors ${
                    selectedArea ? 'bg-blue-500/10 text-blue-300' : 'hover:bg-slate-400/5'
                  }`}
                >
                  <Icon className={`w-3 h-3 ${accent} flex-shrink-0`} />
                  <span className="font-semibold text-slate-300 truncate">{a.areaName}</span>
                  <span className="ml-auto bg-slate-700 text-slate-400 text-[9px] rounded px-1">{a.count}</span>
                </button>
                <div className="ml-3 mt-0.5 space-y-0.5">
                  {a.groups.slice(0, 6).map((g) => (
                    <div key={g.groupKey} className="flex items-center gap-1.5 px-1.5 py-0.5 rounded text-[11px] text-slate-500">
                      <div className="w-1.5 h-1.5 rounded-full bg-slate-600/40" />
                      <span className="truncate">{g.groupName}</span>
                      <span className="ml-auto text-[9px] text-slate-600">{g.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {/* 中：feed */}
        <div className="flex-1 overflow-y-auto bg-[#0a0e1a]">
          <div className="sticky top-0 z-10 bg-[#0a0e1a]/95 backdrop-blur-sm border-b border-slate-800/50">
            <div className="flex items-center gap-2 px-4 py-1.5">
              <span className="text-[9px] tracking-[0.12em] uppercase text-slate-600 font-bold">任务 Feed</span>
              <span className="text-[9px] text-slate-700 font-mono">{data?.total ?? 0} 条</span>
              {data && (
                <div className="ml-auto flex items-center gap-1 text-[10px] text-slate-700">
                  <Clock className="w-2.5 h-2.5" />
                  <span>{relativeTime(data.generated_at) || '刚刚'}更新</span>
                </div>
              )}
            </div>
          </div>

          {loading && !data && (
            <div className="flex items-center gap-2 px-4 py-8 text-slate-600 text-xs">
              <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" /> 加载中…
            </div>
          )}
          {error && (
            <div className="m-4 rounded border border-red-500/20 bg-red-500/5 p-3 text-[11px] text-red-400">
              加载失败：{error}
              <button onClick={() => fetchFeed()} className="ml-2 underline hover:text-red-300">重试</button>
            </div>
          )}
          {data && visibleAreas.length === 0 && !loading && (
            <div className="px-4 py-8 text-slate-700 text-xs">该过滤条件下暂无任务</div>
          )}
          {visibleAreas.map((a) => (
            <AreaBlock
              key={a.areaKey}
              area={a}
              selectedId={selected?.id ?? null}
              onSelect={setSelected}
              expandedKeys={expandedKeys}
              onToggle={toggleGroup}
            />
          ))}
        </div>

        {/* 右：详情 */}
        <div className="w-72 flex-shrink-0 border-l border-slate-800/60 bg-slate-900/20 flex flex-col overflow-hidden">
          <DetailPanel task={selected} onOpen={openDetail} />
        </div>
      </div>
    </div>
  );
}
