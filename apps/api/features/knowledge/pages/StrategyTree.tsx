import { useState } from 'react';
import {
  Target, ChevronRight, ChevronDown, Layers, GitBranch,
  CheckCircle, Clock, AlertCircle, Minus, ExternalLink
} from 'lucide-react';
import { useApi } from '../../shared/hooks/useApi';

// ─── 类型定义 ─────────────────────────────────────────────────────────────────

interface Task {
  id: string;
  title: string;
  status: string;
  task_type?: string;
  priority?: string;
  created_at: string;
  completed_at?: string;
  pr_title?: string;
  pr_url?: string;
  learning_summary?: string;
  self_score?: number;
}

interface Initiative {
  id: string;
  title: string;
  status: string;
  description?: string;
  priority?: string;
  progress: number;
  task_total: number;
  task_completed: number;
  tasks: Task[];
}

interface Scope {
  id: string;
  title: string;
  status: string;
  progress: number;
  initiatives: Initiative[];
}

interface Project {
  id: string;
  title: string;
  status: string;
  progress: number;
  scopes: Scope[];
}

interface KR {
  id: string;
  title: string;
  status: string;
  target_value?: number;
  current_value?: number;
  unit?: string;
  progress: number;
  projects: Project[];
}

interface Objective {
  id: string;
  title: string;
  status: string;
  description?: string;
  priority?: string;
  key_results: KR[];
}

interface Area {
  id: string;
  name: string;
  domain?: string;
  objectives: Objective[];
}

// ─── 辅助组件 ─────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const cfg: Record<string, string> = {
    active:     'bg-green-100 text-green-700',
    completed:  'bg-blue-100 text-blue-700',
    in_progress:'bg-yellow-100 text-yellow-700',
    pending:    'bg-gray-100 text-gray-500',
    planning:   'bg-purple-100 text-purple-600',
    failed:     'bg-red-100 text-red-600',
    archived:   'bg-gray-100 text-gray-400',
  };
  const labels: Record<string, string> = {
    active: '进行中', completed: '已完成', in_progress: '执行中',
    pending: '待开始', planning: '规划中', failed: '失败', archived: '已归档',
  };
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${cfg[status] || 'bg-gray-100 text-gray-500'}`}>
      {labels[status] || status}
    </span>
  );
}

function ProgressBar({ completed, total }: { completed: number; total: number }) {
  if (total === 0) return <span className="text-xs text-gray-400">无 Task</span>;
  const pct = Math.round((completed / total) * 100);
  const color = pct === 100 ? 'bg-green-500' : pct > 50 ? 'bg-blue-500' : 'bg-yellow-400';
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-16 h-1.5 bg-gray-200 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-gray-500">{completed}/{total}</span>
    </div>
  );
}

function TaskStatusIcon({ status }: { status: string }) {
  if (status === 'completed') return <CheckCircle size={12} className="text-green-500 flex-shrink-0" />;
  if (status === 'in_progress' || status === 'queued') return <Clock size={12} className="text-yellow-500 flex-shrink-0" />;
  if (status === 'failed') return <AlertCircle size={12} className="text-red-500 flex-shrink-0" />;
  return <Minus size={12} className="text-gray-400 flex-shrink-0" />;
}

// ─── Task 行 ──────────────────────────────────────────────────────────────────

function TaskRow({ task }: { task: Task }) {
  const [show, setShow] = useState(false);
  return (
    <div className="border border-gray-100 rounded p-2 bg-white hover:border-gray-200 transition-colors">
      <div className="flex items-start gap-2 cursor-pointer" onClick={() => setShow(v => !v)}>
        <TaskStatusIcon status={task.status} />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-gray-700 truncate">{task.title}</p>
          {task.pr_title && (
            <p className="text-xs text-gray-400 truncate mt-0.5">
              PR: {task.pr_title}
            </p>
          )}
        </div>
        {task.self_score && (
          <span className="text-xs text-orange-600 font-medium flex-shrink-0">{task.self_score}/10</span>
        )}
        {(task.learning_summary || task.pr_url) && (
          <ChevronDown size={12} className={`text-gray-400 flex-shrink-0 transition-transform ${show ? 'rotate-180' : ''}`} />
        )}
      </div>
      {show && (task.learning_summary || task.pr_url) && (
        <div className="mt-2 pt-2 border-t border-gray-100 space-y-1">
          {task.learning_summary && (
            <p className="text-xs text-gray-600 bg-blue-50 rounded px-2 py-1">{task.learning_summary}</p>
          )}
          {task.pr_url && (
            <a href={task.pr_url} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs text-blue-500 hover:underline">
              <ExternalLink size={10} /> 查看 PR
            </a>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Initiative 节点 ──────────────────────────────────────────────────────────

function InitiativeNode({ ini }: { ini: Initiative }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="ml-4 border-l border-gray-100 pl-3">
      <div
        className="flex items-center gap-2 py-1 cursor-pointer hover:bg-gray-50 rounded px-1 -ml-1 group"
        onClick={() => setOpen(v => !v)}
      >
        <GitBranch size={12} className="text-purple-400 flex-shrink-0" />
        <span className="text-xs font-medium text-gray-700 flex-1 min-w-0 truncate">{ini.title}</span>
        <StatusBadge status={ini.status} />
        <ProgressBar completed={ini.task_completed} total={ini.task_total} />
        {ini.task_total > 0 && (
          <ChevronRight size={12} className={`text-gray-400 flex-shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
        )}
      </div>
      {open && ini.tasks.length > 0 && (
        <div className="ml-4 mt-1 space-y-1 pb-1">
          {ini.tasks.map(t => <TaskRow key={t.id} task={t} />)}
        </div>
      )}
    </div>
  );
}

// ─── Scope 节点 ───────────────────────────────────────────────────────────────

function ScopeNode({ scope }: { scope: Scope }) {
  const [open, setOpen] = useState(false);
  const total = scope.initiatives.reduce((s, i) => s + i.task_total, 0);
  const completed = scope.initiatives.reduce((s, i) => s + i.task_completed, 0);
  return (
    <div className="ml-4 border-l border-gray-100 pl-3">
      <div
        className="flex items-center gap-2 py-1 cursor-pointer hover:bg-gray-50 rounded px-1 -ml-1"
        onClick={() => setOpen(v => !v)}
      >
        <Layers size={12} className="text-orange-400 flex-shrink-0" />
        <span className="text-xs text-gray-600 flex-1 min-w-0 truncate">{scope.title}</span>
        <StatusBadge status={scope.status} />
        <ProgressBar completed={completed} total={total} />
        <ChevronRight size={12} className={`text-gray-400 flex-shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
      </div>
      {open && (
        <div className="mt-0.5">
          {scope.initiatives.length === 0
            ? <p className="ml-4 text-xs text-gray-400 py-0.5">无 Initiative</p>
            : scope.initiatives.map(ini => <InitiativeNode key={ini.id} ini={ini} />)
          }
        </div>
      )}
    </div>
  );
}

// ─── Project 节点 ─────────────────────────────────────────────────────────────

function ProjectNode({ proj }: { proj: Project }) {
  const [open, setOpen] = useState(false);
  const total = proj.scopes.reduce((s, sc) => s + sc.initiatives.reduce((a, i) => a + i.task_total, 0), 0);
  const completed = proj.scopes.reduce((s, sc) => s + sc.initiatives.reduce((a, i) => a + i.task_completed, 0), 0);
  return (
    <div className="ml-4 border-l border-gray-100 pl-3">
      <div
        className="flex items-center gap-2 py-1 cursor-pointer hover:bg-gray-50 rounded px-1 -ml-1"
        onClick={() => setOpen(v => !v)}
      >
        <div className="w-2 h-2 rounded-sm bg-blue-300 flex-shrink-0" />
        <span className="text-xs text-gray-600 flex-1 min-w-0 truncate">{proj.title}</span>
        <StatusBadge status={proj.status} />
        <ProgressBar completed={completed} total={total} />
        <ChevronRight size={12} className={`text-gray-400 flex-shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
      </div>
      {open && (
        <div className="mt-0.5">
          {proj.scopes.length === 0
            ? <p className="ml-4 text-xs text-gray-400 py-0.5">无 Scope</p>
            : proj.scopes.map(sc => <ScopeNode key={sc.id} scope={sc} />)
          }
        </div>
      )}
    </div>
  );
}

// ─── KR 节点 ──────────────────────────────────────────────────────────────────

function KRNode({ kr }: { kr: KR }) {
  const [open, setOpen] = useState(false);
  const total = kr.projects.reduce((s, p) => s + p.scopes.reduce((a, sc) => a + sc.initiatives.reduce((b, i) => b + i.task_total, 0), 0), 0);
  const completed = kr.projects.reduce((s, p) => s + p.scopes.reduce((a, sc) => a + sc.initiatives.reduce((b, i) => b + i.task_completed, 0), 0), 0);

  return (
    <div className="mb-1">
      <div
        className="flex items-center gap-2 py-1.5 cursor-pointer hover:bg-gray-50 rounded px-2 group"
        onClick={() => setOpen(v => !v)}
      >
        <ChevronRight size={14} className={`text-gray-400 flex-shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
        <div className="w-2 h-2 rounded-full bg-green-400 flex-shrink-0" />
        <span className="text-sm text-gray-700 flex-1 min-w-0 truncate">{kr.title}</span>
        {kr.target_value && kr.current_value !== undefined && (
          <span className="text-xs text-gray-400 flex-shrink-0">
            {kr.current_value}/{kr.target_value} {kr.unit || ''}
          </span>
        )}
        <StatusBadge status={kr.status} />
        <ProgressBar completed={completed} total={total} />
      </div>
      {open && (
        <div className="mt-0.5">
          {kr.projects.length === 0
            ? <p className="ml-8 text-xs text-gray-400 py-0.5">无 Project</p>
            : kr.projects.map(p => <ProjectNode key={p.id} proj={p} />)
          }
        </div>
      )}
    </div>
  );
}

// ─── Objective 节点 ───────────────────────────────────────────────────────────

function ObjectiveNode({ obj }: { obj: Objective }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="mb-3 border border-gray-200 rounded-lg overflow-hidden">
      <div
        className="flex items-center gap-2 p-3 bg-gray-50 cursor-pointer hover:bg-gray-100"
        onClick={() => setOpen(v => !v)}
      >
        <ChevronDown size={16} className={`text-gray-400 flex-shrink-0 transition-transform ${open ? '' : '-rotate-90'}`} />
        <Target size={16} className="text-blue-500 flex-shrink-0" />
        <span className="text-sm font-semibold text-gray-800 flex-1 min-w-0 truncate">{obj.title}</span>
        <StatusBadge status={obj.status} />
        {obj.priority && (
          <span className="text-xs text-gray-400">{obj.priority}</span>
        )}
      </div>
      {open && (
        <div className="p-2 bg-white">
          {obj.key_results.length === 0
            ? <p className="text-xs text-gray-400 py-2 px-2">无 Key Result</p>
            : obj.key_results.map(kr => <KRNode key={kr.id} kr={kr} />)
          }
        </div>
      )}
    </div>
  );
}

// ─── Area 节点 ────────────────────────────────────────────────────────────────

function AreaSection({ area }: { area: Area }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="mb-6">
      <div
        className="flex items-center gap-2 mb-3 cursor-pointer group"
        onClick={() => setOpen(v => !v)}
      >
        <ChevronDown size={18} className={`text-gray-500 transition-transform ${open ? '' : '-rotate-90'}`} />
        <h2 className="text-base font-bold text-gray-900">{area.name}</h2>
        {area.domain && (
          <span className="text-xs text-gray-400 bg-gray-100 px-1.5 rounded">{area.domain}</span>
        )}
        <span className="text-xs text-gray-400">
          {area.objectives.length} 个目标
        </span>
      </div>
      {open && (
        <div>
          {area.objectives.length === 0
            ? <p className="text-sm text-gray-400 py-4 text-center">该 Area 下暂无 Objective</p>
            : area.objectives.map(obj => <ObjectiveNode key={obj.id} obj={obj} />)
          }
        </div>
      )}
    </div>
  );
}

// ─── 主页面 ───────────────────────────────────────────────────────────────────

export default function StrategyTree() {
  const { data, loading, error } = useApi<{ success: boolean; data: Area[] }>(
    '/api/brain/strategy-tree',
    { staleTime: 60_000 }
  );

  const areas = data?.data || [];
  const totalObjectives = areas.reduce((s, a) => s + a.objectives.length, 0);
  const totalKRs = areas.reduce((s, a) => s + a.objectives.reduce((o, obj) => o + obj.key_results.length, 0), 0);

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="flex items-center gap-3 mb-8">
        <Target size={24} className="text-blue-600" />
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Strategy Tree</h1>
          <p className="text-sm text-gray-500">
            OKR 全链路视图 · {areas.length} 个 Area · {totalObjectives} 个目标 · {totalKRs} 个 KR
          </p>
        </div>
      </div>

      {loading && (
        <div className="text-center py-16 text-gray-400">加载中...</div>
      )}

      {error && (
        <div className="text-center py-16 text-red-400">
          <AlertCircle size={36} className="mx-auto mb-2 opacity-50" />
          <p className="text-sm">加载失败：{String(error)}</p>
        </div>
      )}

      {!loading && !error && areas.length === 0 && (
        <div className="text-center py-16 text-gray-400">
          <Target size={40} className="mx-auto mb-3 opacity-30" />
          <p>暂无 OKR 数据</p>
          <p className="text-xs mt-1">从 OKR 管理页面创建 Area 和 Objective 开始</p>
        </div>
      )}

      {areas.map(area => <AreaSection key={area.id} area={area} />)}
    </div>
  );
}
