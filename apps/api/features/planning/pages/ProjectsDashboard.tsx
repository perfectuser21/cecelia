/**
 * Projects Dashboard - DatabaseView 表格模式
 * 数据源: /api/tasks/goals + /api/tasks/projects
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
  repo_path: string | null;
}

interface ProjectRow {
  id: string;
  type_label: string;
  name: string;
  area: string;
  status: string;
  priority: string;
  progress: number;
  [key: string]: unknown;
}

const FIELD_IDS = ['type_label', 'name', 'area', 'priority', 'status', 'progress'];

export default function ProjectsDashboard() {
  const [rows, setRows] = useState<ProjectRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [areaNavMap, setAreaNavMap] = useState<Map<string, string>>(new Map());

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [goalsRes, projectsRes] = await Promise.all([
        fetch('/api/tasks/goals'),
        fetch('/api/tasks/projects'),
      ]);
      const goals: Goal[] = await goalsRes.json();
      const projects: Project[] = await projectsRes.json();

      const areaNameMap = new Map<string, string>();
      const areaPathMap = new Map<string, string>();
      goals.filter(g => g.type === 'area_okr').forEach(a => {
        areaNameMap.set(a.id, a.title);
        areaPathMap.set(a.id, `/work/okr/area/${a.id}`);
      });

      const krToArea = new Map<string, { id: string; title: string }>();
      goals.filter(g => g.type === 'kr').forEach(k => {
        if (k.parent_id && areaNameMap.has(k.parent_id)) {
          krToArea.set(k.id, { id: k.parent_id, title: areaNameMap.get(k.parent_id)! });
        }
      });

      const projAreaTitle = new Map<string, string>();
      const projAreaNav = new Map<string, string>();
      projects.filter(p => p.type === 'project').forEach(p => {
        const kr = p.kr_id || p.goal_id;
        if (kr && krToArea.has(kr)) {
          const area = krToArea.get(kr)!;
          projAreaTitle.set(p.id, area.title);
          projAreaNav.set(p.id, areaPathMap.get(area.id) ?? '');
        }
      });

      const navMap = new Map<string, string>();
      const po: Record<string, number> = { P0: 0, P1: 1, P2: 2 };

      const mapped: ProjectRow[] = projects.map(p => {
        let areaTitle = '—';
        let nav = '';
        if (p.type === 'initiative' && p.parent_id) {
          areaTitle = projAreaTitle.get(p.parent_id) ?? '—';
          nav = projAreaNav.get(p.parent_id) ?? '';
        } else {
          areaTitle = projAreaTitle.get(p.id) ?? '—';
          nav = projAreaNav.get(p.id) ?? '';
        }
        if (nav) navMap.set(p.id, nav);
        return {
          id: p.id,
          type_label: p.type,
          name: p.name,
          area: areaTitle,
          status: p.status,
          priority: p.priority ?? 'P2',
          progress: p.progress ?? 0,
        };
      });

      mapped.sort((a, b) => {
        if (a.type_label !== b.type_label) return a.type_label === 'project' ? -1 : 1;
        return (po[a.priority] ?? 9) - (po[b.priority] ?? 9);
      });

      setAreaNavMap(navMap);
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
    { id: 'area', label: 'Area', type: 'relation', editable: false, sortable: true, width: 160,
      navigateTo: (rowId: string) => areaNavMap.get(rowId) ?? null,
    },
    { id: 'priority', label: '优先级', type: 'badge', sortable: true, width: 90,
      options: [
        { value: 'P0', label: 'P0', color: '#ef4444' },
        { value: 'P1', label: 'P1', color: '#f59e0b' },
        { value: 'P2', label: 'P2', color: '#6b7280' },
      ],
    },
    { id: 'status', label: '状态', type: 'badge', sortable: true, width: 110,
      options: [
        { value: 'active', label: '活跃', color: '#10b981' },
        { value: 'in_progress', label: '进行中', color: '#3b82f6' },
        { value: 'pending', label: '待开始', color: '#6b7280' },
        { value: 'completed', label: '已完成', color: '#10b981' },
        { value: 'paused', label: '暂停', color: '#f59e0b' },
      ],
    },
    { id: 'progress', label: '进度 %', type: 'number', sortable: true, width: 90 },
  ], [areaNavMap]);

  const handleUpdate = async (id: string, field: string, value: unknown) => {
    const isCustom = !FIELD_IDS.includes(field);
    const body = isCustom ? { custom_props: { [field]: value } } : { [field]: value };
    await fetch(`/api/tasks/projects/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    setRows(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));
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
