import { useState } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';
import { useApi } from '../../shared/hooks/useApi';

interface Task {
  id: string;
  title: string;
  status: string;
  branch?: string;
  pr_url?: string;
  pr_title?: string;
  learning_summary?: string;
}

interface Initiative {
  id: string;
  title: string;
  status: string;
  total_tasks: number;
  completed_tasks: number;
  progress: number;
  tasks: Task[];
}

interface Scope {
  id: string;
  title: string;
  status: string;
  total_tasks: number;
  completed_tasks: number;
  progress: number;
  initiatives: Initiative[];
}

interface Project {
  id: string;
  title: string;
  status: string;
  total_tasks: number;
  completed_tasks: number;
  progress: number;
  scopes: Scope[];
}

interface KeyResult {
  id: string;
  title: string;
  status: string;
  total_tasks: number;
  completed_tasks: number;
  progress: number;
  projects: Project[];
}

interface Objective {
  id: string;
  title: string;
  status: string;
  total_tasks: number;
  completed_tasks: number;
  progress: number;
  key_results: KeyResult[];
}

interface Area {
  id: string;
  name: string;
  status: string;
  total_tasks: number;
  completed_tasks: number;
  progress: number;
  objectives: Objective[];
}

interface TreeResponse {
  success: boolean;
  areas: Area[];
}

function progressColor(p: number) {
  if (p >= 70) return 'bg-green-500';
  if (p >= 30) return 'bg-yellow-500';
  return 'bg-red-400';
}

function ProgressBar({ progress }: { progress: number }) {
  return (
    <div className="flex items-center gap-2 mt-1">
      <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${progressColor(progress)}`}
          style={{ width: `${progress}%` }}
        />
      </div>
      <span className="text-xs text-gray-500 w-8 text-right">{progress}%</span>
    </div>
  );
}

function TaskRow({ task }: { task: Task }) {
  const [open, setOpen] = useState(false);
  const isDone = ['done', 'completed', 'merged', 'shipped'].includes(task.status);
  return (
    <div className="ml-4">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1 py-1 text-left w-full hover:text-blue-600 transition-colors"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span className={`text-xs ${isDone ? 'line-through text-gray-400' : 'text-gray-700'}`}>
          {task.title}
        </span>
        <span className={`ml-1 px-1 rounded text-xs ${isDone ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
          {task.status}
        </span>
      </button>
      {open && (
        <div className="ml-4 pl-2 border-l border-gray-200 py-1 space-y-1">
          {task.pr_title && <p className="text-xs text-gray-600">PR: {task.pr_title}</p>}
          {task.pr_url && (
            <a href={task.pr_url} target="_blank" rel="noreferrer" className="text-xs text-blue-500 hover:underline">
              {task.pr_url}
            </a>
          )}
          {task.learning_summary && (
            <p className="text-xs text-gray-500 italic">{task.learning_summary}</p>
          )}
        </div>
      )}
    </div>
  );
}

function InitiativeNode({ init, defaultOpen }: { init: Initiative; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="ml-4 border-l border-gray-100 pl-2">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-start gap-1 py-1.5 text-left w-full hover:text-blue-600 transition-colors"
      >
        {open ? <ChevronDown size={13} className="mt-0.5 shrink-0" /> : <ChevronRight size={13} className="mt-0.5 shrink-0" />}
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium text-gray-700">{init.title}</span>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-xs text-gray-400">{init.completed_tasks}/{init.total_tasks} tasks</span>
          </div>
          <ProgressBar progress={init.progress} />
        </div>
      </button>
      {open && init.tasks.length > 0 && (
        <div className="mt-1 mb-2">
          {init.tasks.map(task => <TaskRow key={task.id} task={task} />)}
        </div>
      )}
    </div>
  );
}

function ScopeNode({ scope }: { scope: Scope }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="ml-4 border-l border-gray-100 pl-2">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-start gap-1 py-1.5 text-left w-full hover:text-blue-600 transition-colors"
      >
        {open ? <ChevronDown size={13} className="mt-0.5 shrink-0" /> : <ChevronRight size={13} className="mt-0.5 shrink-0" />}
        <div className="flex-1 min-w-0">
          <span className="text-sm text-gray-600">{scope.title}</span>
          <ProgressBar progress={scope.progress} />
        </div>
      </button>
      {open && scope.initiatives.map(init => (
        <InitiativeNode key={init.id} init={init} defaultOpen={false} />
      ))}
    </div>
  );
}

function ProjectNode({ project }: { project: Project }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="ml-4 border-l border-gray-100 pl-2">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-start gap-1 py-1.5 text-left w-full hover:text-blue-600 transition-colors"
      >
        {open ? <ChevronDown size={13} className="mt-0.5 shrink-0" /> : <ChevronRight size={13} className="mt-0.5 shrink-0" />}
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium text-gray-600">{project.title}</span>
          <ProgressBar progress={project.progress} />
        </div>
      </button>
      {open && project.scopes.map(scope => (
        <ScopeNode key={scope.id} scope={scope} />
      ))}
    </div>
  );
}

function KRNode({ kr }: { kr: KeyResult }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="ml-4 border-l border-blue-100 pl-2">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-start gap-1 py-2 text-left w-full hover:text-blue-600 transition-colors"
      >
        {open ? <ChevronDown size={14} className="mt-0.5 shrink-0 text-blue-400" /> : <ChevronRight size={14} className="mt-0.5 shrink-0 text-blue-400" />}
        <div className="flex-1 min-w-0">
          <span className="text-sm font-semibold text-gray-700">{kr.title}</span>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-xs text-gray-400">{kr.completed_tasks}/{kr.total_tasks} tasks</span>
          </div>
          <ProgressBar progress={kr.progress} />
        </div>
      </button>
      {open && kr.projects.map(proj => (
        <ProjectNode key={proj.id} project={proj} />
      ))}
    </div>
  );
}

function ObjectiveNode({ obj }: { obj: Objective }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="ml-4 border-l border-indigo-100 pl-3">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-start gap-1 py-2 text-left w-full hover:text-indigo-600 transition-colors"
      >
        {open ? <ChevronDown size={15} className="mt-0.5 shrink-0 text-indigo-400" /> : <ChevronRight size={15} className="mt-0.5 shrink-0 text-indigo-400" />}
        <div className="flex-1 min-w-0">
          <span className="text-base font-semibold text-gray-800">{obj.title}</span>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-xs text-gray-400">{obj.completed_tasks}/{obj.total_tasks} tasks</span>
          </div>
          <ProgressBar progress={obj.progress} />
        </div>
      </button>
      {open && obj.key_results.map(kr => (
        <KRNode key={kr.id} kr={kr} />
      ))}
    </div>
  );
}

function AreaNode({ area }: { area: Area }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="bg-white border border-gray-200 rounded-xl mb-4 overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 w-full px-4 py-3 hover:bg-gray-50 transition-colors text-left"
      >
        {open ? <ChevronDown size={16} className="text-gray-500 shrink-0" /> : <ChevronRight size={16} className="text-gray-500 shrink-0" />}
        <div className="flex-1 min-w-0">
          <span className="text-base font-bold text-gray-900">{area.name}</span>
          <span className="ml-2 text-xs text-gray-400">{area.completed_tasks}/{area.total_tasks} tasks</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="w-24 h-2 bg-gray-200 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full ${progressColor(area.progress)}`}
              style={{ width: `${area.progress}%` }}
            />
          </div>
          <span className="text-sm font-medium text-gray-600 w-10 text-right">{area.progress}%</span>
        </div>
      </button>
      {open && (
        <div className="px-2 pb-3">
          {area.objectives.map(obj => (
            <ObjectiveNode key={obj.id} obj={obj} />
          ))}
          {area.objectives.length === 0 && (
            <p className="text-xs text-gray-400 py-2 pl-4">暂无 Objective</p>
          )}
        </div>
      )}
    </div>
  );
}

export default function StrategyTree() {
  const { data, loading, error } = useApi<TreeResponse>('/api/brain/strategy-tree');

  if (loading) {
    return (
      <div className="p-8 text-center text-gray-400">加载中...</div>
    );
  }

  if (error || !data?.success) {
    return (
      <div className="p-8 text-center text-red-400">加载失败，请稍后重试</div>
    );
  }

  const areas = data.areas || [];

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Strategy Tree</h1>
        <p className="text-sm text-gray-500 mt-1">OKR 全链路可视化 — Area → Objective → KR → Project → Scope → Initiative → Tasks</p>
      </div>

      {areas.length === 0 ? (
        <div className="text-center py-12 text-gray-400">暂无数据</div>
      ) : (
        areas.map(area => <AreaNode key={area.id} area={area} />)
      )}
    </div>
  );
}
