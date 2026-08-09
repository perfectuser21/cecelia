import { useCallback, useEffect, useState } from 'react';
import { Activity, Bot, RefreshCw } from 'lucide-react';

interface Attempt { id: string; provider: string; role: string; phase: string; status: string; machine_id: string | null; task_title: string | null; error_message: string | null }
interface EventRecord { id: string; event_type: string; source: string; task_title: string | null; created_at: string }

export default function WorkbenchActivity() {
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/brain/workbench/activity?limit=100');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      setAttempts(data.attempts ?? []);
      setEvents(data.events ?? []);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  return (
    <div className="h-full overflow-auto bg-slate-950 p-5 text-slate-200">
      <div className="mb-5 flex items-center gap-2"><Activity className="h-5 w-5 text-cyan-400" /><h1 className="text-lg font-semibold">Activity</h1><button onClick={refresh} className="ml-auto rounded-lg p-2 text-slate-400 hover:bg-slate-800" title="刷新"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></button></div>
      <section className="mb-6">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Agent Attempts</h2>
        <div className="overflow-hidden rounded-xl border border-slate-800">
          {attempts.map(attempt => <div key={attempt.id} className="grid grid-cols-[1fr_110px_120px_120px] gap-3 border-b border-slate-800/70 px-4 py-3 text-sm last:border-0"><div className="min-w-0"><p className="truncate">{attempt.task_title ?? attempt.phase}</p><p className="truncate text-xs text-slate-500">{attempt.error_message ?? attempt.role}</p></div><span className="text-slate-400">{attempt.provider}</span><span className="text-slate-400">{attempt.machine_id ?? 'local'}</span><span className="text-cyan-400">{attempt.status}</span></div>)}
          {!loading && attempts.length === 0 && <p className="p-5 text-sm text-slate-500">没有执行 attempt</p>}
        </div>
      </section>
      <section>
        <h2 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500"><Bot className="h-3.5 w-3.5" />Brain Events</h2>
        <div className="overflow-hidden rounded-xl border border-slate-800">{events.map(event => <div key={event.id} className="grid grid-cols-[1fr_180px_150px] gap-3 border-b border-slate-800/70 px-4 py-3 text-sm last:border-0"><span className="truncate">{event.task_title ?? event.event_type}</span><span className="truncate text-slate-500">{event.event_type}</span><span className="text-right text-xs text-slate-600">{new Date(event.created_at).toLocaleString('zh-CN')}</span></div>)}</div>
      </section>
    </div>
  );
}
