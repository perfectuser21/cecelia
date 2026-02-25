/**
 * OKR Dashboard - DatabaseView 表格模式
 * 数据源: /api/tasks/goals (type=area_okr 和 type=kr)
 */

import { useState, useEffect, useCallback } from 'react';
import { DatabaseView } from '../../shared/components/DatabaseView';
import type { ColumnDef } from '../../shared/components/DatabaseView';

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

interface OKRRow {
  id: string;
  type_label: string;
  title: string;
  area: string;
  priority: string;
  status: string;
  progress: number;
  weight: number;
  [key: string]: unknown;
}

const COLUMNS: ColumnDef[] = [
  { id: 'type_label', label: '类型', type: 'badge', sortable: true, width: 90,
    options: [
      { value: 'Area OKR', label: 'Area OKR', color: '#8b5cf6' },
      { value: 'KR', label: 'KR', color: '#3b82f6' },
    ],
  },
  { id: 'title', label: '标题', type: 'text', sortable: true, width: 360 },
  { id: 'area', label: 'Area', type: 'text', sortable: true, width: 140 },
  { id: 'priority', label: '优先级', type: 'badge', sortable: true, width: 90,
    options: [
      { value: 'P0', label: 'P0', color: '#ef4444' },
      { value: 'P1', label: 'P1', color: '#f59e0b' },
      { value: 'P2', label: 'P2', color: '#6b7280' },
    ],
  },
  { id: 'status', label: '状态', type: 'badge', sortable: true, width: 100,
    options: [
      { value: 'in_progress', label: '进行中', color: '#3b82f6' },
      { value: 'completed', label: '已完成', color: '#10b981' },
      { value: 'pending', label: '待开始', color: '#6b7280' },
    ],
  },
  { id: 'progress', label: '进度 %', type: 'number', sortable: true, width: 90 },
  { id: 'weight', label: '权重', type: 'number', sortable: true, width: 70 },
];

export default function OKRDashboard() {
  const [rows, setRows] = useState<OKRRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/tasks/goals');
      if (!res.ok) throw new Error(res.status.toString());
      const goals: Goal[] = await res.json();

      const areaMap = new Map<string, string>();
      goals.filter(g => g.type === 'area_okr').forEach(a => areaMap.set(a.id, a.title));

      const mapped: OKRRow[] = goals.map(g => ({
        id: g.id,
        type_label: g.type === 'area_okr' ? 'Area OKR' : 'KR',
        title: g.title,
        area: g.type === 'kr' && g.parent_id ? (areaMap.get(g.parent_id) ?? '—') : '—',
        priority: g.priority,
        status: g.status,
        progress: g.progress || 0,
        weight: g.weight || 0,
      }));

      mapped.sort((a, b) => {
        if (a.type_label !== b.type_label) return a.type_label === 'Area OKR' ? -1 : 1;
        const po: Record<string, number> = { P0: 0, P1: 1, P2: 2 };
        return (po[a.priority] ?? 9) - (po[b.priority] ?? 9);
      });

      setRows(mapped);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleUpdate = async (id: string, field: string, value: unknown) => {
    const isCustom = !COLUMNS.find(c => c.id === field);
    const body = isCustom ? { custom_props: { [field]: value } } : { [field]: value };
    await fetch(`/api/tasks/goals/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    setRows(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));
  };

  return (
    <DatabaseView
      data={rows}
      columns={COLUMNS}
      onUpdate={handleUpdate}
      loading={loading}
      defaultView="table"
      stateKey="okr"
      stats={{ total: rows.length, byStatus: { in_progress: rows.filter(r => r.status === 'in_progress').length || undefined } }}
      boardGroupField="status"
    />
  );
}
