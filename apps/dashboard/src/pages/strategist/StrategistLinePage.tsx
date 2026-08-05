/**
 * StrategistLinePage — 军师台线空间（七页签）
 *
 * 路由：/strategist/:lineId
 * 页签：全貌 | 规划 | 晨报 | 拍板 | 对话 | 要素 | 投入
 * 已落地：全貌/规划/晨报/拍板/对话/投入；要素待建
 */

import { useEffect, useState, useCallback, useRef, useMemo, type ComponentType } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, RefreshCw, MapPin, FileText,
  CheckSquare, MessageSquare, Layout, DollarSign,
  ChevronRight, Activity, CheckCircle2, Zap,
  X, LayoutGrid, BookOpen, AlertCircle, Clock,
} from 'lucide-react';
import ConversationsPanel from '../warroom/ConversationsPanel';
import {
  roadmapRows,
  type LineDetail, type LineSummary,
} from '../warroom/WarRoomPage';
import { healthScore, healthMeta } from './StrategistPage';

// ── 晨报类型 ─────────────────────────────────────────────────────────────────

interface DiaryDoc {
  id: string;
  type: string;
  title: string;
  content?: string | null;
  area?: string | null;
  author?: string | null;
  diary_date?: string | null;
  created_at: string;
}

// ── 拍板任务类型 ─────────────────────────────────────────────────────────────

interface StrategistTask {
  id: string;
  title: string;
  description?: string | null;
  status: string;
  priority?: string | null;
  created_at: string;
  payload?: { journey_id?: string } | null;
}

// ── 工具函数 ─────────────────────────────────────────────────────────────────

const MATURITY_LABEL: Record<string, string> = {
  not_started: '待启', skeleton: '骨架', mvp: 'MVP', live: '上线', stable: '稳定',
};

function fmtRelative(iso: string | null | undefined): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m}分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}小时前`;
  return `${Math.floor(h / 24)}天前`;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const opt: Intl.DateTimeFormatOptions = { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit' };
  return d.toLocaleDateString('zh-CN', opt).replace(/\//g, '-');
}

// ── 样式 ─────────────────────────────────────────────────────────────────────

const ST_STYLE = `
@keyframes wr-blink { 0%,100%{opacity:1} 50%{opacity:0.3} }
@keyframes wr-pulse-ring { 0%{box-shadow:0 0 0 0 rgba(59,130,246,0.4)} 70%{box-shadow:0 0 0 5px rgba(59,130,246,0)} 100%{box-shadow:0 0 0 0 rgba(59,130,246,0)} }
.wr-pulse { animation: wr-blink 1.3s ease-in-out infinite, wr-pulse-ring 2s infinite; }
.sl-root ::-webkit-scrollbar { width:3px; height:3px; }
.sl-root ::-webkit-scrollbar-thumb { background:#1e293b; border-radius:9px; }
`;

// ── Tab 定义 ─────────────────────────────────────────────────────────────────

const TABS = [
  { key: 'overview', label: '全貌', icon: Layout },
  { key: 'roadmap', label: '规划', icon: MapPin },
  { key: 'morning', label: '晨报', icon: FileText },
  { key: 'decision', label: '拍板', icon: CheckSquare },
  { key: 'conversation', label: '对话', icon: MessageSquare },
  { key: 'elements', label: '要素', icon: Activity },
  { key: 'investment', label: '投入', icon: DollarSign },
] as const;

type TabKey = typeof TABS[number]['key'];


// ── 格子账本类型 ─────────────────────────────────────────────────────────────

interface JourneyStep {
  id: string;
  journey_id: string;
  name: string;
  step_number: number;
  status: string;
  promise?: string | null;
  description?: string | null;
  backbone_version?: string | null;
}

type CellStatus = 'gray' | 'red' | 'pending' | 'green';
type CellKind = 'capability' | 'element' | 'scenario' | 'base_ref';

interface StepCell {
  id: string;
  step_id: string;
  journey_id: string;
  cell_kind: CellKind;
  cell_key: string;
  cell_status: CellStatus;
  assertion_ref?: string | null;
  na_reason?: string | null;
  feature_id?: string | null;
  assertion_revision?: string;
}

const CELL_STATUS_META: Record<CellStatus, { dot: string; text: string; bg: string; label: string }> = {
  gray:    { dot: 'bg-slate-600',   text: 'text-slate-500',   bg: 'bg-slate-800/40',  label: '待填' },
  red:     { dot: 'bg-red-500',     text: 'text-red-400',     bg: 'bg-red-900/30',    label: '缺失' },
  pending: { dot: 'bg-amber-400',   text: 'text-amber-300',   bg: 'bg-amber-900/25',  label: '待验' },
  green:   { dot: 'bg-emerald-500', text: 'text-emerald-400', bg: 'bg-emerald-900/20',label: '已覆盖' },
};

const STANDARD_ELEMENT_KEYS = ['FR', 'NFR', '判定点', '不变量', '失败语义', '效果确认', '两轴衔接'];

const STEP_STATUS_META: Record<string, { dot: string }> = {
  done:        { dot: 'bg-emerald-500' },
  in_progress: { dot: 'bg-blue-400' },
  planned:     { dot: 'bg-slate-600' },
  blocked:     { dot: 'bg-red-500' },
};

// ── GP 版本类型 ───────────────────────────────────────────────────────────────

interface GoldenPath {
  id: string;
  title: string;
  one_liner?: string | null;
  status: string;
  approved_at?: string | null;
  created_at: string;
}

const GP_STATUS_META: Record<string, { dot: string; text: string; label: string }> = {
  candidate:    { dot: 'bg-slate-600',   text: 'text-slate-400',   label: '候选' },
  proposed:     { dot: 'bg-amber-400',   text: 'text-amber-300',   label: '报备中' },
  converged:    { dot: 'bg-blue-400',    text: 'text-blue-300',    label: '批审中' },
  approved:     { dot: 'bg-emerald-500', text: 'text-emerald-400', label: '已批' },
  in_dev:       { dot: 'bg-indigo-400',  text: 'text-indigo-300',  label: '开发中' },
  delivered:    { dot: 'bg-purple-400',  text: 'text-purple-300',  label: '已交付' },
  expired:      { dot: 'bg-slate-600',   text: 'text-slate-500',   label: '过期' },
  rejected:     { dot: 'bg-red-500',     text: 'text-red-400',     label: '已否' },
  blocked_gate: { dot: 'bg-orange-400',  text: 'text-orange-300',  label: '闸阻' },
  superseded:   { dot: 'bg-slate-700',   text: 'text-slate-600',   label: '已替代' },
};

function CellDot({ status, size = 'sm' }: { status: CellStatus; size?: 'xs' | 'sm' }) {
  const meta = CELL_STATUS_META[status] ?? CELL_STATUS_META.gray;
  const sz = size === 'xs' ? 'w-1.5 h-1.5' : 'w-2 h-2';
  return <span className={`inline-block rounded-full flex-shrink-0 ${sz} ${meta.dot}`} />;
}

function CellRowDetail({ cell, onClose }: { cell: StepCell; onClose: () => void }) {
  const meta = CELL_STATUS_META[cell.cell_status] ?? CELL_STATUS_META.gray;
  const KIND_LABEL: Record<CellKind, string> = {
    capability: '能力', element: '要素', scenario: '场景', base_ref: '基准引用',
  };
  return (
    <div className={`mx-4 mb-2 rounded border p-3 text-[11px] font-mono ${meta.bg} border-slate-700/40`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <CellDot status={cell.cell_status} />
          <span className="text-slate-200 font-semibold">{cell.cell_key}</span>
          <span className="text-slate-600 px-1 rounded bg-slate-800/60">{KIND_LABEL[cell.cell_kind]}</span>
          <span className={meta.text}>{meta.label}</span>
        </div>
        <button onClick={onClose} className="text-slate-700 hover:text-slate-400 p-0.5">
          <X className="w-3 h-3" />
        </button>
      </div>
      <div className="space-y-1 text-[10px]">
        <div className="flex gap-2">
          <span className="text-slate-600 w-20 flex-shrink-0">断言引用</span>
          <span className={cell.assertion_ref ? 'text-slate-300' : 'text-slate-700'}>{cell.assertion_ref || '—'}</span>
        </div>
        <div className="flex gap-2">
          <span className="text-slate-600 w-20 flex-shrink-0">豁免原因</span>
          <span className={cell.na_reason ? 'text-amber-300' : 'text-slate-700'}>{cell.na_reason || '—'}</span>
        </div>
        <div className="flex gap-2">
          <span className="text-slate-600 w-20 flex-shrink-0">断言版本</span>
          <span className="text-slate-600">{cell.assertion_revision ? `r${cell.assertion_revision}` : '—'}</span>
        </div>
        <div className="flex gap-2">
          <span className="text-slate-600 w-20 flex-shrink-0">格子 ID</span>
          <span className="text-slate-700">{cell.id.slice(0, 16)}…</span>
        </div>
      </div>
    </div>
  );
}

function StepLedgerPanel({ step, cells, onClose }: { step: JourneyStep; cells: StepCell[]; onClose: () => void }) {
  const [expandedCell, setExpandedCell] = useState<string | null>(null);
  const [panelView, setPanelView] = useState<'ledger' | 'versions'>('ledger');
  const [gps, setGps] = useState<GoldenPath[]>([]);
  const [gpsLoading, setGpsLoading] = useState(false);
  const capabilityCells = cells.filter(c => c.cell_kind === 'capability');
  const elementCells    = cells.filter(c => c.cell_kind === 'element');
  const scenarioCells   = cells.filter(c => c.cell_kind === 'scenario');
  const greenEl = elementCells.filter(c => c.cell_status === 'green').length;
  const stepDot = (STEP_STATUS_META[step.status] ?? STEP_STATUS_META.planned).dot;

  useEffect(() => {
    if (panelView !== 'versions' || gps.length > 0) return;
    setGpsLoading(true);
    fetch(`/api/brain/golden-paths?journey_id=${encodeURIComponent(step.journey_id)}&limit=30`)
      .then(r => r.json())
      .then(d => setGps(Array.isArray(d.golden_paths) ? d.golden_paths : []))
      .catch(() => {})
      .finally(() => setGpsLoading(false));
  }, [panelView, step.journey_id, gps.length]);

  const CellZoneRow = ({ cell }: { cell: StepCell }) => {
    const isExpanded = expandedCell === cell.id;
    const meta = CELL_STATUS_META[cell.cell_status] ?? CELL_STATUS_META.gray;
    return (
      <>
        <button
          onClick={() => setExpandedCell(isExpanded ? null : cell.id)}
          className={`w-full flex items-center gap-2.5 px-4 py-2 text-left hover:bg-slate-800/20 transition-colors ${isExpanded ? 'bg-slate-800/30' : ''}`}
        >
          <CellDot status={cell.cell_status} />
          <span className={`flex-1 text-[11px] font-mono ${meta.text}`}>{cell.cell_key}</span>
          <span className="text-[10px] text-slate-700">{meta.label}</span>
          {cell.assertion_ref && (
            <span className="text-[10px] text-indigo-400/80 truncate max-w-24" title={cell.assertion_ref}>
              {cell.assertion_ref.split('/').pop()}
            </span>
          )}
          <ChevronRight className={`w-2.5 h-2.5 text-slate-700 flex-shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
        </button>
        {isExpanded && <CellRowDetail cell={cell} onClose={() => setExpandedCell(null)} />}
      </>
    );
  };

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      <div className="flex items-start gap-3 px-4 py-3 border-b border-slate-800/60 bg-slate-900/30 flex-shrink-0">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-mono text-slate-600">#{step.step_number}</span>
            <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${stepDot} ${step.status === 'in_progress' ? 'wr-pulse' : ''}`} />
            <span className="text-[13px] text-slate-100 font-semibold leading-snug truncate">{step.name}</span>
          </div>
          {step.promise && (
            <div className="text-[11px] text-slate-500 mt-0.5 leading-relaxed line-clamp-2">承诺：{step.promise}</div>
          )}
          {elementCells.length > 0 && (
            <div className="flex items-center gap-1.5 mt-1">
              <div className="w-16 h-[3px] rounded-full bg-slate-800 overflow-hidden">
                <div className="h-full rounded-full bg-emerald-500/60" style={{ width: `${Math.round((greenEl / elementCells.length) * 100)}%` }} />
              </div>
              <span className="text-[10px] text-slate-600 font-mono">{greenEl}/{elementCells.length} 要素</span>
            </div>
          )}
        </div>
        <button onClick={onClose} className="text-slate-600 hover:text-slate-300 transition-colors flex-shrink-0 p-0.5">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* 账本 | 版本 切换 */}
      <div className="flex items-center border-b border-slate-800/50 flex-shrink-0">
        {(['ledger', 'versions'] as const).map(v => (
          <button
            key={v}
            onClick={() => { setPanelView(v); setExpandedCell(null); }}
            className={`flex items-center gap-1 px-3 py-1.5 text-[11px] font-semibold border-b-2 transition-colors ${
              panelView === v ? 'border-indigo-500 text-indigo-300' : 'border-transparent text-slate-600 hover:text-slate-400'
            }`}
          >
            {v === 'ledger' ? <BookOpen className="w-2.5 h-2.5" /> : <Clock className="w-2.5 h-2.5" />}
            {v === 'ledger' ? '账本' : '版本'}
          </button>
        ))}
      </div>

      {/* 版本历史面板（Level 3）*/}
      {panelView === 'versions' && (
        <div className="flex-1 overflow-y-auto">
          {gpsLoading ? (
            <div className="flex items-center gap-2 p-6 text-slate-600 text-sm">
              <div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
              加载版本记录…
            </div>
          ) : gps.length === 0 ? (
            <div className="p-8 flex flex-col items-center gap-3 text-center">
              <Clock className="w-6 h-6 text-slate-700" />
              <div className="text-[12px] text-slate-600">本线暂无 GP 版本记录</div>
              <div className="text-[10px] text-slate-700">GP 批准后自动成为版本节点（照相层）</div>
            </div>
          ) : (
            <div>
              {gps.map((gp, idx) => {
                const sm = GP_STATUS_META[gp.status] ?? { dot: 'bg-slate-700', text: 'text-slate-500', label: gp.status };
                return (
                  <div key={gp.id} className="border-b border-slate-800/30">
                    <div className="flex items-start gap-2.5 px-4 py-2.5">
                      <span className="text-[10px] font-mono text-slate-700 flex-shrink-0 mt-0.5">v{gps.length - idx}</span>
                      <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1 ${sm.dot}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[12px] text-slate-200 truncate font-mono">{gp.title}</span>
                          <span className={`text-[10px] px-1 py-px rounded border border-slate-700/60 ${sm.text} flex-shrink-0`}>
                            {sm.label}
                          </span>
                        </div>
                        {gp.one_liner && (
                          <div className="text-[10px] text-slate-600 mt-0.5 line-clamp-1">{gp.one_liner}</div>
                        )}
                        <div className="text-[10px] text-slate-700 mt-0.5 font-mono">
                          {gp.approved_at ? `批准 ${fmtDate(gp.approved_at)}` : `创建 ${fmtDate(gp.created_at)}`}
                        </div>
                      </div>
                    </div>
                    {/* 格子级快照 diff（暂无数据，待照相层上线） */}
                    {gp.status === 'approved' || gp.status === 'delivered' ? (
                      <div className="mx-4 mb-2 px-2 py-1 rounded bg-violet-900/10 border border-violet-500/15 text-[10px] text-violet-500/60 font-mono">
                        ∅ 格子快照待照相层接入
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 账本面板（Level 2）*/}
      {panelView === 'ledger' && (
      <div className="flex-1 overflow-y-auto">
        {elementCells.length > 0 && (
          <div>
            <div className="flex items-center gap-2 px-4 py-1.5 bg-slate-900/30 border-b border-slate-800/30">
              <BookOpen className="w-2.5 h-2.5 text-slate-600" />
              <span className="text-[10px] tracking-[0.1em] uppercase text-slate-600 font-semibold">要素</span>
              <span className="text-[10px] text-slate-700">{greenEl}/{elementCells.length}</span>
            </div>
            {elementCells.map(cell => <CellZoneRow key={cell.id} cell={cell} />)}
          </div>
        )}
        {capabilityCells.length > 0 && (
          <div>
            <div className="flex items-center gap-2 px-4 py-1.5 bg-slate-900/30 border-b border-slate-800/30">
              <Zap className="w-2.5 h-2.5 text-slate-600" />
              <span className="text-[10px] tracking-[0.1em] uppercase text-slate-600 font-semibold">能力</span>
              <span className="text-[10px] text-slate-700">{capabilityCells.filter(c => c.cell_status === 'green').length}/{capabilityCells.length}</span>
            </div>
            {capabilityCells.map(cell => <CellZoneRow key={cell.id} cell={cell} />)}
          </div>
        )}
        {scenarioCells.length > 0 && (
          <div>
            <div className="flex items-center gap-2 px-4 py-1.5 bg-slate-900/30 border-b border-slate-800/30">
              <Activity className="w-2.5 h-2.5 text-slate-600" />
              <span className="text-[10px] tracking-[0.1em] uppercase text-slate-600 font-semibold">场景</span>
              <span className="text-[10px] text-slate-700">{scenarioCells.filter(c => c.cell_status === 'green').length}/{scenarioCells.length}</span>
            </div>
            {scenarioCells.map(cell => <CellZoneRow key={cell.id} cell={cell} />)}
          </div>
        )}
        {cells.length === 0 && (
          <div className="p-8 flex flex-col items-center gap-3 text-center">
            <AlertCircle className="w-6 h-6 text-slate-700" />
            <div className="text-[12px] text-slate-600">本步骤暂无格子账本</div>
            <div className="text-[10px] text-slate-700">账本模板铺入后自动出现</div>
          </div>
        )}
      </div>
      )}
    </div>
  );
}

// ── 全貌 Tab（Line总览表：Step × 要素矩阵 + 格子账本详情） ───────────────────

function OverviewTab({ detail, lineId }: { detail: LineDetail | null; lineId: string }) {
  // 格子账本数据
  const [steps, setSteps] = useState<JourneyStep[]>([]);
  const [cells, setCells] = useState<StepCell[]>([]);
  const [ledgerLoading, setLedgerLoading] = useState(true);
  const [selectedStep, setSelectedStep] = useState<JourneyStep | null>(null);

  useEffect(() => {
    setLedgerLoading(true);
    Promise.all([
      fetch(`/api/brain/journey_steps?journey_id=${encodeURIComponent(lineId)}&limit=50`).then(r => r.json()),
      fetch(`/api/brain/journey_step_links?journey_id=${encodeURIComponent(lineId)}&cells=1&limit=500`).then(r => r.json()),
    ])
      .then(([stepsData, cellsData]) => {
        const arr: JourneyStep[] = Array.isArray(stepsData) ? stepsData : [];
        setSteps(arr.sort((a, b) => a.step_number - b.step_number));
        setCells(Array.isArray(cellsData) ? cellsData : []);
      })
      .catch(() => {})
      .finally(() => setLedgerLoading(false));
  }, [lineId]);

  const cellsByStep = useMemo(() => {
    const map: Record<string, StepCell[]> = {};
    for (const cell of cells) {
      if (!map[cell.step_id]) map[cell.step_id] = [];
      map[cell.step_id].push(cell);
    }
    return map;
  }, [cells]);

  const elementKeys = useMemo(() => {
    const found = new Set<string>();
    for (const cell of cells) {
      if (cell.cell_kind === 'element') found.add(cell.cell_key);
    }
    return STANDARD_ELEMENT_KEYS.filter(k => found.has(k))
      .concat([...found].filter(k => !STANDARD_ELEMENT_KEYS.includes(k)));
  }, [cells]);

  if (!detail) return <div className="p-6 text-slate-600 text-sm">线数据加载中…</div>;

  const { line, tasks } = detail;
  const safeTasks = Array.isArray(tasks) ? tasks : [];
  const active = safeTasks.filter((t) => t.status === 'active');
  const score = healthScore(line as LineSummary);
  const meta = healthMeta(score);
  const selectedStepCells = selectedStep ? (cellsByStep[selectedStep.id] ?? []) : [];
  const greenCells = cells.filter(c => c.cell_status === 'green').length;

  return (
    <div className="flex h-full min-h-0">
      {/* ── 左侧：Step × 要素 矩阵（Level 1） ── */}
      <div className={`flex flex-col min-h-0 overflow-hidden border-r border-slate-800/60 transition-all ${selectedStep ? 'w-[55%]' : 'w-full'}`}>

        {/* 线档案摘要条 */}
        <div className="flex items-center gap-4 px-5 py-2.5 border-b border-slate-800/40 bg-slate-900/30 flex-shrink-0 text-[11px]">
          <span className="text-slate-600">成熟度</span>
          <span className="text-slate-300">{MATURITY_LABEL[line.maturity ?? ''] ?? (line.maturity ?? '--')}</span>
          <span className="text-slate-700 mx-1">·</span>
          <span className={`font-bold font-mono ${meta.text}`}>{score}</span>
          <span className="text-slate-600">健康分</span>
          <span className="text-slate-700 mx-1">·</span>
          <span className="text-blue-300">{active.length}</span>
          <span className="text-slate-600">进行中</span>
          {cells.length > 0 && (
            <>
              <span className="text-slate-700 mx-1">·</span>
              <span className="text-emerald-400 font-mono">{greenCells}</span>
              <span className="text-slate-600">/{cells.length} 格覆盖</span>
            </>
          )}
        </div>

        {/* 矩阵表头 */}
        <div className="flex-shrink-0 border-b border-slate-800/50 overflow-x-auto">
          <table className="w-full min-w-[480px] text-[11px] font-mono">
            <thead>
              <tr>
                <th className="text-left pl-5 pr-2 py-2 text-slate-600 font-semibold tracking-[0.08em] uppercase w-8">#</th>
                <th className="text-left pr-3 py-2 text-slate-600 font-semibold tracking-[0.08em] uppercase">步骤</th>
                <th className="text-center px-2 py-2 text-slate-600 font-semibold w-10" title="能力">能</th>
                {elementKeys.map(key => (
                  <th key={key} className="text-center px-1.5 py-2 text-slate-600 font-semibold w-10" title={key}>
                    {key.length > 4 ? key.slice(0, 3) + '…' : key}
                  </th>
                ))}
                <th className="text-center px-2 py-2 text-slate-600 font-semibold w-10" title="场景">景</th>
              </tr>
            </thead>
          </table>
        </div>

        {/* 矩阵内容 */}
        <div className="flex-1 overflow-y-auto">
          {ledgerLoading ? (
            <div className="flex items-center gap-2 p-6 text-slate-600 text-sm">
              <div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
              加载格子账本…
            </div>
          ) : steps.length === 0 ? (
            <div className="p-8 flex flex-col items-center gap-3 text-center">
              <LayoutGrid className="w-8 h-8 text-slate-700" />
              <div className="text-[13px] text-slate-600">本线暂无步骤账本</div>
              <div className="text-[11px] text-slate-700">账本模板铺入后自动出现</div>
            </div>
          ) : (
            <table className="w-full min-w-[480px] text-[11px] font-mono">
              <tbody>
                {steps.map(step => {
                  const stepCells = cellsByStep[step.id] ?? [];
                  const capCells = stepCells.filter(c => c.cell_kind === 'capability');
                  const scnCells = stepCells.filter(c => c.cell_kind === 'scenario');
                  const isSelected = selectedStep?.id === step.id;
                  const stepDot = (STEP_STATUS_META[step.status] ?? STEP_STATUS_META.planned).dot;
                  const greenCap = capCells.filter(c => c.cell_status === 'green').length;
                  const greenScn = scnCells.filter(c => c.cell_status === 'green').length;

                  return (
                    <tr
                      key={step.id}
                      onClick={() => setSelectedStep(isSelected ? null : step)}
                      className={`border-b border-slate-800/30 cursor-pointer transition-colors ${
                        isSelected ? 'bg-indigo-500/10 border-indigo-500/20' : 'hover:bg-slate-800/20'
                      }`}
                    >
                      <td className="pl-5 pr-2 py-2.5 w-8">
                        <span className="text-slate-700 text-[10px]">{step.step_number}</span>
                      </td>
                      <td className="pr-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${stepDot} ${step.status === 'in_progress' ? 'wr-pulse' : ''}`} />
                          <span className={`text-[12px] ${isSelected ? 'text-indigo-200 font-semibold' : 'text-slate-200'} truncate`}>
                            {step.name}
                          </span>
                        </div>
                        {step.promise && !isSelected && (
                          <div className="text-[10px] text-slate-600 mt-0.5 truncate pl-3.5">{step.promise}</div>
                        )}
                      </td>
                      {/* 能力数 */}
                      <td className="text-center px-2 py-2.5 w-10">
                        {capCells.length > 0 ? (
                          <span className={`text-[10px] font-mono ${greenCap === capCells.length ? 'text-emerald-400' : greenCap > 0 ? 'text-amber-400' : 'text-slate-600'}`}>
                            {greenCap}/{capCells.length}
                          </span>
                        ) : <span className="text-slate-800">—</span>}
                      </td>
                      {/* 要素格 */}
                      {elementKeys.map(key => {
                        const cell = stepCells.find(c => c.cell_kind === 'element' && c.cell_key === key);
                        if (!cell) return (
                          <td key={key} className="text-center px-1.5 py-2.5 w-10">
                            <span className="text-slate-800">—</span>
                          </td>
                        );
                        return (
                          <td key={key} className="text-center px-1.5 py-2.5 w-10">
                            <div className="flex justify-center">
                              <CellDot status={cell.cell_status} size="xs" />
                            </div>
                          </td>
                        );
                      })}
                      {/* 场景数 */}
                      <td className="text-center px-2 py-2.5 w-10">
                        {scnCells.length > 0 ? (
                          <span className={`text-[10px] font-mono ${greenScn === scnCells.length ? 'text-emerald-400' : greenScn > 0 ? 'text-amber-400' : 'text-slate-600'}`}>
                            {greenScn}/{scnCells.length}
                          </span>
                        ) : <span className="text-slate-800">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* 图例 */}
        {!ledgerLoading && steps.length > 0 && (
          <div className="flex-shrink-0 flex items-center gap-4 px-5 py-2 border-t border-slate-800/40 bg-slate-900/20 text-[10px]">
            <span className="text-slate-700">格子：</span>
            {(['gray', 'red', 'pending', 'green'] as CellStatus[]).map(s => (
              <div key={s} className="flex items-center gap-1">
                <CellDot status={s} size="xs" />
                <span className="text-slate-600">{CELL_STATUS_META[s].label}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── 右侧：Step 格子账本详情（Level 2+3） ── */}
      {selectedStep && (
        <div className="flex flex-col min-h-0 overflow-hidden" style={{ width: '45%' }}>
          <StepLedgerPanel
            step={selectedStep}
            cells={selectedStepCells}
            onClose={() => setSelectedStep(null)}
          />
        </div>
      )}
    </div>
  );
}


// ── 规划 Tab ─────────────────────────────────────────────────────────────────

function RoadmapTab({ detail }: { detail: LineDetail | null }) {
  if (!detail) return <div className="p-6 text-slate-600 text-sm">加载中…</div>;
  const rows = roadmapRows(detail.steps);
  return (
    <div className="p-6 max-w-xl">
      <div className="text-[11px] tracking-[0.12em] uppercase text-slate-600 font-bold mb-4">
        路线图 · {rows.length} 步
      </div>
      {rows.length === 0 ? (
        <div className="text-slate-700 text-sm pl-2">暂无规划步骤</div>
      ) : (
        <div className="relative pl-2">
          <div className="absolute left-[9px] top-2 bottom-2 w-px bg-slate-800/60" />
          <div className="space-y-4">
            {rows.map((r) => (
              <div key={`${r.step_number}-${r.name}`} className="relative flex items-start gap-4">
                <div className={`relative z-10 mt-1 w-4 h-4 rounded-full flex-shrink-0 ring-2 ring-[#0a0e1a] ${r.dot} ${r.status === 'in_progress' ? 'wr-pulse' : ''}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-mono text-slate-600 flex-shrink-0">#{r.step_number}</span>
                    <span className={`text-[14px] ${r.text} ${r.status === 'in_progress' ? 'font-semibold' : ''}`}>{r.name}</span>
                    {r.status === 'done' && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />}
                  </div>
                  {r.description && (
                    <div className="text-[12px] text-slate-600 mt-0.5 leading-relaxed line-clamp-3">{r.description}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── 晨报 Tab ─────────────────────────────────────────────────────────────────

function MorningTab() {
  const [docs, setDocs] = useState<DiaryDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [fullDocs, setFullDocs] = useState<Record<string, DiaryDoc>>({});
  const [loadingFull, setLoadingFull] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/brain/design-docs?type=battle_report,diary&limit=20');
        const data = await res.json();
        const list: DiaryDoc[] = Array.isArray(data) ? data : (data?.data ?? []);
        setDocs(list.filter((d) => d.title && !d.title.startsWith('[ci-patrol-state]')));
      } catch { /* 加载失败保持空列表 */ } finally {
        setLoading(false);
      }
    })();
  }, []);

  const toggleExpand = async (doc: DiaryDoc) => {
    if (expanded === doc.id) { setExpanded(null); return; }
    setExpanded(doc.id);
    if (!fullDocs[doc.id]) {
      setLoadingFull(true);
      try {
        const res = await fetch(`/api/brain/design-docs/${encodeURIComponent(doc.id)}`);
        const full: DiaryDoc = await res.json();
        setFullDocs((prev) => ({ ...prev, [doc.id]: full }));
      } catch { /* 展开失败静默 */ } finally {
        setLoadingFull(false);
      }
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-6 text-slate-600 text-sm">
        <div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        加载晨报…
      </div>
    );
  }

  return (
    <div className="p-6 max-w-2xl">
      <div className="text-[11px] tracking-[0.12em] uppercase text-slate-600 font-bold mb-4">
        晨报 · 最近 {docs.length} 份
      </div>
      {docs.length === 0 ? (
        <div className="text-slate-700 text-sm">暂无晨报</div>
      ) : (
        <div className="space-y-2">
          {docs.map((doc) => {
            const isOpen = expanded === doc.id;
            const full = fullDocs[doc.id];
            return (
              <div
                key={doc.id}
                className="rounded-lg border border-slate-800/60 bg-slate-900/20 overflow-hidden"
              >
                <button
                  onClick={() => toggleExpand(doc)}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-800/20 transition-colors"
                >
                  <FileText className="w-3.5 h-3.5 text-indigo-400 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] text-slate-300 truncate">{doc.title}</div>
                    <div className="text-[11px] text-slate-600 mt-0.5">
                      {doc.author && <span className="mr-2">{doc.author}</span>}
                      {fmtDate(doc.diary_date || doc.created_at)}
                    </div>
                  </div>
                  <ChevronRight className={`w-3.5 h-3.5 text-slate-600 flex-shrink-0 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                </button>
                {isOpen && (
                  <div className="px-4 pb-4 border-t border-slate-800/40">
                    {loadingFull && !full ? (
                      <div className="text-[12px] text-slate-600 py-2">加载内容…</div>
                    ) : (
                      <pre className="text-[12px] text-slate-400 leading-relaxed whitespace-pre-wrap break-words mt-2 max-h-80 overflow-y-auto">
                        {full?.content || doc.content || '（内容为空）'}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── 拍板 Tab ─────────────────────────────────────────────────────────────────

const TASK_STATUS_META: Record<string, { dot: string; text: string; label: string }> = {
  queued: { dot: 'bg-amber-400', text: 'text-amber-300', label: '待处理' },
  in_progress: { dot: 'bg-blue-400 wr-pulse', text: 'text-blue-300', label: '处理中' },
  completed: { dot: 'bg-emerald-500', text: 'text-emerald-400', label: '已完成' },
  failed: { dot: 'bg-red-500', text: 'text-red-400', label: '失败' },
};

function DecisionTab({ lineId }: { lineId: string }) {
  const [tasks, setTasks] = useState<StrategistTask[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/brain/tasks?task_type=strategist_decision&limit=30');
        const data = await res.json();
        const all: StrategistTask[] = Array.isArray(data) ? data : (data?.data ?? []);
        // 优先展示与当前 line 相关的，其余按时间排
        const related = all.filter((t) => t.payload?.journey_id === lineId);
        const others = all.filter((t) => t.payload?.journey_id !== lineId);
        setTasks([...related, ...others]);
      } catch { /* 失败静默 */ } finally {
        setLoading(false);
      }
    })();
  }, [lineId]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-6 text-slate-600 text-sm">
        <div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        加载拍板队列…
      </div>
    );
  }

  const pending = tasks.filter((t) => t.status === 'queued' || t.status === 'in_progress');
  const done = tasks.filter((t) => t.status === 'completed' || t.status === 'failed');

  return (
    <div className="p-6 max-w-2xl space-y-6">
      {/* 待处理 */}
      <div>
        <div className="text-[11px] tracking-[0.12em] uppercase text-slate-500 font-bold mb-3">
          待拍板 · {pending.length} 条
        </div>
        {pending.length === 0 ? (
          <div className="text-slate-700 text-sm pl-2">无待拍板事项</div>
        ) : (
          <div className="space-y-2">
            {pending.map((t) => {
              const sm = TASK_STATUS_META[t.status] || { dot: 'bg-slate-600', text: 'text-slate-400', label: t.status };
              const isThisLine = t.payload?.journey_id === lineId;
              return (
                <div
                  key={t.id}
                  className={`rounded-lg border px-4 py-3 ${isThisLine ? 'border-indigo-500/30 bg-indigo-500/5' : 'border-slate-800/60 bg-slate-900/20'}`}
                >
                  <div className="flex items-center gap-2.5">
                    <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${sm.dot}`} />
                    {/* Fix-2: UUID 降级 + data-testid */}
                    <span
                      data-testid="decision-card-title"
                      className="text-[13px] text-slate-200 flex-1 min-w-0"
                    >
                      {/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t.title)
                        ? (t.description || '待拍板事项')
                        : t.title}
                    </span>
                    <span className={`text-[11px] px-1.5 py-px rounded border border-slate-700/50 ${sm.text} flex-shrink-0`}>
                      {sm.label}
                    </span>
                    {isThisLine && (
                      <span className="text-[11px] px-1.5 py-px rounded bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 flex-shrink-0">
                        本线
                      </span>
                    )}
                  </div>
                  {t.description && (
                    <div className="text-[12px] text-slate-500 mt-1.5 leading-relaxed line-clamp-2">{t.description}</div>
                  )}
                  {/* Fix-2: A/B 选项按钮（纯 UI，无后端调用） */}
                  <div className="flex items-center gap-2 mt-2">
                    <button className="text-[11px] px-2 py-1 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/25 transition-colors">通过</button>
                    <button className="text-[11px] px-2 py-1 rounded bg-red-500/15 text-red-400 border border-red-500/30 hover:bg-red-500/25 transition-colors">否决</button>
                  </div>
                  <div className="text-[11px] text-slate-700 mt-1">{fmtRelative(t.created_at)}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 已处理 */}
      {done.length > 0 && (
        <div>
          <div className="text-[11px] tracking-[0.12em] uppercase text-slate-600 font-bold mb-3">
            已处理 · {done.length} 条
          </div>
          <div className="space-y-1.5">
            {done.slice(0, 10).map((t) => {
              const sm = TASK_STATUS_META[t.status] || { dot: 'bg-slate-600', text: 'text-slate-400', label: t.status };
              return (
                <div key={t.id} className="flex items-center gap-2.5 px-3 py-2 rounded border border-slate-800/40 text-[13px]">
                  <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${sm.dot}`} />
                  <span className="text-slate-500 flex-1 min-w-0 truncate">{t.title}</span>
                  <span className="text-slate-700 flex-shrink-0">{fmtRelative(t.created_at)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── 投入 Tab ─────────────────────────────────────────────────────────────────

function MiniBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.max(2, pct)}%` }} />
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-slate-900/60 border border-slate-800/60 rounded p-4 flex flex-col gap-1">
      <div className="text-[11px] text-slate-500 uppercase tracking-[0.1em]">{label}</div>
      <div className="text-[22px] font-bold text-slate-200 font-mono leading-none">{value}</div>
      {sub && <div className="text-[11px] text-slate-600 mt-0.5">{sub}</div>}
    </div>
  );
}

function InvestmentTab({ detail }: { detail: LineDetail | null }) {
  const tasks = detail?.tasks ?? [];
  const total = tasks.length;

  const done = tasks.filter(t => t.status === 'done').length;
  const failed = tasks.filter(t => t.status === 'failed').length;
  const active = tasks.filter(t => t.status === 'active').length;
  const paused = tasks.filter(t => ['paused', 'blocked'].includes(t.raw_status ?? '')).length;

  const finished = done + failed;
  const successRate = finished > 0 ? Math.round((done / finished) * 100) : 0;

  const prCount = tasks.filter(t => t.pr_url || (t.pr_urls && t.pr_urls.length > 0)).length;

  const totalMs = tasks
    .filter(t => t.status === 'done' && (t.elapsed_ms ?? 0) > 0)
    .reduce((acc, t) => acc + (t.elapsed_ms ?? 0), 0);
  const hours = totalMs / 3_600_000;
  const hoursStr = hours >= 1 ? `${hours.toFixed(1)}h` : hours > 0 ? `${Math.round(hours * 60)}m` : '—';

  const sprints = tasks.filter(t => t.kind === 'sprint').length;
  const taskKind = tasks.filter(t => t.kind === 'task').length;
  const pipelines = tasks.filter(t => t.kind === 'pipeline').length;
  const scrapers = tasks.filter(t => t.kind === 'scraper').length;

  const ganTotal = tasks.reduce((s, t) => s + (t.gan_rounds ?? 0), 0);
  const fixTotal = tasks.reduce((s, t) => s + (t.fix_rounds ?? 0), 0);

  if (total === 0) {
    return <div className="p-8 text-center text-slate-600 text-[13px]">暂无执行数据</div>;
  }

  const kindRows = [
    { label: 'Sprint', count: sprints, color: 'bg-indigo-500' },
    { label: 'Task', count: taskKind, color: 'bg-blue-400' },
    ...(pipelines > 0 ? [{ label: 'Pipeline', count: pipelines, color: 'bg-cyan-500' }] : []),
    ...(scrapers > 0 ? [{ label: 'Scraper', count: scrapers, color: 'bg-teal-400' }] : []),
  ];

  return (
    <div className="p-5 flex flex-col gap-4">
      <div className="grid grid-cols-4 gap-3">
        <StatCard label="总 Runs" value={String(total)} sub={`跑中 ${active}`} />
        <StatCard label="成功率" value={`${successRate}%`} sub={`${done} 成 / ${failed} 败`} />
        <StatCard label="合并 PR" value={String(prCount)} sub={`覆盖 ${total > 0 ? Math.round(prCount / total * 100) : 0}%`} />
        <StatCard label="累计工时" value={hoursStr} sub={`完成 ${done} 条`} />
      </div>

      <div className="bg-slate-900/60 border border-slate-800/60 rounded p-4">
        <div className="text-[11px] text-slate-500 uppercase tracking-[0.1em] mb-3">角色分布</div>
        <div className="flex flex-col gap-2.5">
          {kindRows.map(({ label, count, color }) => (
            <div key={label} className="flex items-center gap-3">
              <span className="text-[12px] text-slate-400 w-16">{label}</span>
              <div className="flex-1"><MiniBar pct={total > 0 ? (count / total) * 100 : 0} color={color} /></div>
              <span className="text-[12px] font-mono text-slate-400 w-8 text-right">{count}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-slate-900/60 border border-slate-800/60 rounded p-4">
        <div className="text-[11px] text-slate-500 uppercase tracking-[0.1em] mb-3">状态分布</div>
        <div className="grid grid-cols-4 gap-2 text-center">
          {[
            { label: '已完成', count: done, color: 'text-emerald-400' },
            { label: '进行中', count: active, color: 'text-blue-400' },
            { label: '失败', count: failed, color: 'text-red-400' },
            { label: '暂停/阻塞', count: paused, color: 'text-amber-400' },
          ].map(({ label, count, color }) => (
            <div key={label} className="flex flex-col gap-0.5">
              <div className={`text-[18px] font-bold font-mono ${color}`}>{count}</div>
              <div className="text-[10px] text-slate-600">{label}</div>
            </div>
          ))}
        </div>
      </div>

      {(ganTotal > 0 || fixTotal > 0) && (
        <div className="bg-slate-900/60 border border-slate-800/60 rounded p-4">
          <div className="text-[11px] text-slate-500 uppercase tracking-[0.1em] mb-3">执行消耗（Sprint）</div>
          <div className="flex gap-8">
            <div>
              <div className="text-[18px] font-bold font-mono text-violet-400">{ganTotal}</div>
              <div className="text-[10px] text-slate-600">GAN 对抗轮</div>
            </div>
            <div>
              <div className="text-[18px] font-bold font-mono text-orange-400">{fixTotal}</div>
              <div className="text-[10px] text-slate-600">Fix 修复轮</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── 占位 Tab ─────────────────────────────────────────────────────────────────

function PlaceholderTab({ label, icon: Icon }: { label: string; icon: ComponentType<{ className?: string }> }) {
  return (
    <div className="p-12 flex flex-col items-center gap-4 text-center">
      <div className="w-12 h-12 rounded-full bg-slate-800/60 flex items-center justify-center">
        <Icon className="w-6 h-6 text-slate-600" />
      </div>
      <div>
        <div className="text-[15px] text-slate-400 font-semibold mb-1">{label}</div>
        <div className="text-[13px] text-slate-600">待建设</div>
      </div>
    </div>
  );
}

// ── 要素 Tab（Fix-1: 接真数据替换占位） ─────────────────────────────────────

function ElementsTab({ lineId }: { lineId: string }) {
  const [steps, setSteps] = useState<JourneyStep[]>([]);
  const [cells, setCells] = useState<StepCell[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedStep, setSelectedStep] = useState<JourneyStep | null>(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetch(`/api/brain/journey_steps?journey_id=${encodeURIComponent(lineId)}&limit=50`).then(r => r.json()),
      fetch(`/api/brain/journey_step_links?journey_id=${encodeURIComponent(lineId)}&cells=1&limit=500`).then(r => r.json()),
    ])
      .then(([stepsData, cellsData]) => {
        const arr: JourneyStep[] = Array.isArray(stepsData) ? stepsData : (stepsData?.items ?? []);
        setSteps(arr.sort((a, b) => a.step_number - b.step_number));
        const cellArr: StepCell[] = Array.isArray(cellsData) ? cellsData : (cellsData?.items ?? []);
        setCells(cellArr);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [lineId]);

  const cellsByStep = useMemo(() => {
    const map: Record<string, StepCell[]> = {};
    for (const cell of cells) {
      if (!map[cell.step_id]) map[cell.step_id] = [];
      map[cell.step_id].push(cell);
    }
    return map;
  }, [cells]);

  const elementKeys = useMemo(() => {
    const found = new Set<string>();
    for (const cell of cells) {
      if (cell.cell_kind === 'element') found.add(cell.cell_key);
    }
    return STANDARD_ELEMENT_KEYS.filter(k => found.has(k))
      .concat([...found].filter(k => !STANDARD_ELEMENT_KEYS.includes(k)));
  }, [cells]);

  const selectedStepCells = selectedStep ? (cellsByStep[selectedStep.id] ?? []) : [];

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-6 text-slate-600 text-sm">
        <div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        加载要素账本…
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0">
      {/* 左侧：Step × 要素矩阵 */}
      <div className={`flex flex-col min-h-0 overflow-hidden border-r border-slate-800/60 transition-all ${selectedStep ? 'w-[55%]' : 'w-full'}`}>
        <div className="flex items-center gap-3 px-5 py-2.5 border-b border-slate-800/40 bg-slate-900/30 flex-shrink-0 text-[11px]">
          <span className="text-slate-400 font-semibold tracking-[0.08em] uppercase">要素账本</span>
          {cells.length > 0 && (
            <>
              <span className="text-slate-700 mx-1">·</span>
              <span className="text-emerald-400 font-mono">{cells.filter(c => c.cell_status === 'green').length}</span>
              <span className="text-slate-600">/{cells.length} 格覆盖</span>
            </>
          )}
        </div>

        {/* 矩阵表头 */}
        <div className="flex-shrink-0 border-b border-slate-800/50 overflow-x-auto">
          <table className="w-full min-w-[480px] text-[11px] font-mono">
            <thead>
              <tr>
                <th className="text-left pl-5 pr-2 py-2 text-slate-600 font-semibold tracking-[0.08em] uppercase w-8">#</th>
                <th className="text-left pr-3 py-2 text-slate-600 font-semibold tracking-[0.08em] uppercase">步骤</th>
                <th className="text-center px-2 py-2 text-slate-600 font-semibold w-10" title="能力">能</th>
                {elementKeys.map(key => (
                  <th key={key} className="text-center px-1.5 py-2 text-slate-600 font-semibold w-10" title={key}>
                    {key.length > 4 ? key.slice(0, 3) + '…' : key}
                  </th>
                ))}
                <th className="text-center px-2 py-2 text-slate-600 font-semibold w-10" title="场景">景</th>
              </tr>
            </thead>
          </table>
        </div>

        {/* 矩阵内容 */}
        <div className="flex-1 overflow-y-auto">
          {steps.length === 0 ? (
            <div className="p-8 flex flex-col items-center gap-3 text-center">
              <LayoutGrid className="w-8 h-8 text-slate-700" />
              <div className="text-[13px] text-slate-600">本线暂无步骤账本</div>
              <div className="text-[11px] text-slate-700">账本模板铺入后自动出现</div>
              {elementKeys.length === 0 && (
                <div className="mt-2 text-[11px] text-slate-700">
                  要素轴：{STANDARD_ELEMENT_KEYS.slice(0, 3).join(' / ')} 等
                </div>
              )}
            </div>
          ) : (
            <table className="w-full min-w-[480px] text-[11px] font-mono">
              <tbody>
                {steps.map(step => {
                  const stepCells = cellsByStep[step.id] ?? [];
                  const capCells = stepCells.filter(c => c.cell_kind === 'capability');
                  const scnCells = stepCells.filter(c => c.cell_kind === 'scenario');
                  const isSelected = selectedStep?.id === step.id;
                  const stepDot = (STEP_STATUS_META[step.status] ?? STEP_STATUS_META.planned).dot;
                  const greenCap = capCells.filter(c => c.cell_status === 'green').length;
                  const greenScn = scnCells.filter(c => c.cell_status === 'green').length;

                  return (
                    <tr
                      key={step.id}
                      onClick={() => setSelectedStep(isSelected ? null : step)}
                      className={`border-b border-slate-800/30 cursor-pointer transition-colors ${
                        isSelected ? 'bg-indigo-500/10 border-indigo-500/20' : 'hover:bg-slate-800/20'
                      }`}
                    >
                      <td className="pl-5 pr-2 py-2.5 w-8">
                        <span className="text-slate-700 text-[10px]">{step.step_number}</span>
                      </td>
                      <td className="pr-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${stepDot} ${step.status === 'in_progress' ? 'wr-pulse' : ''}`} />
                          <span className={`text-[12px] ${isSelected ? 'text-indigo-200 font-semibold' : 'text-slate-200'} truncate`}>
                            {step.name}
                          </span>
                        </div>
                      </td>
                      <td className="text-center px-2 py-2.5 w-10">
                        {capCells.length > 0 ? (
                          <span className={`text-[10px] font-mono ${greenCap === capCells.length ? 'text-emerald-400' : greenCap > 0 ? 'text-amber-400' : 'text-slate-600'}`}>
                            {greenCap}/{capCells.length}
                          </span>
                        ) : <span className="text-slate-800">—</span>}
                      </td>
                      {elementKeys.map(key => {
                        const cell = stepCells.find(c => c.cell_kind === 'element' && c.cell_key === key);
                        if (!cell) return (
                          <td key={key} className="text-center px-1.5 py-2.5 w-10">
                            <span className="text-slate-800">—</span>
                          </td>
                        );
                        return (
                          <td key={key} className="text-center px-1.5 py-2.5 w-10">
                            <div className="flex justify-center">
                              <CellDot status={cell.cell_status} size="xs" />
                            </div>
                          </td>
                        );
                      })}
                      <td className="text-center px-2 py-2.5 w-10">
                        {scnCells.length > 0 ? (
                          <span className={`text-[10px] font-mono ${greenScn === scnCells.length ? 'text-emerald-400' : greenScn > 0 ? 'text-amber-400' : 'text-slate-600'}`}>
                            {greenScn}/{scnCells.length}
                          </span>
                        ) : <span className="text-slate-800">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* 图例 */}
        {steps.length > 0 && (
          <div className="flex-shrink-0 flex items-center gap-4 px-5 py-2 border-t border-slate-800/40 bg-slate-900/20 text-[10px]">
            <span className="text-slate-700">要素轴：FR / NFR / 判定点 / 不变量 / 失败语义 / 效果确认 / 两轴衔接</span>
          </div>
        )}
      </div>

      {/* 右侧：格子账本详情 */}
      {selectedStep && (
        <div className="flex flex-col min-h-0 overflow-hidden" style={{ width: '45%' }}>
          <StepLedgerPanel
            step={selectedStep}
            cells={selectedStepCells}
            onClose={() => setSelectedStep(null)}
          />
        </div>
      )}
    </div>
  );
}

// ── 主页面 ────────────────────────────────────────────────────────────────────

export default function StrategistLinePage() {
  const { lineId } = useParams<{ lineId: string }>();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const [detail, setDetail] = useState<LineDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const hasDetailRef = useRef(false);

  const fetchDetail = useCallback(async (silent = false) => {
    if (!lineId) return;
    try {
      if (!silent) setLoading(true);
      const res = await fetch(`/api/brain/warroom/line/${encodeURIComponent(lineId)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: LineDetail = await res.json();
      setDetail(data);
      hasDetailRef.current = true;
    } catch {
      if (!hasDetailRef.current) navigate('/strategist', { replace: true });
    } finally {
      setLoading(false);
    }
  }, [lineId, navigate]);

  useEffect(() => {
    fetchDetail();
    const poll = setInterval(() => fetchDetail(true), 15_000);
    return () => clearInterval(poll);
  }, [fetchDetail]);

  const line = detail?.line;
  const score = line ? healthScore(line as LineSummary) : 0;
  const meta = healthMeta(score);
  const matLabel = MATURITY_LABEL[line?.maturity ?? ''] ?? (line?.maturity ?? '');
  const running = (detail?.tasks ?? []).filter((t) => t.status === 'active').length;

  return (
    <div className="sl-root flex flex-col h-full bg-[#0a0e1a] text-slate-400 font-mono select-none">
      <style>{ST_STYLE}</style>

      {/* ── 顶栏 ── */}
      <div className="flex items-center h-9 px-4 border-b border-slate-800/80 bg-slate-900/60 flex-shrink-0 gap-3 text-xs">
        <button
          onClick={() => navigate('/strategist')}
          className="flex items-center gap-1 text-slate-500 hover:text-slate-300 transition-colors flex-shrink-0"
          title="返回线列表"
        >
          <ArrowLeft className="w-3 h-3" />
          <span className="text-indigo-400 font-semibold">军师台</span>
        </button>
        <span className="text-slate-700">/</span>
        <span className="text-slate-300 font-semibold truncate min-w-0">{line?.name ?? '线空间'}</span>
        {matLabel && (
          <span className="text-[11px] px-1.5 py-px rounded border border-slate-700 text-slate-500 flex-shrink-0">{matLabel}</span>
        )}
        {running > 0 && (
          <span className="text-[11px] font-mono px-1.5 py-px rounded bg-blue-500/15 text-blue-300 border border-blue-500/25 flex-shrink-0">
            {running} 跑
          </span>
        )}
        <div className="ml-auto flex items-center gap-3">
          <span className={`text-[13px] font-bold font-mono ${meta.text}`}>{score}</span>
          <button
            onClick={() => fetchDetail()}
            className="text-slate-600 hover:text-slate-300 transition-colors"
            title="刷新"
          >
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* ── 页签栏 ── */}
      <div className="flex items-center border-b border-slate-800/60 bg-slate-900/30 flex-shrink-0 px-4 overflow-x-auto">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1.5 px-3 py-2.5 text-[12px] font-semibold tracking-wide border-b-2 transition-colors whitespace-nowrap ${
                isActive
                  ? 'border-indigo-500 text-indigo-300'
                  : 'border-transparent text-slate-500 hover:text-slate-300 hover:border-slate-600'
              }`}
            >
              <Icon className="w-3 h-3" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* ── 内容区 ── */}
      <div className="flex-1 overflow-hidden bg-[#0a0e1a] flex flex-col">
        {activeTab === 'overview' && lineId && (
          <div className="flex-1 overflow-hidden flex">
            <OverviewTab detail={detail} lineId={lineId} />
          </div>
        )}
        {activeTab !== 'overview' && activeTab !== 'conversation' && (
          <div className="flex-1 overflow-y-auto">
            {activeTab === 'roadmap' && <RoadmapTab detail={detail} />}
            {activeTab === 'morning' && <MorningTab />}
            {activeTab === 'decision' && lineId && <DecisionTab lineId={lineId} />}
            {activeTab === 'elements' && lineId && <ElementsTab lineId={lineId} />}
            {activeTab === 'investment' && <InvestmentTab detail={detail} />}
          </div>
        )}
        {activeTab === 'conversation' && lineId && (
          <div className="flex-1 overflow-hidden p-4">
            <ConversationsPanel journeyId={lineId} />
          </div>
        )}
      </div>
    </div>
  );
}
