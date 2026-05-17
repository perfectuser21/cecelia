/**
 * GTD Area — Notion 风格 Area 数据库视图
 * 数据源: /api/tasks/areas + /api/tasks/projects
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Layers, Briefcase, BookOpen, Heart, Settings } from 'lucide-react';
import DatabaseView, { type Column } from '../components/DatabaseView';

interface Area {
  id: string;
  name: string;
  domain: string | null;
  archived: boolean;
}

interface Project {
  id: string;
  area_id: string | null;
  type: string;
  status: string;
}

const DOMAIN_ICONS: Record<string, React.ReactNode> = {
  Work:   <Briefcase className="w-3.5 h-3.5 text-blue-400" />,
  Study:  <BookOpen className="w-3.5 h-3.5 text-purple-400" />,
  Life:   <Heart className="w-3.5 h-3.5 text-green-400" />,
  System: <Settings className="w-3.5 h-3.5 text-slate-400" />,
};

const DOMAIN_LABELS: Record<string, string> = {
  Work: '工作', Study: '学习', Life: '生活', System: '系统',
};

export default function GTDArea() {
  const [areas, setAreas] = useState<Area[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [areasRes, projectsRes] = await Promise.all([
        fetch('/api/tasks/areas'),
        fetch('/api/tasks/projects?limit=2000'),
      ]);
      setAreas(areasRes.ok ? await areasRes.json() : []);
      setProjects(projectsRes.ok ? await projectsRes.json() : []);
    } catch {
      setAreas([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const projectCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    const activeProjects: Record<string, number> = {};
    projects.filter(p => p.type === 'project' && p.area_id).forEach(p => {
      counts[p.area_id!] = (counts[p.area_id!] ?? 0) + 1;
      if (p.status === 'active' || p.status === 'in_progress') {
        activeProjects[p.area_id!] = (activeProjects[p.area_id!] ?? 0) + 1;
      }
    });
    return { total: counts, active: activeProjects };
  }, [projects]);

  const columns: Column<Area>[] = useMemo(() => [
    {
      key: 'name',
      label: '名称',
      sortable: true,
      render: (row) => (
        <div className="flex items-center gap-2 min-w-0">
          {DOMAIN_ICONS[row.domain ?? ''] ?? <Layers className="w-3.5 h-3.5 text-slate-400" />}
          <span className="text-gray-200 truncate">{row.name}</span>
        </div>
      ),
      getValue: (row) => row.name,
    },
    {
      key: 'domain',
      label: '领域',
      width: 'w-24',
      sortable: true,
      render: (row) => (
        <span className="text-xs text-slate-400">
          {DOMAIN_LABELS[row.domain ?? ''] ?? row.domain ?? '—'}
        </span>
      ),
      getValue: (row) => row.domain ?? '',
    },
    {
      key: 'projects',
      label: 'Projects',
      width: 'w-24',
      align: 'right',
      sortable: true,
      render: (row) => {
        const total = projectCounts.total[row.id] ?? 0;
        const active = projectCounts.active[row.id] ?? 0;
        return (
          <span className="text-xs text-slate-500">
            {total > 0 ? (
              <>
                <span className="text-gray-300">{total}</span>
                {active > 0 && <span className="text-blue-400 ml-1">({active} 活跃)</span>}
              </>
            ) : '—'}
          </span>
        );
      },
      getValue: (row) => projectCounts.total[row.id] ?? 0,
    },
    {
      key: 'archived',
      label: '状态',
      width: 'w-20',
      align: 'center',
      render: (row) => (
        <span className={`text-[11px] px-2 py-0.5 rounded-full ${
          row.archived
            ? 'bg-slate-500/15 text-slate-500 border border-slate-500/25'
            : 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/25'
        }`}>
          {row.archived ? '已归档' : '活跃'}
        </span>
      ),
    },
  ], [projectCounts]);

  return (
    <DatabaseView
      title="Area"
      icon={<Layers className="w-4 h-4 text-slate-400" />}
      columns={columns}
      data={areas}
      loading={loading}
      getRowId={(row) => row.id}
      searchFilter={(row, q) => row.name.toLowerCase().includes(q.toLowerCase())}
      searchPlaceholder="搜索 Area..."
      filterOptions={[
        {
          key: 'domain',
          label: '领域',
          values: [
            { value: 'Work', label: '工作' },
            { value: 'Study', label: '学习' },
            { value: 'Life', label: '生活' },
            { value: 'System', label: '系统' },
          ],
        },
      ]}
      emptyText="暂无 Area 数据"
      footer={
        <>
          <span>{areas.length} 个 Area</span>
          <span>{areas.filter(a => !a.archived).length} 个活跃</span>
        </>
      }
    />
  );
}
