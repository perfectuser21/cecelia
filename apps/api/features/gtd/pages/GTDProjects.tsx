/**
 * GTD Projects — Notion 风格 Project/Initiative 数据库视图
 * 数据源: /api/tasks/projects + /api/tasks/areas
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { FolderKanban } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import DatabaseView, { StatusBadge, PriorityBadge, ProgressBar, type Column } from '../components/DatabaseView';

// ─── Inline 编辑 Cell ─────────────────────────────────────────────────────────

function NameCell({ id, type, name, onSaved }: { id: string; type: string; name: string; onSaved: (val: string) => void }) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [value, setValue] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);

  const save = async () => {
    if (value.trim() === name.trim()) { setEditingTitle(false); return; }
    try {
      await fetch(`/api/tasks/okr-projects/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: value.trim() }),
      });
      onSaved(value.trim());
    } finally {
      setEditingTitle(false);
    }
  };

  if (editingTitle) {
    return (
      <div className="flex items-center gap-2 min-w-0" onClick={e => e.stopPropagation()}>
        <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono shrink-0 ${type === 'initiative' ? 'bg-cyan-500/10 text-cyan-400' : 'bg-purple-500/10 text-purple-400'}`}>
          {type === 'initiative' ? 'INI' : 'PRJ'}
        </span>
        <input
          ref={inputRef}
          autoFocus
          className="flex-1 min-w-0 bg-slate-800 border border-blue-500/50 rounded px-1.5 py-0.5 text-sm text-gray-200 focus:outline-none"
          value={value}
          onChange={e => setValue(e.target.value)}
          onBlur={save}
          onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { setValue(name); setEditingTitle(false); } }}
        />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono shrink-0 ${type === 'initiative' ? 'bg-cyan-500/10 text-cyan-400' : 'bg-purple-500/10 text-purple-400'}`}>
        {type === 'initiative' ? 'INI' : 'PRJ'}
      </span>
      <span
        className={`truncate cursor-text hover:bg-slate-700/40 rounded px-0.5 -mx-0.5 transition-colors ${type === 'project' ? 'text-gray-100 font-medium' : 'text-gray-300'}`}
        onDoubleClick={e => { e.stopPropagation(); setValue(name); setEditingTitle(true); }}
        title="双击编辑名称"
      >
        {name}
      </span>
    </div>
  );
}

interface Area {
  id: string;
  name: string;
}

interface Project {
  id: string;
  name: string;
  type: string;
  status: string;
  priority: string;
  progress?: number;
  parent_id: string | null;
  area_id: string | null;
  execution_mode: string | null;
}

export default function GTDProjects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const handleNameSaved = useCallback((id: string, newName: string) => {
    setProjects(prev => prev.map(p => p.id === id ? { ...p, name: newName } : p));
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [projectsRes, areasRes] = await Promise.all([
        fetch('/api/tasks/projects?limit=2000'),
        fetch('/api/tasks/areas'),
      ]);
      setProjects(projectsRes.ok ? await projectsRes.json() : []);
      setAreas(areasRes.ok ? await areasRes.json() : []);
    } catch {
      setProjects([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const areaMap = useMemo(() => new Map(areas.map(a => [a.id, a.name])), [areas]);
  const parentProjects = useMemo(() => {
    const po: Record<string, number> = { P0: 0, P1: 1, P2: 2 };
    return projects
      .filter(p => p.type === 'project')
      .sort((a, b) => (po[a.priority] ?? 9) - (po[b.priority] ?? 9));
  }, [projects]);
  const initiatives = useMemo(() => projects.filter(p => p.type === 'initiative'), [projects]);

  const getChildren = useCallback((row: Project): Project[] => {
    if (row.type === 'project') {
      return initiatives.filter(i => i.parent_id === row.id);
    }
    return [];
  }, [initiatives]);

  const columns: Column<Project>[] = useMemo(() => [
    {
      key: 'name',
      label: '项目名称',
      sortable: true,
      render: (row) => <NameCell id={row.id} type={row.type} name={row.name} onSaved={(val) => handleNameSaved(row.id, val)} />,
      getValue: (row) => row.name,
    },
    {
      key: 'area',
      label: 'Area',
      width: 'w-28',
      sortable: true,
      render: (row) => (
        <span className="text-xs text-slate-500 truncate">
          {row.area_id ? (areaMap.get(row.area_id) ?? '—') : '—'}
        </span>
      ),
      getValue: (row) => row.area_id ? (areaMap.get(row.area_id) ?? '') : '',
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
      width: 'w-28',
      align: 'right',
      sortable: true,
      render: (row) => <ProgressBar value={row.progress ?? 0} color="bg-purple-500" />,
      getValue: (row) => row.progress ?? 0,
    },
    {
      key: 'mode',
      label: '执行',
      width: 'w-16',
      align: 'center',
      render: (row) => row.execution_mode ? (
        <span className={`text-[10px] px-1.5 py-0.5 rounded ${
          row.execution_mode === 'cecelia'
            ? 'bg-cyan-500/10 text-cyan-400'
            : 'bg-slate-500/10 text-slate-400'
        }`}>
          {row.execution_mode}
        </span>
      ) : null,
    },
  ], [areaMap]);

  const activeCount = initiatives.filter(i => i.status === 'in_progress' || i.status === 'active').length;

  return (
    <DatabaseView
      title="Projects"
      icon={<FolderKanban className="w-4 h-4 text-slate-400" />}
      columns={columns}
      data={parentProjects}
      loading={loading}
      getRowId={(row) => row.id}
      getChildren={getChildren}
      onRowClick={(row) => navigate(`/gtd/projects/${row.id}`)}
      searchFilter={(row, q) => row.name.toLowerCase().includes(q.toLowerCase())}
      searchPlaceholder="搜索 Project..."
      filterOptions={[
        {
          key: 'status',
          label: '状态',
          values: [
            { value: 'active', label: '活跃' },
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
      emptyText="暂无 Project 数据"
      footer={
        <>
          <span>{parentProjects.length} 个 Project</span>
          <span>{initiatives.length} 个 Initiative</span>
          <span>{activeCount} 个活跃</span>
        </>
      }
    />
  );
}
