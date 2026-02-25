/**
 * Area OKR Detail - 展示某个 Area 的所有 KR（Key Results）
 * 数据源: /api/tasks/goals（同一 PostgreSQL，不再查 businesses 表）
 */

import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { DatabaseView } from '../../shared/components/DatabaseView';
import type { ColumnDef } from '../../shared/components/DatabaseView';

interface Goal {
  id: string;
  title: string;
  type: string;
  status: string;
  priority: string;
  progress: number;
  weight: number;
  parent_id: string | null;
  custom_props: Record<string, unknown>;
}

interface KRRow {
  id: string;
  title: string;
  status: string;
  priority: string;
  progress: number;
  weight: number;
  [key: string]: unknown;
}

const COLUMNS: ColumnDef[] = [
  { id: 'title', label: 'KR 名称', type: 'text', sortable: true, width: 400 },
  { id: 'priority', label: '优先级', type: 'badge', sortable: true, width: 90,
    options: [
      { value: 'P0', label: 'P0', color: '#ef4444' },
      { value: 'P1', label: 'P1', color: '#f59e0b' },
      { value: 'P2', label: 'P2', color: '#6b7280' },
    ],
  },
  { id: 'status', label: '状态', type: 'badge', sortable: true, width: 110,
    options: [
      { value: 'pending', label: '待开始', color: '#6b7280' },
      { value: 'in_progress', label: '进行中', color: '#3b82f6' },
      { value: 'completed', label: '已完成', color: '#10b981' },
      { value: 'paused', label: '暂停', color: '#f59e0b' },
    ],
  },
  { id: 'progress', label: '进度', type: 'progress', sortable: true, width: 140 },
  { id: 'weight', label: '权重', type: 'number', sortable: true, width: 80 },
];

const FIELD_IDS = COLUMNS.map(c => c.id);

export default function AreaOKRDetail() {
  const { areaId } = useParams<{ areaId: string }>();
  const navigate = useNavigate();
  const [area, setArea] = useState<Goal | null>(null);
  const [rows, setRows] = useState<KRRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    if (!areaId) return;
    setLoading(true);
    try {
      const [areaRes, allGoalsRes] = await Promise.all([
        fetch(`/api/tasks/goals/${areaId}`),
        fetch('/api/tasks/goals'),
      ]);
      if (!areaRes.ok) { setArea(null); setRows([]); return; }

      const areaGoal: Goal = await areaRes.json();
      setArea(areaGoal);

      const allGoals: Goal[] = await allGoalsRes.json();
      const krs = allGoals
        .filter(g => g.type === 'kr' && g.parent_id === areaId)
        .map(g => ({
          id: g.id,
          title: g.title,
          status: g.status,
          priority: g.priority ?? 'P2',
          progress: g.progress ?? 0,
          weight: g.weight ?? 1,
          ...(g.custom_props ?? {}),
        }));
      setRows(krs);
    } catch { setArea(null); setRows([]); }
    finally { setLoading(false); }
  }, [areaId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleUpdate = useCallback(async (id: string, field: string, value: unknown) => {
    const isCustom = !FIELD_IDS.includes(field);
    const body = isCustom ? { custom_props: { [field]: value } } : { [field]: value };
    await fetch(`/api/tasks/goals/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    setRows(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));
  }, []);

  if (!loading && !area) {
    return (
      <div className="h-full flex flex-col bg-slate-900 text-gray-200 p-6">
        <button onClick={() => navigate('/work')} className="flex items-center gap-2 text-slate-400 hover:text-white mb-6 transition-colors">
          <ChevronLeft className="w-4 h-4" /> 返回
        </button>
        <div className="text-center py-16 text-slate-500">Area 未找到</div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-slate-900 overflow-hidden">
      <div className="px-6 pt-4 pb-3 border-b border-slate-700/50 shrink-0">
        <button onClick={() => navigate('/work')} className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors mb-3">
          <ChevronLeft className="w-3.5 h-3.5" /> Area 总览
        </button>
        <h1 className="text-lg font-semibold text-gray-100 truncate">
          {area?.title ?? '加载中...'}
        </h1>
        <div className="flex items-center gap-4 mt-1 text-xs text-slate-400">
          <span>{rows.length} 个 KR</span>
          <span>活跃 {rows.filter(r => r.status === 'in_progress').length}</span>
          {area?.progress !== undefined && <span>总进度 {area.progress}%</span>}
        </div>
      </div>
      <div className="flex-1 overflow-hidden">
        <DatabaseView
          data={rows} columns={COLUMNS} onUpdate={handleUpdate}
          loading={loading} defaultView="table"
          stateKey={`area-kr-${areaId}`} boardGroupField="status"
          stats={{ total: rows.length, byStatus: {
            in_progress: rows.filter(r => r.status === 'in_progress').length || undefined,
          }}}
        />
      </div>
    </div>
  );
}
