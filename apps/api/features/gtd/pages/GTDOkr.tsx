/**
 * GTD OKR — Notion 风格 OKR 数据库视图（层级：Area OKR → KR）
 * 数据源: /api/tasks/goals
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Target } from 'lucide-react';
import DatabaseView, { StatusBadge, PriorityBadge, ProgressBar, type Column } from '../components/DatabaseView';

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

export default function GTDOkr() {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/tasks/goals');
      setGoals(res.ok ? await res.json() : []);
    } catch {
      setGoals([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const areaOkrs = useMemo(() => goals.filter(g => g.type === 'area_okr' && !g.parent_id), [goals]);
  const subOkrs = useMemo(() => goals.filter(g => g.type === 'area_okr' && g.parent_id), [goals]);
  const krs = useMemo(() => goals.filter(g => g.type === 'kr'), [goals]);

  const getChildren = useCallback((row: Goal): Goal[] => {
    if (row.type === 'area_okr') {
      const childOkrs = subOkrs.filter(s => s.parent_id === row.id);
      const childKrs = krs.filter(k => k.parent_id === row.id);
      return [...childOkrs, ...childKrs];
    }
    return [];
  }, [subOkrs, krs]);

  const columns: Column<Goal>[] = useMemo(() => [
    {
      key: 'title',
      label: '标题',
      sortable: true,
      render: (row) => (
        <div className="flex items-center gap-2 min-w-0">
          <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono shrink-0 ${
            row.type === 'kr'
              ? 'bg-blue-500/10 text-blue-400'
              : 'bg-purple-500/10 text-purple-400'
          }`}>
            {row.type === 'kr' ? 'KR' : 'OKR'}
          </span>
          <span className={`truncate ${row.type === 'kr' ? 'text-gray-300' : 'text-gray-100 font-medium'}`}>
            {row.title}
          </span>
        </div>
      ),
      getValue: (row) => row.title,
    },
    {
      key: 'status',
      label: '状态',
      width: 'w-24',
      align: 'center',
      sortable: true,
      render: (row) => <StatusBadge status={row.status} />,
      getValue: (row) => row.status,
    },
    {
      key: 'priority',
      label: '优先级',
      width: 'w-16',
      align: 'center',
      sortable: true,
      render: (row) => <PriorityBadge priority={row.priority} />,
      getValue: (row) => row.priority,
    },
    {
      key: 'progress',
      label: '进度',
      width: 'w-32',
      align: 'right',
      sortable: true,
      render: (row) => <ProgressBar value={row.progress} />,
      getValue: (row) => row.progress,
    },
    {
      key: 'children_count',
      label: 'KR',
      width: 'w-12',
      align: 'right',
      render: (row) => {
        const count = krs.filter(k => k.parent_id === row.id).length;
        return count > 0 ? <span className="text-[11px] text-slate-500">{count}</span> : null;
      },
    },
  ], [krs]);

  const statsKrs = krs.length;
  const statsInProgress = krs.filter(k => k.status === 'in_progress').length;

  return (
    <DatabaseView
      title="OKR"
      icon={<Target className="w-4 h-4 text-slate-400" />}
      columns={columns}
      data={areaOkrs}
      loading={loading}
      getRowId={(row) => row.id}
      getChildren={getChildren}
      searchFilter={(row, q) => row.title.toLowerCase().includes(q.toLowerCase())}
      searchPlaceholder="搜索 OKR..."
      filterOptions={[
        {
          key: 'status',
          label: '状态',
          values: [
            { value: 'in_progress', label: '进行中' },
            { value: 'pending', label: '待开始' },
            { value: 'completed', label: '已完成' },
            { value: 'paused', label: '暂停' },
          ],
        },
        {
          key: 'priority',
          label: '优先级',
          values: [
            { value: 'P0', label: 'P0' },
            { value: 'P1', label: 'P1' },
            { value: 'P2', label: 'P2' },
          ],
        },
      ]}
      emptyText="暂无 OKR 数据"
      footer={
        <>
          <span>{areaOkrs.length + subOkrs.length} 个 OKR</span>
          <span>{statsKrs} 个 KR</span>
          <span>{statsInProgress} 个进行中</span>
        </>
      }
    />
  );
}
