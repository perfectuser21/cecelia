/**
 * Area Dashboard - DatabaseView 展示 Area OKR 数据
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { DatabaseView } from '../../shared/components/DatabaseView';
import type { ColumnDef } from '../../shared/components/DatabaseView/types';

interface Goal { id: string; title: string; status: string; priority: string; progress: number; type: string; parent_id: string | null; }
interface AreaRow { id: string; title: string; priority: string; status: string; progress: number; krCount: number; activeKrCount: number; }

const AREA_COLUMNS: ColumnDef[] = [
  { id: "title", label: "Area 名称", type: "text", editable: true, sortable: true, width: 300 },
  { id: "priority", label: "Priority", type: "badge", editable: true, filterable: true, width: 90, options: [
    { value: "P0", label: "P0", color: "red" }, { value: "P1", label: "P1", color: "amber" }, { value: "P2", label: "P2", color: "gray" },
  ]},
  { id: "status", label: "Status", type: "select", editable: true, filterable: true, width: 120, options: [
    { value: "in_progress", label: "进行中" }, { value: "planning", label: "规划中" },
    { value: "completed", label: "已完成" }, { value: "inactive", label: "暂停" }, { value: "pending", label: "待开始" },
  ]},
  { id: "progress", label: "Progress", type: "progress", editable: true, sortable: true, width: 150 },
  { id: "krCount", label: "KR 数", type: "number", sortable: true, width: 80 },
  { id: "activeKrCount", label: "进行中 KR", type: "number", sortable: true, width: 100 },
];

export default function AreaDashboard() {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/tasks/goals");
      const data = await res.json();
      setGoals(Array.isArray(data) ? data : []);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const rows = useMemo((): AreaRow[] => {
    const areas = goals.filter((g) => g.type === "area_okr");
    const krs = goals.filter((g) => g.type === "kr");
    return areas.map((area) => {
      const areaKRs = krs.filter((k) => k.parent_id === area.id);
      return {
        id: area.id, title: area.title, priority: area.priority, status: area.status,
        progress: area.progress ?? 0, krCount: areaKRs.length,
        activeKrCount: areaKRs.filter((k) => k.status === "in_progress").length,
      };
    });
  }, [goals]);

  const stats = useMemo(() => ({
    total: rows.length, byStatus: { in_progress: rows.filter((r) => r.status === "in_progress").length },
  }), [rows]);

  const handleUpdate = useCallback(async (id: string, field: string, value: unknown) => {
    if (field === "krCount" || field === "activeKrCount") return;
    await fetch(`/api/tasks/goals/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: value }),
    });
    fetchData();
  }, [fetchData]);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <DatabaseView data={rows} columns={AREA_COLUMNS} onUpdate={handleUpdate}
        loading={loading} stats={stats} defaultView="table" stateKey="areas" />
    </div>
  );
}
