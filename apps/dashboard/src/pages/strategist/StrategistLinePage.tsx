/**
 * StrategistLinePage — 军师台线空间（七页签）
 *
 * 路由：/strategist/:lineId
 * 页签：全貌 | 规划 | 晨报 | 拍板 | 对话 | 要素 | 投入
 * 已落地：全貌/规划/晨报/拍板/对话/投入；要素待建
 */

import { Fragment, useEffect, useState, useCallback, useRef, type ComponentType } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, RefreshCw, MapPin, FileText,
  CheckSquare, MessageSquare, Layout, DollarSign,
  ChevronRight, Activity, CheckCircle2, Zap,
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

// ── GP 类型 ──────────────────────────────────────────────────────────────────

interface GoldenPath {
  id: string;
  title?: string | null;
  one_liner?: string | null;
  status?: string | null;
  approved_at?: string | null;
  journey_id?: string | null;
  created_at: string;
}

// GP 状态颜色映射
const GP_STATUS_META: Record<string, { dot: string; text: string; label: string }> = {
  candidate:    { dot: 'bg-slate-500',   text: 'text-slate-400',   label: '候选' },
  proposed:     { dot: 'bg-blue-400',    text: 'text-blue-300',    label: '提案' },
  converged:    { dot: 'bg-indigo-400',  text: 'text-indigo-300',  label: '收敛' },
  approved:     { dot: 'bg-emerald-500', text: 'text-emerald-400', label: '批准' },
  in_dev:       { dot: 'bg-amber-400 wr-pulse', text: 'text-amber-300', label: '开发中' },
  delivered:    { dot: 'bg-emerald-600', text: 'text-emerald-300', label: '已交付' },
  expired:      { dot: 'bg-slate-600',   text: 'text-slate-500',   label: '过期' },
  rejected:     { dot: 'bg-red-600',     text: 'text-red-400',     label: '否决' },
  blocked_gate: { dot: 'bg-red-500 wr-pulse', text: 'text-red-300', label: '门禁阻' },
  superseded:   { dot: 'bg-slate-700',   text: 'text-slate-600',   label: '已超越' },
};

// GP 合同要素列
const GP_CONTRACT_COLS = [
  { key: 'fr_summary',                 label: 'FR',   tip: '功能定义' },
  { key: 'lifelines_and_nfr',          label: 'NFR',  tip: '生命线/非功能' },
  { key: 'yield_order',                label: '优先', tip: '优先序' },
  { key: 'release_and_blast_radius',   label: '投产', tip: '投产/爆炸半径' },
  { key: 'success_and_close',          label: '成功', tip: '成功关闭条件' },
  { key: 'budget_guard',               label: '预算', tip: '预算守护' },
] as const;

// ── 全貌 Tab（Line总览表：GP × 要素矩阵） ────────────────────────────────────

function OverviewTab({ detail, lineId }: { detail: LineDetail | null; lineId: string }) {
  const navigate = useNavigate();
  const [gps, setGps] = useState<GoldenPath[]>([]);
  const [gpLoading, setGpLoading] = useState(true);
  const [selectedGp, setSelectedGp] = useState<GoldenPath | null>(null);
  const [contracts, setContracts] = useState<any[]>([]);
  const [contractLoading, setContractLoading] = useState(false);

  useEffect(() => {
    setGpLoading(true);
    fetch(`/api/brain/golden-paths?journey_id=${encodeURIComponent(lineId)}`)
      .then((r) => r.json())
      .then((d) => {
        const all: GoldenPath[] = d.golden_paths || [];
        // 客户端过滤兜底（backend journey_id filter 需重启后生效）
        setGps(all.filter((gp) => gp.journey_id === lineId));
      })
      .catch(() => setGps([]))
      .finally(() => setGpLoading(false));
  }, [lineId]);

  const selectGp = useCallback(async (gp: GoldenPath) => {
    setSelectedGp(gp);
    setContracts([]);
    setContractLoading(true);
    try {
      const r = await fetch(`/api/brain/golden-paths/${encodeURIComponent(gp.id)}/contracts`);
      const d = await r.json();
      setContracts(d.contract_versions || []);
    } catch { /* 静默 */ } finally {
      setContractLoading(false);
    }
  }, []);

  if (!detail) return <div className="p-6 text-slate-600 text-sm">线数据加载中…</div>;

  const { line, tasks } = detail;
  const safeTasks = Array.isArray(tasks) ? tasks : [];
  const active = safeTasks.filter((t) => t.status === 'active');
  const score = healthScore(line as LineSummary);
  const meta = healthMeta(score);

  return (
    <div className="flex h-full min-h-0">
      {/* ── 左侧：GP 矩阵表 ── */}
      <div className={`flex flex-col min-h-0 overflow-hidden border-r border-slate-800/60 ${selectedGp ? 'w-[58%]' : 'w-full'}`}>
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
        </div>

        {/* GP 矩阵表头 */}
        <div className="flex-shrink-0 overflow-x-auto">
          <table className="w-full min-w-[520px] text-[11px] font-mono">
            <thead>
              <tr className="border-b border-slate-800/60">
                <th className="text-left pl-5 pr-3 py-2 text-slate-600 font-semibold tracking-[0.08em] uppercase w-[40%]">Golden Path</th>
                <th className="text-center px-2 py-2 text-slate-600 font-semibold tracking-[0.08em] uppercase w-14">状态</th>
                {GP_CONTRACT_COLS.map((col) => (
                  <th key={col.key} title={col.tip} className="text-center px-2 py-2 text-slate-600 font-semibold tracking-[0.08em] uppercase w-10">
                    {col.label}
                  </th>
                ))}
                <th className="text-center px-3 py-2 text-slate-600 font-semibold tracking-[0.08em] uppercase w-10">版本</th>
              </tr>
            </thead>
          </table>
        </div>

        {/* GP 矩阵内容 */}
        <div className="flex-1 overflow-y-auto">
          {gpLoading ? (
            <div className="flex items-center gap-2 p-6 text-slate-600 text-sm">
              <div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
              加载 Golden Paths…
            </div>
          ) : gps.length === 0 ? (
            <div className="p-8 flex flex-col items-center gap-3 text-center">
              <Zap className="w-8 h-8 text-slate-700" />
              <div className="text-[13px] text-slate-600">本线暂无 Golden Path</div>
              <div className="text-[11px] text-slate-700">由军师调度后自动出现</div>
            </div>
          ) : (
            <table className="w-full min-w-[520px] text-[11px] font-mono">
              <tbody>
                {gps.map((gp) => {
                  const sm = GP_STATUS_META[gp.status ?? ''] ?? { dot: 'bg-slate-600', text: 'text-slate-500', label: gp.status ?? '?' };
                  const isSelected = selectedGp?.id === gp.id;
                  return (
                    <tr
                      key={gp.id}
                      onClick={() => selectGp(gp)}
                      className={`border-b border-slate-800/30 cursor-pointer transition-colors ${
                        isSelected ? 'bg-indigo-500/10 border-indigo-500/20' : 'hover:bg-slate-800/20'
                      }`}
                    >
                      {/* GP 名称 */}
                      <td className="pl-5 pr-3 py-2.5 w-[40%]">
                        <div className="flex items-start gap-2">
                          <Zap className="w-3 h-3 text-amber-500/70 flex-shrink-0 mt-0.5" />
                          <div className="min-w-0">
                            <div className="text-slate-200 text-[12px] truncate leading-snug">{gp.title || gp.id.slice(0, 8)}</div>
                            {gp.one_liner && !isSelected && (
                              <div className="text-slate-600 text-[10px] truncate mt-0.5">{gp.one_liner}</div>
                            )}
                          </div>
                        </div>
                      </td>
                      {/* 状态 */}
                      <td className="text-center px-2 py-2.5 w-14">
                        <div className="flex items-center justify-center gap-1">
                          <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${sm.dot}`} />
                          <span className={`text-[10px] ${sm.text}`}>{sm.label}</span>
                        </div>
                      </td>
                      {/* 合同要素格（暂无合同时显示 —） */}
                      {GP_CONTRACT_COLS.map((col) => (
                        <td key={col.key} className="text-center px-2 py-2.5 w-10">
                          <span className="text-slate-700">—</span>
                        </td>
                      ))}
                      {/* 合同版本数 */}
                      <td className="text-center px-3 py-2.5 w-10">
                        <span className="text-slate-600">—</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* 底部跳转 */}
        {selectedGp && (
          <div className="flex-shrink-0 px-5 py-2 border-t border-slate-800/40 bg-slate-900/20">
            <button
              onClick={() => navigate(`/warroom/gp/${selectedGp.id}`)}
              className="flex items-center gap-1.5 text-[11px] text-indigo-400 hover:text-indigo-300 transition-colors"
            >
              <span>在 GP 详情页打开</span>
              <ChevronRight className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>

      {/* ── 右侧：GP 详情面板 ── */}
      {selectedGp && (
        <div className="flex flex-col min-h-0 overflow-hidden" style={{ width: '42%' }}>
          {/* GP 详情头 */}
          <div className="flex items-start gap-3 px-4 py-3 border-b border-slate-800/60 bg-slate-900/30 flex-shrink-0">
            <Zap className="w-3.5 h-3.5 text-amber-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="text-[13px] text-slate-100 font-semibold leading-snug truncate">
                {selectedGp.title || selectedGp.id.slice(0, 8)}
              </div>
              {selectedGp.one_liner && (
                <div className="text-[11px] text-slate-500 mt-0.5 line-clamp-2 leading-relaxed">{selectedGp.one_liner}</div>
              )}
            </div>
          </div>

          {/* 版本对比表 */}
          <div className="flex-1 overflow-y-auto">
            <GpContractVersionTable
              contracts={contracts}
              loading={contractLoading}
              gpId={selectedGp.id}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ── GP 合同版本对比表 ─────────────────────────────────────────────────────────

const CONTRACT_ROW_LABELS: Record<string, { label: string; short: string }> = {
  fr_summary:                 { label: '功能定义 (FR)',   short: 'FR' },
  lifelines_and_nfr:          { label: '生命线 / NFR',   short: 'NFR' },
  yield_order:                { label: '优先序',          short: '优先' },
  external_commitment_changes:{ label: '外部承诺变化',   short: '外承' },
  release_and_blast_radius:   { label: '投产 / 爆炸半径', short: '投产' },
  success_and_close:          { label: '成功关闭条件',   short: '成功' },
  budget_guard:               { label: '预算守护',        short: '预算' },
};

const CONTRACT_KEYS = Object.keys(CONTRACT_ROW_LABELS);

function summarizeSection(key: string, val: any): string {
  if (!val || typeof val !== 'object') return '—';
  if (key === 'fr_summary') return `${(val.statements || []).length} 条声明`;
  if (key === 'lifelines_and_nfr') return `${(val.items || []).length} 项`;
  if (key === 'yield_order') return (val.order || []).slice(0, 2).join('→') + (val.order?.length > 2 ? '…' : '');
  if (key === 'external_commitment_changes') return val.none ? '无变化' : `${(val.changes || []).length} 项变化`;
  if (key === 'release_and_blast_radius') return `${(val.stages || []).length} 阶段`;
  if (key === 'success_and_close') return `${(val.metrics || []).length} 指标`;
  if (key === 'budget_guard') return `$${val.total_cost_cap_usd ?? '?'}`;
  return '有';
}

function hashSection(val: any): string {
  return JSON.stringify(val ?? null);
}

interface ContractRowDetail {
  key: string;
  label: string;
  versions: Array<{ versionNum: number; summary: string; raw: any; changed: boolean }>;
}

function GpContractVersionTable({
  contracts,
  loading,
  gpId,
}: {
  contracts: any[];
  loading: boolean;
  gpId: string;
}) {
  const navigate = useNavigate();
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-6 text-slate-600 text-sm">
        <div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        加载合同版本…
      </div>
    );
  }

  if (contracts.length === 0) {
    return (
      <div className="p-6 flex flex-col items-center gap-3 text-center">
        <div className="w-10 h-10 rounded-full bg-slate-800/60 flex items-center justify-center">
          <FileText className="w-5 h-5 text-slate-600" />
        </div>
        <div className="text-[13px] text-slate-500">暂无合同记录</div>
        <div className="text-[11px] text-slate-700">GP 批准后自动生成合同版本</div>
        <button
          onClick={() => navigate(`/warroom/gp/${gpId}`)}
          className="mt-2 text-[11px] text-indigo-400 hover:text-indigo-300 flex items-center gap-1 transition-colors"
        >
          查看 GP 详情 <ChevronRight className="w-3 h-3" />
        </button>
      </div>
    );
  }

  // 按版本号升序排列（旧→新）
  const sorted = [...contracts].sort((a, b) => a.version - b.version);

  // 构建版本对比行
  const rows: ContractRowDetail[] = CONTRACT_KEYS.map((key) => {
    const versions = sorted.map((cv, idx) => {
      const val = cv.contract_json?.[key];
      const prevVal = idx > 0 ? sorted[idx - 1].contract_json?.[key] : undefined;
      const changed = idx > 0 && hashSection(val) !== hashSection(prevVal);
      return {
        versionNum: cv.version,
        summary: summarizeSection(key, val),
        raw: val,
        changed,
      };
    });
    return { key, label: CONTRACT_ROW_LABELS[key]?.label ?? key, versions };
  });

  return (
    <div className="p-0">
      {/* 标题栏 */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-800/40 bg-slate-900/20">
        <span className="text-[11px] tracking-[0.1em] uppercase text-slate-500 font-semibold">版本对比</span>
        <span className="text-[11px] text-slate-700">{contracts.length} 个版本</span>
      </div>

      {/* 对比表 */}
      <div className="overflow-x-auto">
        <table className="w-full text-[11px] font-mono">
          <thead>
            <tr className="border-b border-slate-800/40">
              <th className="text-left pl-4 pr-2 py-2 text-slate-600 font-semibold tracking-[0.08em] uppercase w-24">要素</th>
              {sorted.map((cv) => (
                <th key={cv.version} className="text-center px-2 py-2 text-slate-600 font-semibold tracking-[0.08em] w-20">
                  <div>v{cv.version}</div>
                  <div className="text-[9px] text-slate-700 font-normal mt-0.5">{fmtDate(cv.created_at)}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const isExpanded = expandedRow === row.key;
              return (
                <Fragment key={row.key}>
                  <tr
                    onClick={() => setExpandedRow(isExpanded ? null : row.key)}
                    className="border-b border-slate-800/20 cursor-pointer hover:bg-slate-800/20 transition-colors"
                  >
                    <td className="pl-4 pr-2 py-2 text-slate-400">{row.label}</td>
                    {row.versions.map((v) => (
                      <td
                        key={v.versionNum}
                        className={`text-center px-2 py-2 ${
                          v.changed ? 'bg-purple-900/30 text-purple-300' : 'text-slate-500'
                        }`}
                        title={v.changed ? '相比上一版本有变化' : undefined}
                      >
                        <span className={v.changed ? 'font-semibold' : ''}>{v.summary}</span>
                        {v.changed && <span className="ml-1 text-[9px] text-purple-400">↑</span>}
                      </td>
                    ))}
                  </tr>
                  {isExpanded && (
                    <tr className="border-b border-slate-800/20">
                      <td colSpan={sorted.length + 1} className="px-4 pb-3 pt-1">
                        <div className="flex gap-3 overflow-x-auto">
                          {row.versions.map((v) => (
                            <div
                              key={v.versionNum}
                              className={`flex-shrink-0 w-52 rounded border p-2 ${
                                v.changed ? 'border-purple-700/40 bg-purple-900/15' : 'border-slate-800/40 bg-slate-900/20'
                              }`}
                            >
                              <div className="text-[10px] text-slate-600 mb-1">v{v.versionNum}</div>
                              <pre className="text-[10px] text-slate-400 whitespace-pre-wrap break-words max-h-32 overflow-y-auto leading-relaxed">
                                {JSON.stringify(v.raw, null, 2)}
                              </pre>
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
// ── end GpContractVersionTable ────────────────────────────────────────────────

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
                    <span className="text-[13px] text-slate-200 flex-1 min-w-0">{t.title}</span>
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
        <div className="text-[13px] text-slate-600">建设中，敬请期待</div>
      </div>
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
            {activeTab === 'elements' && <PlaceholderTab label="要素" icon={Activity} />}
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
