/**
 * GTD Projects — OKR 层级视图：okr_projects → okr_scopes → okr_initiatives
 * 数据源: /api/brain/okr/projects + /api/brain/okr/initiatives
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { FolderKanban } from 'lucide-react';
import DatabaseView, { StatusBadge, PriorityBadge, ProgressBar, type Column } from '../components/DatabaseView';

interface OkrProject {
  id: string;
  title: string;
  status: string;
  priority: string;
  kr_id: string | null;
  area_id: string | null;
  progress?: number;
}

export default function GTDProjects() {
  const [projects, setProjects] = useState<OkrProject[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/brain/okr/projects?limit=500');
      const data = res.ok ? await res.json() : { items: [] };
      setProjects(data.items || []);
    } catch {
      setProjects([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const sortedProjects = useMemo(() => {
    const po: Record<string, number> = { P0: 0, P1: 1, P2: 2 };
    return [...projects].sort((a, b) => (po[a.priority] ?? 9) - (po[b.priority] ?? 9));
  }, [projects]);

  const columns: Column<OkrProject>[] = useMemo(() => [
    {
      key: 'title',
      label: '项目名称',
      sortable: true,
      render: (row) => (
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[10px] px-1.5 py-0.5 rounded font-mono shrink-0 bg-purple-500/10 text-purple-400">
            PRJ
          </span>
          <span className="text-gray-100 font-medium truncate">{row.title}</span>
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
      width: 'w-28',
      align: 'right',
      sortable: true,
      render: (row) => <ProgressBar value={row.progress ?? 0} color="bg-purple-500" />,
      getValue: (row) => row.progress ?? 0,
    },
  ], []);

  const activeCount = projects.filter(p => p.status === 'in_progress' || p.status === 'active').length;

  return (
    <DatabaseView
      title="Projects"
      icon={<FolderKanban className="w-4 h-4 text-slate-400" />}
      columns={columns}
      data={sortedProjects}
      loading={loading}
      getRowId={(row) => row.id}
      searchFilter={(row, q) => row.title.toLowerCase().includes(q.toLowerCase())}
      searchPlaceholder="搜索 Project..."
      filterOptions={[
        {
          key: 'status',
          label: '状态',
          values: [
            { value: 'active', label: '活跃' },
            { value: 'in_progress', label: '进行中' },
            { value: 'inactive', label: '未激活' },
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
          <span>{sortedProjects.length} 个 Project</span>
          <span>{activeCount} 个活跃</span>
        </>
      }
    />
  );
}
