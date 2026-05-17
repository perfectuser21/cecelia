/**
 * GTD Tasks — Notion 风格 Task 数据库视图
 * 数据源: /api/tasks/tasks + /api/tasks/projects
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { ListTodo } from 'lucide-react';
import DatabaseView, { StatusBadge, PriorityBadge, type Column } from '../components/DatabaseView';

interface Task {
  id: string;
  title: string;
  status: string;
  priority: string;
  task_type: string;
  created_at: string;
  completed_at: string | null;
  project_id: string | null;
  goal_id: string | null;
}

interface Project {
  id: string;
  name: string;
}

function formatRelative(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffHours < 1) return '刚刚';
  if (diffHours < 24) return `${diffHours}h 前`;
  if (diffDays < 30) return `${diffDays}d 前`;
  return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

const TASK_TYPE_LABELS: Record<string, string> = {
  dev: '开发',
  decomp_review: '拆解审查',
  initiative_plan: '规划',
  suggestion_plan: '建议',
  code_review: '代码审查',
  research: '调研',
};

export default function GTDTasks() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [tasksRes, projectsRes] = await Promise.all([
        fetch('/api/tasks/tasks?limit=500'),
        fetch('/api/tasks/projects?limit=2000'),
      ]);
      setTasks(tasksRes.ok ? await tasksRes.json() : []);
      setProjects(projectsRes.ok ? await projectsRes.json() : []);
    } catch {
      setTasks([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const projectMap = useMemo(() => new Map(projects.map(p => [p.id, p.name])), [projects]);

  const columns: Column<Task>[] = useMemo(() => [
    {
      key: 'title',
      label: '任务标题',
      sortable: true,
      render: (row) => (
        <span className="text-gray-200 truncate block">{row.title}</span>
      ),
      getValue: (row) => row.title,
    },
    {
      key: 'project',
      label: 'Initiative',
      width: 'w-40',
      sortable: true,
      render: (row) => (
        <span className="text-xs text-slate-500 truncate block">
          {row.project_id ? (projectMap.get(row.project_id) ?? '—') : '—'}
        </span>
      ),
      getValue: (row) => row.project_id ? (projectMap.get(row.project_id) ?? '') : '',
    },
    {
      key: 'task_type',
      label: '类型',
      width: 'w-20',
      align: 'center',
      sortable: true,
      render: (row) => (
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-500/10 text-slate-400">
          {TASK_TYPE_LABELS[row.task_type] ?? row.task_type}
        </span>
      ),
      getValue: (row) => row.task_type,
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
      key: 'created_at',
      label: '创建时间',
      width: 'w-20',
      align: 'right',
      sortable: true,
      render: (row) => (
        <span className="text-[11px] text-slate-500">{formatRelative(row.created_at)}</span>
      ),
      getValue: (row) => new Date(row.created_at).getTime(),
    },
  ], [projectMap]);

  // 默认按创建时间降序排列，最新的在前
  const sortedTasks = useMemo(() =>
    [...tasks].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
  [tasks]);

  const queued = tasks.filter(t => t.status === 'queued').length;
  const inProgress = tasks.filter(t => t.status === 'in_progress').length;
  const completed = tasks.filter(t => t.status === 'completed').length;

  return (
    <DatabaseView
      title="Tasks"
      icon={<ListTodo className="w-4 h-4 text-slate-400" />}
      columns={columns}
      data={sortedTasks}
      loading={loading}
      getRowId={(row) => row.id}
      searchFilter={(row, q) => row.title.toLowerCase().includes(q.toLowerCase())}
      searchPlaceholder="搜索 Task..."
      filterOptions={[
        {
          key: 'status',
          label: '状态',
          values: [
            { value: 'queued', label: '排队中' },
            { value: 'in_progress', label: '进行中' },
            { value: 'completed', label: '已完成' },
            { value: 'failed', label: '失败' },
            { value: 'quarantined', label: '隔离' },
          ],
        },
        {
          key: 'task_type',
          label: '类型',
          values: [
            { value: 'dev', label: '开发' },
            { value: 'decomp_review', label: '拆解审查' },
            { value: 'initiative_plan', label: '规划' },
            { value: 'code_review', label: '代码审查' },
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
      emptyText="暂无 Task 数据"
      footer={
        <>
          <span>{tasks.length} 个 Task</span>
          <span>{queued} 排队</span>
          <span>{inProgress} 进行中</span>
          <span>{completed} 已完成</span>
        </>
      }
    />
  );
}
