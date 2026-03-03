/**
 * OKR Dashboard - 层级视图：Area OKR → KR（可展开/折叠）
 * 数据源: /api/tasks/goals
 */

import { useState, useEffect, useCallback } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';

interface Goal {
  id: string;
  title: string;
  status: string;
  priority: string;
  progress: number;
  type: string;
  parent_id: string | null;
  weight: number;
}

const STATUS_COLORS: Record<string, string> = {
  in_progress: 'bg-blue-500/20 text-blue-300 border border-blue-500/30',
  completed:   'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30',
  pending:     'bg-slate-500/20 text-slate-400 border border-slate-500/30',
  paused:      'bg-amber-500/20 text-amber-300 border border-amber-500/30',
};

const STATUS_LABELS: Record<string, string> = {
  in_progress: '进行中',
  completed:   '已完成',
  pending:     '待开始',
  paused:      '暂停',
};

const PRIORITY_COLORS: Record<string, string> = {
  P0: 'text-red-400 font-semibold',
  P1: 'text-amber-400',
  P2: 'text-slate-500',
};

function ProgressBar({ value }: { value: number }) {
  const pct = Math.min(100, Math.max(0, value || 0));
  return (
    <div className="flex items-center gap-2 w-28">
      <div className="flex-1 h-1.5 bg-slate-700 rounded-full overflow-hidden">
        <div className="h-full bg-blue-500 rounded-full" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-slate-400 w-8 text-right">{pct}%</span>
    </div>
  );
}

export default function OKRDashboard() {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/tasks/goals');
      if (!res.ok) throw new Error(res.status.toString());
      const data: Goal[] = await res.json();
      setGoals(data);
    } catch {
      setGoals([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const toggleCollapse = (id: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const areaOkrs  = goals.filter(g => g.type === 'area_okr' && !g.parent_id);
  const subOkrs   = goals.filter(g => g.type === 'area_okr' && g.parent_id);
  const krs       = goals.filter(g => g.type === 'kr');
  const orphanKrs = krs.filter(k => !k.parent_id);

  if (loading) return <div className="h-full flex items-center justify-center text-slate-500 text-sm">加载中…</div>;

  const rowBase = 'flex items-center gap-3 px-4 py-2 border-b border-slate-800/60 hover:bg-slate-800/30 transition-colors text-sm';

  const renderKR = (kr: Goal, indent: boolean) => (
    <div key={kr.id} className={`${rowBase} ${indent ? 'pl-10 bg-slate-900/30' : ''}`}>
      <div className="w-4 shrink-0 flex justify-center">
        <div className="w-1 h-1 rounded-full bg-blue-400/60" />
      </div>
      <div className="flex-1 min-w-0 truncate text-gray-300">{kr.title}</div>
      <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${STATUS_COLORS[kr.status] ?? STATUS_COLORS.pending}`}>
        {STATUS_LABELS[kr.status] ?? kr.status}
      </span>
      <span className={`text-xs w-8 text-right shrink-0 ${PRIORITY_COLORS[kr.priority] ?? ''}`}>{kr.priority}</span>
      <ProgressBar value={kr.progress} />
      <span className="w-6 shrink-0" />
    </div>
  );

  const renderAreaOkr = (okr: Goal, depth: number): React.ReactNode => {
    const myKrs     = krs.filter(k => k.parent_id === okr.id);
    const mySubOkrs = subOkrs.filter(s => s.parent_id === okr.id);
    const isCollapsed = collapsed.has(okr.id);
    const hasChildren = myKrs.length > 0 || mySubOkrs.length > 0;

    return (
      <div key={okr.id}>
        <div
          className={`${rowBase} ${depth > 0 ? 'pl-6 bg-slate-800/20' : 'bg-slate-800/10'} cursor-pointer`}
          onClick={() => hasChildren && toggleCollapse(okr.id)}
        >
          <span className="w-4 shrink-0 text-slate-500 flex items-center">
            {hasChildren
              ? (isCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />)
              : <span className="w-3.5 h-3.5 block" />}
          </span>
          <div className="flex-1 min-w-0 truncate text-gray-100 font-medium">{okr.title}</div>
          <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${STATUS_COLORS[okr.status] ?? STATUS_COLORS.pending}`}>
            {STATUS_LABELS[okr.status] ?? okr.status}
          </span>
          <span className={`text-xs w-8 text-right shrink-0 ${PRIORITY_COLORS[okr.priority] ?? ''}`}>{okr.priority}</span>
          <ProgressBar value={okr.progress} />
          <span className="text-xs text-slate-600 w-6 text-right shrink-0">
            {myKrs.length > 0 ? `${myKrs.length}KR` : ''}
          </span>
        </div>

        {!isCollapsed && (
          <>
            {mySubOkrs.map(sub => renderAreaOkr(sub, depth + 1))}
            {myKrs.map(kr => renderKR(kr, true))}
          </>
        )}
      </div>
    );
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* 表头 */}
      <div className="flex items-center gap-3 px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wider border-b border-slate-800 bg-slate-900/50">
        <span className="w-4 shrink-0" />
        <span className="flex-1">OKR / KR 标题</span>
        <span className="w-16 text-right">状态</span>
        <span className="w-8 text-right">优先级</span>
        <span className="w-28 text-right">进度</span>
        <span className="w-6 text-right">KR</span>
      </div>

      <div className="flex-1 overflow-auto">
        {areaOkrs.map(okr => renderAreaOkr(okr, 0))}

        {orphanKrs.length > 0 && (
          <>
            <div className="px-4 py-2 text-xs text-slate-600 uppercase tracking-wider border-b border-slate-800 bg-slate-900/30">
              独立 KR（未关联 OKR）
            </div>
            {orphanKrs.map(kr => renderKR(kr, false))}
          </>
        )}

        {goals.length === 0 && (
          <div className="flex items-center justify-center h-24 text-slate-500 text-sm">暂无 OKR 数据</div>
        )}
      </div>

      <div className="shrink-0 px-4 py-2 text-xs text-slate-600 border-t border-slate-800 flex items-center gap-4">
        <span>{areaOkrs.length + subOkrs.length} 个 OKR 目标</span>
        <span>{krs.length} 个 KR</span>
        <span>{krs.filter(k => k.status === 'in_progress').length} 个进行中</span>
      </div>
    </div>
  );
}
