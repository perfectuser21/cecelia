import { useState, useEffect, useCallback } from 'react';
import {
  RefreshCw,
  Target,
  FolderKanban,
  ListTodo,
  ChevronRight,
  ChevronDown,
  X,
  Cpu,
  Server
} from 'lucide-react';
import ProgressBar from '../../shared/components/ProgressBar';
import StatusIcon from '../../shared/components/StatusIcon';
import PriorityBadge from '../../shared/components/PriorityBadge';

// Types
interface KeyResult {
  id: string;
  title: string;
  progress: number;
  weight: number;
  status: string;
}

interface Objective {
  id: string;
  title: string;
  status: string;
  priority: string;
  progress: number;
  description?: string;
  keyResults: KeyResult[];
  projects?: Project[];
}

interface Project {
  id: string;
  name: string;
  status: string;
  description?: string;
  repo_path?: string;
  goal_id?: string;
  tasks?: Task[];
}

interface Task {
  id: string;
  title: string;
  priority: string;
  status: string;
  description?: string;
  goal_id?: string;
  project_id?: string;
}

interface Worker {
  id: string;
  name: string;
  status: 'running' | 'idle' | 'error';
  project?: string;
  task?: string;
  started_at?: string;
}

interface AutumnriceSeat {
  id: number;
  status: 'running' | 'idle';
  task_id?: string;
  started_at?: string;
}

interface AutumnriceSeatsResponse {
  max_seats: number;
  active_seats: number;
  available_seats: number;
  can_spawn_more: boolean;
  seats: AutumnriceSeat[];
}

type DetailType = 'okr' | 'project' | 'task' | null;
interface DetailView {
  type: DetailType;
  data: any;
}

interface Block {
  id: string;
  type: 'heading' | 'text' | 'bullet' | 'numbered' | 'todo' | 'divider' | 'code';
  content: string;
  checked?: boolean;
}

function BlockRenderer({ blocks }: { blocks: Block[] }) {
  if (!blocks || blocks.length === 0) return null;
  return (
    <div className="space-y-1 mt-2">
      {blocks.map((block, idx) => {
        switch (block.type) {
          case 'heading':
            return <h4 key={block.id || idx} className="text-sm font-semibold text-slate-900 dark:text-white pt-2">{block.content}</h4>;
          case 'text':
            return <p key={block.id || idx} className="text-sm text-slate-600 dark:text-slate-300">{block.content}</p>;
          case 'bullet':
            return <div key={block.id || idx} className="flex gap-2 text-sm text-slate-600 dark:text-slate-300"><span>•</span><span>{block.content}</span></div>;
          default:
            return <p key={block.id || idx} className="text-sm text-slate-600 dark:text-slate-300">{block.content}</p>;
        }
      })}
    </div>
  );
}

export default function OrchestratorPage() {
  const [objectives, setObjectives] = useState<Objective[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [seatsData, setSeatsData] = useState<AutumnriceSeatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedOKRs, setExpandedOKRs] = useState<Set<string>>(new Set());
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<DetailView>({ type: null, data: null });

  const fetchData = useCallback(async () => {
    try {
      const [goalsRes, projectsRes, tasksRes, seatsRes] = await Promise.all([
        fetch('/api/tasks/goals'),
        fetch('/api/tasks/projects'),
        fetch('/api/tasks/tasks?limit=50'),
        fetch('/api/autumnrice/seats')
      ]);

      const [goals, projectsData, tasksData, seats] = await Promise.all([
        goalsRes.json(),
        projectsRes.json(),
        tasksRes.json(),
        seatsRes.json()
      ]);

      setSeatsData(seats);

      const objectivesMap = new Map<string, Objective>();
      const keyResults: any[] = [];

      goals.forEach((g: any) => {
        if (g.type === 'key_result' || g.parent_id) {
          keyResults.push(g);
        } else {
          objectivesMap.set(g.id, {
            id: g.id,
            title: g.title,
            status: g.status,
            priority: g.priority || 'P2',
            progress: g.progress || 0,
            description: g.description,
            keyResults: [],
            projects: []
          });
        }
      });

      keyResults.forEach(kr => {
        const obj = objectivesMap.get(kr.parent_id);
        if (obj) {
          obj.keyResults.push({
            id: kr.id,
            title: kr.title,
            progress: kr.progress || 0,
            weight: parseFloat(kr.weight) || 0,
            status: kr.status
          });
        }
      });

      projectsData.forEach((p: any) => {
        if (p.goal_id) {
          const obj = objectivesMap.get(p.goal_id);
          if (obj) {
            obj.projects = obj.projects || [];
            obj.projects.push(p);
          }
        }
      });

      setObjectives(Array.from(objectivesMap.values()));
      setProjects(projectsData);
      setTasks(tasksData);

      if (seats && seats.seats) {
        setWorkers(seats.seats.map((s: AutumnriceSeat) => ({
          id: String(s.id),
          name: `Seat ${s.id}`,
          status: s.status === 'running' ? 'running' : 'idle',
          task: s.task_id,
          started_at: s.started_at
        })));
      }
    } catch (error) {
      console.error('Failed to fetch data:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const toggleOKR = (id: string) => {
    setExpandedOKRs(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleProject = (id: string) => {
    setExpandedProjects(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const openDetail = useCallback(async (type: DetailType, data: any) => {
    try {
      const res = await fetch('/api/orchestrator/realtime/tool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool_name: 'open_detail', arguments: { type, id: data.id } })
      });
      const result = await res.json();
      if (result.success && result.result?.data) {
        setDetail({ type, data: result.result.data });
      } else {
        setDetail({ type, data });
      }
    } catch {
      setDetail({ type, data });
    }
  }, []);

  const closeDetail = () => setDetail({ type: null, data: null });


  if (loading) {
    return <div className="flex items-center justify-center h-64"><RefreshCw className="w-8 h-8 animate-spin text-slate-400" /></div>;
  }

  const runningWorkers = seatsData?.active_seats ?? workers.filter(w => w.status === 'running').length;
  const totalCapacity = seatsData?.max_seats ?? 3;

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] gap-3">
      {/* Top: Compact Status Bar */}
      <div className="flex gap-3 flex-shrink-0 h-14">
        {/* Worker Seats */}
        <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-2 flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Cpu className="w-4 h-4 text-violet-500" />
            <span className="text-xs text-slate-500">Seats</span>
          </div>
          <div className="flex gap-1">
            {[...Array(totalCapacity)].map((_, i) => (
              <div
                key={i}
                className={`w-6 h-6 rounded flex items-center justify-center text-[10px] font-medium ${
                  i < runningWorkers
                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-400'
                    : 'bg-slate-100 text-slate-400 dark:bg-slate-700'
                }`}
                title={workers[i]?.name || `Seat ${i + 1}`}
              >
                {i < runningWorkers ? '●' : '○'}
              </div>
            ))}
          </div>
          <span className="text-xs text-slate-600 dark:text-slate-400">{runningWorkers}/{totalCapacity} active</span>
        </div>

        {/* Quick Stats */}
        <div className="flex-1 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-2 flex items-center gap-6">
          <div className="flex items-center gap-2">
            <Target className="w-4 h-4 text-emerald-500" />
            <span className="text-sm font-medium text-slate-900 dark:text-white">{objectives.length}</span>
            <span className="text-xs text-slate-400">OKRs</span>
          </div>
          <div className="flex items-center gap-2">
            <FolderKanban className="w-4 h-4 text-blue-500" />
            <span className="text-sm font-medium text-slate-900 dark:text-white">{projects.length}</span>
            <span className="text-xs text-slate-400">Projects</span>
          </div>
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-amber-500" />
            <span className="text-sm font-medium text-slate-900 dark:text-white">{tasks.filter(t => t.status === 'in_progress').length}</span>
            <span className="text-xs text-slate-400">Active</span>
          </div>
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
            <span className="text-sm font-medium text-slate-900 dark:text-white">{tasks.filter(t => t.status === 'completed').length}</span>
            <span className="text-xs text-slate-400">Done</span>
          </div>
        </div>

        {/* VPS Status */}
        <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-2 flex items-center gap-3">
          <Server className="w-4 h-4 text-slate-400" />
          <div className="text-xs">
            <div className="text-slate-900 dark:text-white font-medium">VPS</div>
            <div className="text-slate-400">4C/8G</div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex gap-3 flex-1 min-h-0">
        {/* Left: OKR Tree */}
        <div className="w-80 flex-shrink-0 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 flex flex-col">
          <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-100 dark:border-slate-700">
            <Target className="w-4 h-4 text-emerald-500" />
            <span className="font-medium text-sm text-slate-900 dark:text-white">OKR Hierarchy</span>
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {objectives.map(obj => (
              <div key={obj.id} className="mb-1">
                <div
                  onClick={() => toggleOKR(obj.id)}
                  className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-slate-50 dark:hover:bg-slate-700/50 cursor-pointer"
                >
                  {expandedOKRs.has(obj.id) ?
                    <ChevronDown className="w-3.5 h-3.5 text-slate-400" /> :
                    <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                  }
                  <Target className="w-3.5 h-3.5 text-emerald-500" />
                  <span className="text-sm text-slate-900 dark:text-white flex-1 truncate">{obj.title}</span>
                  <PriorityBadge priority={obj.priority} size="sm" />
                </div>

                {expandedOKRs.has(obj.id) && (
                  <div className="ml-5 border-l border-slate-200 dark:border-slate-700 pl-2">
                    {obj.keyResults.map(kr => (
                      <div
                        key={kr.id}
                        onClick={() => openDetail('okr', kr)}
                        className="flex items-center gap-2 px-2 py-1 hover:bg-slate-50 dark:hover:bg-slate-700/50 cursor-pointer rounded"
                      >
                        <StatusIcon status={kr.status} size="sm" />
                        <span className="text-xs text-slate-700 dark:text-slate-300 flex-1 truncate">{kr.title}</span>
                        <div className="flex items-center gap-1">
                          <div className="w-10 h-1 bg-slate-100 dark:bg-slate-600 rounded-full">
                            <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${kr.progress}%` }} />
                          </div>
                          <span className="text-[10px] text-slate-400 w-7">{kr.progress}%</span>
                        </div>
                      </div>
                    ))}

                    {obj.projects && obj.projects.length > 0 && (
                      <div className="mt-1 pt-1 border-t border-slate-100 dark:border-slate-700/50">
                        {obj.projects.map(p => (
                          <div
                            key={p.id}
                            onClick={() => openDetail('project', p)}
                            className="flex items-center gap-2 px-2 py-1 hover:bg-slate-50 dark:hover:bg-slate-700/50 cursor-pointer rounded"
                          >
                            <FolderKanban className="w-3 h-3 text-blue-500" />
                            <span className="text-xs text-slate-600 dark:text-slate-400 truncate">{p.name}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Middle: Projects & Tasks */}
        <div className="flex-1 flex flex-col gap-3 min-w-0">
          {/* Projects */}
          <div className="flex-1 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 flex flex-col min-h-0">
            <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-100 dark:border-slate-700">
              <FolderKanban className="w-4 h-4 text-blue-500" />
              <span className="font-medium text-sm text-slate-900 dark:text-white">Projects</span>
              <span className="text-xs text-slate-400 ml-auto">{projects.length}</span>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {projects.map(p => {
                const projectTasks = tasks.filter(t => t.project_id === p.id);
                return (
                  <div key={p.id} className="mb-1">
                    <div
                      onClick={() => projectTasks.length > 0 ? toggleProject(p.id) : openDetail('project', p)}
                      className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-slate-50 dark:hover:bg-slate-700/50 cursor-pointer"
                    >
                      {projectTasks.length > 0 ? (
                        expandedProjects.has(p.id) ?
                          <ChevronDown className="w-3.5 h-3.5 text-slate-400" /> :
                          <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                      ) : <span className="w-3.5" />}
                      <FolderKanban className="w-3.5 h-3.5 text-blue-500" />
                      <span className="text-sm text-slate-900 dark:text-white flex-1 truncate">{p.name}</span>
                      {projectTasks.length > 0 && (
                        <span className="text-[10px] text-slate-400">{projectTasks.length} tasks</span>
                      )}
                    </div>

                    {expandedProjects.has(p.id) && projectTasks.length > 0 && (
                      <div className="ml-5 border-l border-slate-200 dark:border-slate-700 pl-2">
                        {projectTasks.map(t => (
                          <div
                            key={t.id}
                            onClick={() => openDetail('task', t)}
                            className="flex items-center gap-2 px-2 py-1 hover:bg-slate-50 dark:hover:bg-slate-700/50 cursor-pointer rounded"
                          >
                            <StatusIcon status={t.status} size="sm" />
                            <PriorityBadge priority={t.priority} size="sm" />
                            <span className="text-xs text-slate-700 dark:text-slate-300 truncate">{t.title}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Active Tasks */}
          <div className="h-40 flex-shrink-0 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 flex flex-col">
            <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-100 dark:border-slate-700">
              <ListTodo className="w-4 h-4 text-amber-500" />
              <span className="font-medium text-sm text-slate-900 dark:text-white">Active Tasks</span>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {tasks.filter(t => t.status === 'in_progress' || t.status === 'queued').slice(0, 10).map(t => (
                <div
                  key={t.id}
                  onClick={() => openDetail('task', t)}
                  className="flex items-center gap-2 px-2 py-1 hover:bg-slate-50 dark:hover:bg-slate-700/50 cursor-pointer rounded"
                >
                  <StatusIcon status={t.status} size="sm" />
                  <PriorityBadge priority={t.priority} size="sm" />
                  <span className="text-xs text-slate-900 dark:text-white truncate flex-1">{t.title}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Detail Panel */}
        {detail.type && (
          <div className="w-80 flex-shrink-0 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 flex flex-col overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100 dark:border-slate-700">
              {detail.type === 'okr' && <Target className="w-5 h-5 text-emerald-500" />}
              {detail.type === 'project' && <FolderKanban className="w-5 h-5 text-blue-500" />}
              {detail.type === 'task' && <ListTodo className="w-5 h-5 text-amber-500" />}
              <span className="font-semibold text-slate-900 dark:text-white flex-1 truncate">
                {detail.data?.title || detail.data?.name}
              </span>
              <button onClick={closeDetail} className="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded">
                <X className="w-4 h-4 text-slate-400" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {detail.data.status && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500 w-16">Status</span>
                  <span className={`px-2 py-0.5 text-xs rounded-full ${
                    detail.data.status === 'completed' ? 'bg-emerald-100 text-emerald-700' :
                    detail.data.status === 'in_progress' ? 'bg-amber-100 text-amber-700' :
                    'bg-slate-100 text-slate-600'
                  }`}>{detail.data.status}</span>
                </div>
              )}
              {detail.data.priority && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500 w-16">Priority</span>
                  <PriorityBadge priority={detail.data.priority} />
                </div>
              )}
              {detail.data.progress !== undefined && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500 w-16">Progress</span>
                  <div className="flex-1 h-2 bg-slate-100 dark:bg-slate-700 rounded-full">
                    <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${detail.data.progress}%` }} />
                  </div>
                  <span className="text-xs text-slate-600">{detail.data.progress}%</span>
                </div>
              )}
              {detail.data.description && (
                <div className="pt-2 border-t border-slate-100 dark:border-slate-700">
                  <span className="text-xs text-slate-500">Description</span>
                  <p className="text-sm text-slate-700 dark:text-slate-300 mt-1">{detail.data.description}</p>
                </div>
              )}
              {detail.data.content && detail.data.content.length > 0 && (
                <div className="pt-2 border-t border-slate-100 dark:border-slate-700">
                  <span className="text-xs text-slate-500">Content</span>
                  <BlockRenderer blocks={detail.data.content} />
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
