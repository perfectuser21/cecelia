/**
 * StrategistLinePage — 军师台线空间（七页签）
 *
 * 路由：/strategist/:lineId
 * 页签：全貌 | 规划 | 晨报 | 拍板 | 对话 | 要素 | 投入
 * 晨报/拍板/对话三页先通，其余待建
 */

import { useEffect, useState, useCallback, useRef, type ComponentType } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, RefreshCw, MapPin, FileText,
  CheckSquare, MessageSquare, Layout, DollarSign,
  ChevronRight, Activity, CheckCircle2,
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

// ── 全貌 Tab ─────────────────────────────────────────────────────────────────

function OverviewTab({ detail }: { detail: LineDetail | null }) {
  if (!detail) return <div className="p-6 text-slate-600 text-sm">线数据加载中…</div>;
  const { line, tasks } = detail;
  const safeTasks = Array.isArray(tasks) ? tasks : [];
  const active = safeTasks.filter((t) => t.status === 'active');
  const done = safeTasks.filter((t) => t.raw_status === 'completed' || t.status === 'done');
  const failed = safeTasks.filter((t) => t.status === 'failed');
  const score = healthScore(line as LineSummary);
  const meta = healthMeta(score);

  return (
    <div className="p-6 max-w-2xl space-y-6">
      {/* 基本信息 */}
      <div className="rounded-lg border border-slate-800/60 bg-slate-900/20 p-4 space-y-3">
        <div className="text-[11px] tracking-[0.12em] uppercase text-slate-500 font-bold mb-2">线档案</div>
        <div className="flex items-center justify-between text-[13px]">
          <span className="text-slate-600">状态</span>
          <span className="text-slate-300">{line.status || '--'}</span>
        </div>
        <div className="flex items-center justify-between text-[13px]">
          <span className="text-slate-600">成熟度</span>
          <span className="text-slate-300">{MATURITY_LABEL[line.maturity ?? ''] ?? (line.maturity ?? '--')}</span>
        </div>
        <div className="flex items-center justify-between text-[13px]">
          <span className="text-slate-600">所属域</span>
          <span className="text-slate-300">{line.areaName || '--'}</span>
        </div>
        {line.description && (
          <p className="text-[13px] text-slate-400 leading-relaxed pt-1 border-t border-slate-800/50">
            {line.description}
          </p>
        )}
      </div>

      {/* 健康分 */}
      <div className="rounded-lg border border-slate-800/60 bg-slate-900/20 p-4">
        <div className="text-[11px] tracking-[0.12em] uppercase text-slate-500 font-bold mb-3">健康分</div>
        <div className="flex items-center gap-4">
          <span className={`text-[36px] font-bold font-mono ${meta.text}`}>{score}</span>
          <div className="flex-1">
            <div className="h-2 rounded-full bg-slate-800 overflow-hidden mb-1">
              <div
                className={`h-full rounded-full ${
                  score >= 70 ? 'bg-emerald-500' : score >= 40 ? 'bg-amber-400' : 'bg-red-500'
                }`}
                style={{ width: `${score}%` }}
              />
            </div>
            <div className="text-[11px] text-slate-600">规划进度 60% + 成熟度 40%</div>
          </div>
        </div>
      </div>

      {/* 任务统计 */}
      <div className="rounded-lg border border-slate-800/60 bg-slate-900/20 p-4">
        <div className="text-[11px] tracking-[0.12em] uppercase text-slate-500 font-bold mb-3">任务快照</div>
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: '进行中', count: active.length, color: 'text-blue-400', dot: 'bg-blue-400' },
            { label: '已完成', count: done.length, color: 'text-emerald-400', dot: 'bg-emerald-500' },
            { label: '失败', count: failed.length, color: 'text-red-400', dot: 'bg-red-500' },
          ].map((s) => (
            <div key={s.label} className="text-center">
              <div className={`text-[28px] font-bold font-mono ${s.color}`}>{s.count}</div>
              <div className="text-[11px] text-slate-600">{s.label}</div>
            </div>
          ))}
        </div>
      </div>
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
        const res = await fetch('/api/brain/design-docs?type=diary&limit=14');
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
      <div className="flex-1 overflow-y-auto bg-[#0a0e1a]">
        {activeTab === 'overview' && <OverviewTab detail={detail} />}
        {activeTab === 'roadmap' && <RoadmapTab detail={detail} />}
        {activeTab === 'morning' && <MorningTab />}
        {activeTab === 'decision' && lineId && <DecisionTab lineId={lineId} />}
        {activeTab === 'conversation' && lineId && (
          <div className="h-full p-4">
            <ConversationsPanel journeyId={lineId} />
          </div>
        )}
        {activeTab === 'elements' && <PlaceholderTab label="要素" icon={Activity} />}
        {activeTab === 'investment' && <PlaceholderTab label="投入" icon={DollarSign} />}
      </div>
    </div>
  );
}
