import { useState, useEffect, useCallback } from 'react';

interface Capture {
  id: string;
  content: string;
  source: string;
  nature: string | null;
  repo: string | null;
  lane: string | null;
  ref_task_id: string | null;
  ref_pr_url: string | null;
  dedupe_key: string | null;
  status: string;
  dest_type: string | null;
  dest_id: string | null;
  created_at: string;
  updated_at: string;
}

interface CaptureAtom {
  id: string;
  content: string;
  target_type: string;
  target_subtype: string | null;
  status: string;
  ai_reason: string | null;
  routed_to_table: string | null;
  routed_to_id: string | null;
  confidence: number | null;
  retry_count: number;
  created_at: string;
}

interface CaptureDetail extends Capture {
  atoms: CaptureAtom[];
  backlinks: Array<{ table: string; id: string; summary: string }>;
}

interface CountsByStage {
  captured: number;
  clarified: number;
  done: number;
  dropped: number;
}

const STAGES = ['captured', 'clarified', 'parked', 'done', 'dropped'] as const;
type Stage = typeof STAGES[number];

const STAGE_LABELS: Record<string, string> = {
  captured: '待分类',
  clarified: '已分类',
  parked: '暂停',
  done: '已完成',
  dropped: '已丢弃',
};

const STAGE_COLORS: Record<string, string> = {
  captured: 'bg-blue-500',
  clarified: 'bg-green-500',
  parked: 'bg-amber-500',
  done: 'bg-slate-500',
  dropped: 'bg-red-500',
};

function isOverdue(c: Capture) {
  if (['done', 'dropped'].includes(c.status)) return false;
  const days = (Date.now() - new Date(c.created_at).getTime()) / (1000 * 60 * 60 * 24);
  return days > 7;
}

function formatAge(created_at: string) {
  const days = Math.floor((Date.now() - new Date(created_at).getTime()) / (1000 * 60 * 60 * 24));
  if (days === 0) return '今天';
  if (days === 1) return '1天前';
  return `${days}天前`;
}

export default function InboxPage() {
  const [counts, setCounts] = useState<CountsByStage>({ captured: 0, clarified: 0, done: 0, dropped: 0 });
  const [items, setItems] = useState<Capture[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selectedStage, setSelectedStage] = useState<string | null>(null);
  const [selectedNature, setSelectedNature] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<CaptureDetail | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [page, setPage] = useState(0);

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '50', offset: String(page * 50) });
      if (selectedStage && selectedStage !== 'parked') params.set('stage', selectedStage);
      if (selectedNature) params.set('nature', selectedNature);
      const resp = await fetch(`/api/brain/captures?${params}`);
      const data = await resp.json();
      setItems(data.items || []);
      setTotal(data.total || 0);
      setCounts(data.counts_by_stage || { captured: 0, clarified: 0, done: 0, dropped: 0 });
    } catch (err) {
      console.error('[InboxPage] fetch failed', err);
    } finally {
      setLoading(false);
    }
  }, [selectedStage, selectedNature, page]);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  const openDetail = async (id: string) => {
    try {
      const resp = await fetch(`/api/brain/captures/${id}`);
      const data = await resp.json();
      setSelectedItem(data);
      setDrawerOpen(true);
    } catch (err) {
      console.error('[InboxPage] detail fetch failed', err);
    }
  };

  const handleReroute = async (atomId: string, nature: string) => {
    await fetch(`/api/brain/capture-atoms/${atomId}/confirm`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reroute', nature }),
    });
    if (selectedItem) openDetail(selectedItem.id);
  };

  const handleDrop = async (atomId: string) => {
    await fetch(`/api/brain/capture-atoms/${atomId}/confirm`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'drop' }),
    });
    if (selectedItem) openDetail(selectedItem.id);
  };

  const handleRetry = async (atomId: string) => {
    await fetch(`/api/brain/capture-atoms/${atomId}/retry`, { method: 'POST' });
    if (selectedItem) openDetail(selectedItem.id);
  };

  // parked atom 数（从 items 中取 status=parked 的条目聚合）
  const parkedCount = items.filter(i => i.status === 'parked').length;

  return (
    <div className="flex h-full overflow-hidden">
      {/* 主内容 */}
      <div className={`flex-1 flex flex-col overflow-hidden ${drawerOpen ? 'mr-96' : ''}`}>
        {/* 页头 */}
        <div className="p-6 border-b border-slate-200 dark:border-slate-700">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">收件箱</h1>
          <p className="text-sm text-slate-500 mt-1">统一进箱管道 — 全部 capture 条目</p>
        </div>

        {/* 漏斗计数条 */}
        <div className="px-6 py-4 flex gap-3 overflow-x-auto">
          {STAGES.map(stage => {
            const count = stage === 'parked' ? parkedCount : (counts as any)[stage] ?? 0;
            return (
              <button
                key={stage}
                onClick={() => setSelectedStage(selectedStage === stage ? null : stage)}
                className={`flex-shrink-0 flex flex-col items-center px-4 py-3 rounded-xl border-2 transition-all ${
                  selectedStage === stage
                    ? 'border-slate-700 dark:border-slate-300 shadow-lg scale-105'
                    : 'border-slate-200 dark:border-slate-700 hover:border-slate-400'
                } bg-white dark:bg-slate-800`}
              >
                <span className={`text-2xl font-bold ${selectedStage === stage ? 'text-slate-900 dark:text-white' : 'text-slate-600 dark:text-slate-300'}`} data-testid="stage-count">
                  {count}
                </span>
                <span className={`text-xs mt-1 font-medium px-2 py-0.5 rounded-full text-white ${STAGE_COLORS[stage]}`}>
                  {stage}
                </span>
                <span className="text-xs text-slate-500 mt-0.5">{STAGE_LABELS[stage]}</span>
              </button>
            );
          })}
        </div>

        {/* 筛选栏 */}
        <div className="px-6 py-2 flex gap-2 flex-wrap">
          {['learning', 'issue', 'handoff'].map(n => (
            <button
              key={n}
              onClick={() => setSelectedNature(selectedNature === n ? null : n)}
              className={`text-xs px-3 py-1 rounded-full border transition-all ${
                selectedNature === n
                  ? 'bg-slate-700 text-white border-slate-700'
                  : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-300 dark:border-slate-600 hover:border-slate-500'
              }`}
            >
              {n}
            </button>
          ))}
          {(selectedStage || selectedNature) && (
            <button
              onClick={() => { setSelectedStage(null); setSelectedNature(null); }}
              className="text-xs px-3 py-1 rounded-full border border-red-300 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
            >
              清除筛选
            </button>
          )}
        </div>

        {/* 列表 */}
        <div className="flex-1 overflow-y-auto px-6 pb-6">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-slate-400">加载中...</div>
          ) : items.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-slate-400">暂无条目</div>
          ) : (
            <div className="space-y-2">
              {items.map(item => {
                const overdue = isOverdue(item);
                return (
                  <div
                    key={item.id}
                    data-testid="capture-row"
                    onClick={() => openDetail(item.id)}
                    className={`p-4 rounded-lg border cursor-pointer transition-all hover:shadow-md ${
                      overdue
                        ? 'bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-800'
                        : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:border-slate-400'
                    }`}
                    style={overdue ? { borderColor: '#ef4444' } : {}}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-slate-900 dark:text-white line-clamp-2">
                          {overdue && <span className="inline-block mr-1" style={{ color: '#f59e0b' }}>⚠</span>}
                          {item.content}
                        </p>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          {item.nature && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">
                              {item.nature}
                            </span>
                          )}
                          <span className="text-xs text-slate-400">{item.source}</span>
                          <span className="text-xs text-slate-400">{formatAge(item.created_at)}</span>
                          {overdue && <span className="text-xs text-red-500 font-medium">超期</span>}
                        </div>
                      </div>
                      <span className={`flex-shrink-0 text-xs px-2 py-1 rounded-full text-white ${STAGE_COLORS[item.status] || 'bg-slate-400'}`}>
                        {item.status}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* 分页 */}
          {total > 50 && (
            <div className="flex justify-center gap-3 mt-6">
              <button disabled={page === 0} onClick={() => setPage(p => p - 1)} className="px-4 py-2 text-sm rounded-lg border disabled:opacity-40">上一页</button>
              <span className="py-2 text-sm text-slate-500">{page + 1} / {Math.ceil(total / 50)}</span>
              <button disabled={(page + 1) * 50 >= total} onClick={() => setPage(p => p + 1)} className="px-4 py-2 text-sm rounded-lg border disabled:opacity-40">下一页</button>
            </div>
          )}
        </div>
      </div>

      {/* 详情抽屉 */}
      {drawerOpen && selectedItem && (
        <div className="fixed right-0 top-16 bottom-0 w-96 bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-700 overflow-y-auto z-30 shadow-2xl">
          <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center">
            <h2 className="font-semibold text-slate-900 dark:text-white text-sm">详情</h2>
            <button onClick={() => setDrawerOpen(false)} className="text-slate-400 hover:text-slate-700 dark:hover:text-white text-lg">✕</button>
          </div>

          <div className="p-4 space-y-4">
            {/* 信封元数据 */}
            <div className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">信封</h3>
              <div className="text-sm text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-800 rounded-lg p-3">
                <p className="line-clamp-4">{selectedItem.content}</p>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs text-slate-500">
                {selectedItem.nature && <div><span className="font-medium">nature:</span> {selectedItem.nature}</div>}
                {selectedItem.repo && <div><span className="font-medium">repo:</span> {selectedItem.repo}</div>}
                {selectedItem.lane && <div><span className="font-medium">lane:</span> {selectedItem.lane}</div>}
                {selectedItem.ref_task_id && <div><span className="font-medium">task:</span> {selectedItem.ref_task_id.slice(0, 8)}...</div>}
                {selectedItem.ref_pr_url && <div className="col-span-2"><span className="font-medium">PR:</span> <a href={selectedItem.ref_pr_url} className="text-blue-500 hover:underline" target="_blank" rel="noreferrer">{selectedItem.ref_pr_url}</a></div>}
                <div><span className="font-medium">状态:</span> {selectedItem.status}</div>
                <div><span className="font-medium">来源:</span> {selectedItem.source}</div>
              </div>
              {/* 去向链接 */}
              {selectedItem.dest_type && selectedItem.dest_id && (
                <div className="mt-2 pt-2 border-t border-slate-100 dark:border-slate-700">
                  <span className="text-xs font-medium text-slate-500">去向:</span>
                  {selectedItem.dest_type === 'task' ? (
                    <a href={`/tasks/${selectedItem.dest_id}`} className="ml-1 text-xs text-blue-500 hover:underline">
                      [{selectedItem.dest_type}] {selectedItem.dest_id.slice(0, 8)}... →
                    </a>
                  ) : selectedItem.dest_type === 'initiative' ? (
                    <a href={`/initiatives/${selectedItem.dest_id}`} className="ml-1 text-xs text-blue-500 hover:underline">
                      [{selectedItem.dest_type}] {selectedItem.dest_id.slice(0, 8)}... →
                    </a>
                  ) : selectedItem.dest_type === 'project' ? (
                    <a href={`/projects/${selectedItem.dest_id}`} className="ml-1 text-xs text-blue-500 hover:underline">
                      [{selectedItem.dest_type}] {selectedItem.dest_id.slice(0, 8)}... →
                    </a>
                  ) : (
                    <span className="ml-1 text-xs text-slate-500">[{selectedItem.dest_type}] {selectedItem.dest_id.slice(0, 8)}...</span>
                  )}
                </div>
              )}
            </div>

            {/* Atoms */}
            {selectedItem.atoms && selectedItem.atoms.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">atoms ({selectedItem.atoms.length})</h3>
                {selectedItem.atoms.map(atom => (
                  <div
                    key={atom.id}
                    className={`rounded-lg p-3 text-xs space-y-1 border ${
                      atom.status === 'parked'
                        ? 'bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800'
                        : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700'
                    }`}
                  >
                    <div className="flex justify-between">
                      <span className="font-medium text-slate-700 dark:text-slate-300">{atom.target_type}{atom.target_subtype ? `/${atom.target_subtype}` : ''}</span>
                      <span className={`px-1.5 py-0.5 rounded text-white text-xs ${STAGE_COLORS[atom.status] || 'bg-slate-400'}`}>{atom.status}</span>
                    </div>
                    {atom.ai_reason && (
                      <p className="text-slate-500 break-all">{atom.ai_reason}</p>
                    )}
                    {atom.routed_to_table && (
                      <p className="text-green-600 dark:text-green-400">
                        → {atom.routed_to_table}
                        {atom.routed_to_table === 'tasks' && atom.routed_to_id && (
                          <a href={`/tasks/${atom.routed_to_id}`} className="ml-1 text-blue-500 hover:underline">[跳转]</a>
                        )}
                      </p>
                    )}
                    {/* parked 条目改判交互 */}
                    {atom.status === 'parked' && (
                      <div className="flex flex-wrap gap-1 mt-2 pt-2 border-t border-amber-200 dark:border-amber-700">
                        <select
                          className="text-xs px-2 py-1 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200"
                          defaultValue=""
                          onChange={e => e.target.value && handleReroute(atom.id, e.target.value)}
                        >
                          <option value="">改判 nature...</option>
                          <option value="learning">learning</option>
                          <option value="issue">issue</option>
                          <option value="handoff">handoff</option>
                        </select>
                        <button onClick={() => handleDrop(atom.id)} className="text-xs px-2 py-1 rounded border border-red-300 text-red-600 hover:bg-red-50">丢弃</button>
                        {atom.ai_reason?.includes('[triage:llm_failed') && (
                          <button onClick={() => handleRetry(atom.id)} className="text-xs px-2 py-1 rounded border border-blue-300 text-blue-600 hover:bg-blue-50">重试</button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* 回链 */}
            {selectedItem.backlinks && selectedItem.backlinks.length > 0 && (
              <div className="space-y-1">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">回链</h3>
                {selectedItem.backlinks.map((bl, i) => (
                  <div key={i} className="text-xs text-slate-500">
                    {bl.table}/{bl.id?.slice(0, 8)}... — {bl.summary}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
