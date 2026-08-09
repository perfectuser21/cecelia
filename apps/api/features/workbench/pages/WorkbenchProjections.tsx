import { useCallback, useEffect, useState } from 'react';
import { Database, RefreshCcw, RotateCcw } from 'lucide-react';

interface CountRow { target: string; status?: string; entity_type?: string; count: number }
interface TargetRow { target: string; enabled: boolean; task_database_ready: boolean; project_database_ready: boolean; last_error: string | null }
interface ProjectionStatus { outbox: CountRow[]; links: CountRow[]; commands: CountRow[]; targets: TargetRow[]; credentials: { notion_token: boolean } }

export default function WorkbenchProjections() {
  const [status, setStatus] = useState<ProjectionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    setLoading(true);
    try { const response = await fetch('/api/brain/projections/status'); if (!response.ok) throw new Error(`HTTP ${response.status}`); setStatus(await response.json()); }
    finally { setLoading(false); }
  }, []);
  const requeue = async () => { await fetch('/api/brain/projections/requeue', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target: 'notion' }) }); await refresh(); };
  useEffect(() => { refresh(); }, [refresh]);
  const target = status?.targets.find(item => item.target === 'notion');
  const sum = (rows: CountRow[], key: string) => rows.filter(row => row.status === key).reduce((total, row) => total + Number(row.count), 0);
  const linked = status?.links.reduce((total, row) => total + Number(row.count), 0) ?? 0;

  return (
    <div className="h-full overflow-auto bg-slate-950 p-5 text-slate-200">
      <div className="mb-5 flex items-center gap-2"><RefreshCcw className="h-5 w-5 text-cyan-400" /><h1 className="text-lg font-semibold">Projections</h1><button onClick={refresh} className="ml-auto rounded-lg p-2 text-slate-400 hover:bg-slate-800" title="刷新"><RotateCcw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></button></div>
      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-5"><div className="mb-4 flex items-center gap-2"><Database className="h-4 w-4 text-cyan-400" /><h2 className="font-medium">Notion · CCAPI2026</h2></div><div className="grid grid-cols-2 gap-3 text-sm"><div className="rounded-lg bg-slate-950 p-3"><p className="text-slate-500">数据库</p><p className="mt-1">{target?.task_database_ready && target?.project_database_ready ? 'Tasks + Projects 已连接' : '未连接'}</p></div><div className="rounded-lg bg-slate-950 p-3"><p className="text-slate-500">凭据</p><p className="mt-1">{status?.credentials.notion_token ? '已配置' : '缺失'}</p></div><div className="rounded-lg bg-slate-950 p-3"><p className="text-slate-500">已映射</p><p className="mt-1 text-xl">{linked}</p></div><div className="rounded-lg bg-slate-950 p-3"><p className="text-slate-500">待投影 / 失败</p><p className="mt-1 text-xl">{sum(status?.outbox ?? [], 'pending')} / {sum(status?.outbox ?? [], 'failed') + sum(status?.outbox ?? [], 'dead')}</p></div></div>{target?.last_error && <p className="mt-3 rounded-lg bg-red-500/10 p-3 text-xs text-red-300">{target.last_error}</p>}<button onClick={requeue} className="mt-4 rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-300 hover:bg-slate-800">重试失败投影</button></section>
        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-5"><div className="mb-4 flex items-center gap-2"><Database className="h-4 w-4 text-violet-400" /><h2 className="font-medium">Obsidian</h2></div><p className="text-sm leading-6 text-slate-500">接口保持可插拔；本地 Brain/PostgreSQL 数据不依赖 Obsidian vault 地址。</p><p className="mt-4 text-xs text-slate-600">状态：未连接 adapter</p></section>
      </div>
    </div>
  );
}
