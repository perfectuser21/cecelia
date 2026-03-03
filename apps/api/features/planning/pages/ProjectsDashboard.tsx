/**
 * Projects Dashboard - DatabaseView 表格模式
 * 数据源: /api/tasks/goals + /api/tasks/projects + /api/tasks/areas
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { DatabaseView } from '../../shared/components/DatabaseView';
import type { ColumnDef } from '../../shared/components/DatabaseView';

interface Goal {
  id: string;
  title: string;
  type: string;
  parent_id: string | null;
}

interface Area {
  id: string;
  name: string;
  domain: string | null;
}

interface Project {
  id: string;
  name: string;
  type: string;
  status: string;
  priority: string;
  progress?: number;
  parent_id: string | null;
  kr_id: string | null;
  goal_id: string | null;
  area_id: string | null;
  repo_path: string | null;
}

interface ProjectRow {
  id: string;
  type_label: string;
  name: string;
  area_id: string;
  priority: string;
  status: string;
  progress: number;
  [key: string]: unknown;
}

const FIELD_IDS = ['type_label', 'name', 'area_id', 'priority', 'status', 'progress'];

export default function ProjectsDashboard() {
  const [rows, setRows] = useState<ProjectRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [areas, setAreas] = useState<Area[]>([]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [goalsRes, projectsRes, areasRes] = await Promise.all([
        fetch('/api/tasks/goals'),
        fetch('/api/tasks/projects'),
        fetch('/api/tasks/areas'),
      ]);

      const goals: Goal[] = goalsRes.ok ? await goalsRes.json() : [];
      const projects: Project[] = projectsRes.ok ? await projectsRes.json() : [];
      const areaList: Area[] = areasRes.ok ? await areasRes.json() : [];
      setAreas(areaList);

      // 通过 kr_id → goals → parent_id 推导 area_okr（用于无直接 area_id 的项目显示）
      const areaNameMap = new Map<string, string>();
      goals.filter(g => g.type === 'area_okr').forEach(a => areaNameMap.set(a.id, a.title));

      const krToAreaId = new Map<string, string>();
      goals.filter(g => g.type === 'kr').forEach(k => {
        if (k.parent_id && areaNameMap.has(k.parent_id)) {
          krToAreaId.set(k.id, k.parent_id);
        }
      });

      // areas 表 ID → name（用于显示 area_id 字段）
      const areaIdToName = new Map<string, string>(areaList.map(a => [a.id, a.name]));

      const po: Record<string, number> = { P0: 0, P1: 1, P2: 2 };

      const mapped: ProjectRow[] = projects.map(p => {
        // 优先使用 area_id（直接外键），回退到 kr_id 推导
        let resolvedAreaId = p.area_id ?? '';
        if (!resolvedAreaId) {
          const kr = p.kr_id || p.goal_id;
          if (kr && krToAreaId.has(kr)) {
            resolvedAreaId = krToAreaId.get(kr) ?? '';
          } else if (p.type === 'initiative' && p.parent_id) {
            const parentKr = p.parent_id;
            if (krToAreaId.has(parentKr)) {
              resolvedAreaId = krToAreaId.get(parentKr) ?? '';
            }
          }
        }

        return {
          id: p.id,
          type_label: p.type,
          name: p.name,
          area_id: resolvedAreaId,
          status: p.status,
          priority: p.priority ?? 'P2',
          progress: p.progress ?? 0,
          _area_name: resolvedAreaId ? (areaIdToName.get(resolvedAreaId) ?? areaNameMap.get(resolvedAreaId) ?? '—') : '—',
        };
      });

      mapped.sort((a, b) => {
        if (a.type_label !== b.type_label) return a.type_label === 'project' ? -1 : 1;
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

  const columns = useMemo<ColumnDef[]>(() => [
    { id: 'type_label', label: '类型', type: 'badge', sortable: true, width: 100,
      options: [
        { value: 'project', label: 'Project', color: '#8b5cf6' },
        { value: 'initiative', label: 'Initiative', color: '#3b82f6' },
      ],
    },
    { id: 'name', label: '名称', type: 'text', sortable: true, width: 300 },
    { id: 'area_id', label: 'Area', type: 'select', editable: true, sortable: true, width: 160,
      options: [
        { value: '', label: '— 未设置 —', color: '#6b7280' },
        ...areas.map(a => ({ value: a.id, label: a.name, color: '#10b981' })),
      ],
    },
    { id: 'priority', label: '优先级', type: 'badge', editable: true, sortable: true, width: 90,
      options: [
        { value: 'P0', label: 'P0', color: '#ef4444' },
        { value: 'P1', label: 'P1', color: '#f59e0b' },
        { value: 'P2', label: 'P2', color: '#6b7280' },
      ],
    },
    { id: 'status', label: '状态', type: 'badge', editable: true, sortable: true, width: 110,
      options: [
        { value: 'active', label: '活跃', color: '#10b981' },
        { value: 'in_progress', label: '进行中', color: '#3b82f6' },
        { value: 'pending', label: '待开始', color: '#6b7280' },
        { value: 'completed', label: '已完成', color: '#10b981' },
        { value: 'paused', label: '暂停', color: '#f59e0b' },
      ],
    },
    { id: 'progress', label: '进度 %', type: 'number', editable: true, sortable: true, width: 90 },
  ], [areas]);

  const handleUpdate = async (id: string, field: string, value: unknown) => {
    const isCustom = !FIELD_IDS.includes(field);
    const body = isCustom ? { custom_props: { [field]: value } } : { [field]: value };
    await fetch(`/api/tasks/projects/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (field === 'area_id') {
      const areaName = areas.find(a => a.id === value)?.name ?? '—';
      setRows(prev => prev.map(r => r.id === id ? { ...r, area_id: value as string, _area_name: areaName } : r));
    } else {
      setRows(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));
    }
  };

  return (
    <DatabaseView
      data={rows}
      columns={columns}
      onUpdate={handleUpdate}
      loading={loading}
      defaultView="table"
      stateKey="initiatives"
      stats={{ total: rows.length, byStatus: {
        active: rows.filter(r => r.status === 'active').length || undefined,
        in_progress: rows.filter(r => r.status === 'in_progress').length || undefined,
      }}}
      boardGroupField="status"
    />
  );
}
