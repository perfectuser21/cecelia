/**
 * RoadmapPage — OKR 进度 + Now/Next/Later + Cecelia 思考 + Agent 状态
 *
 * 数据来源：
 * - GET /api/brain/goals — KR 进度
 * - GET /api/brain/projects — Projects（按 current_phase/status 分组）
 * - GET /api/brain/self-drive/latest — Cecelia 最近思考
 * - GET /api/brain/tasks/tasks?status=in_progress — Agent 当前任务
 * - GET /api/brain/tick/status — Tick 状态
 */

import { useEffect, useState, useCallback } from 'react';
import {
  Brain,
  Target,
  RefreshCw,
  Clock,
  Zap,
  ArrowRight,
  CheckCircle2,
  AlertCircle,
  Bot,
  Lightbulb,
  TrendingUp,
  Pause,
  XCircle,
} from 'lucide-react';
import axios from 'axios';

// ============ 类型定义 ============

interface Goal {
  id: string;
  title: string;
  type: string;
  status: string;
  progress: number;
  parent_id: string | null;
  weight: string;
}

interface Project {
  id: string;
  name: string;
  status: string;
  type: string;
  current_phase: string | null;
  description: string | null;
  kr_id: string | null;
  area_id: string | null;
}

interface SelfDriveEvent {
  id: string;
  created_at: string;
  reasoning: string;
  tasks_created: number;
  adjustments_executed: number;
  tasks: Array<{ taskId: string; title: string }>;
  adjustments: Array<{ type: string; reason: string }>;
}

interface AgentTask {
  id: string;
  title: string;
  status: string;
  priority: string;
  task_type: string;
  started_at: string | null;
  assigned_to: string | null;
}

interface TickStatus {
  loop_running: boolean;
  enabled: boolean;
  last_tick: string | null;
  max_concurrent: number;
}

// ============ 工具函数 ============

function timeAgo(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffMin < 1) return '刚刚';
  if (diffMin < 60) return `${diffMin}分钟前`;
  if (diffHour < 24) return `${diffHour}小时前`;
  return `${diffDay}天前`;
}

function getPhaseForProject(project: Project): 'now' | 'next' | 'later' {
  // 优先使用 current_phase
  if (project.current_phase) {
    const phase = project.current_phase.toLowerCase();
    if (phase === 'now') return 'now';
    if (phase === 'next') return 'next';
    if (phase === 'later') return 'later';
  }
  // 回退到 status 映射
  if (project.status === 'in_progress' || project.status === 'active') return 'now';
  if (project.status === 'pending' || project.status === 'queued') return 'next';
  return 'later';
}

function getStatusColor(status: string): string {
  switch (status) {
    case 'in_progress':
    case 'active':
      return 'bg-blue-500/20 text-blue-400';
    case 'pending':
    case 'queued':
      return 'bg-amber-500/20 text-amber-400';
    case 'completed':
    case 'done':
      return 'bg-green-500/20 text-green-400';
    case 'cancelled':
      return 'bg-red-500/20 text-red-400';
    case 'paused':
      return 'bg-gray-500/20 text-gray-400';
    default:
      return 'bg-slate-500/20 text-slate-400';
  }
}

function getPriorityColor(priority: string): string {
  switch (priority) {
    case 'P0':
      return 'bg-red-500/20 text-red-400';
    case 'P1':
      return 'bg-amber-500/20 text-amber-400';
    case 'P2':
      return 'bg-blue-500/20 text-blue-400';
    default:
      return 'bg-slate-500/20 text-slate-400';
  }
}

// ============ 子组件 ============

function CeceliaThinking({ event }: { event: SelfDriveEvent | null }) {
  if (!event) {
    return (
      <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 p-6">
        <div className="flex items-center gap-3 mb-3">
          <div className="p-2 bg-purple-500/20 rounded-lg">
            <Brain className="w-5 h-5 text-purple-400" />
          </div>
          <h2 className="text-lg font-semibold text-white">Cecelia 最近的思考</h2>
        </div>
        <p className="text-gray-500 text-sm italic">暂无 SelfDrive 思考记录</p>
      </div>
    );
  }

  return (
    <div className="bg-gradient-to-r from-slate-800/80 to-purple-900/20 rounded-xl border border-purple-500/20 p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-purple-500/20 rounded-lg">
            <Brain className="w-5 h-5 text-purple-400" />
          </div>
          <h2 className="text-lg font-semibold text-white">Cecelia 最近的思考</h2>
        </div>
        <div className="flex items-center gap-4 text-sm text-gray-400">
          <span className="flex items-center gap-1">
            <Clock className="w-3.5 h-3.5" />
            {timeAgo(event.created_at)}
          </span>
        </div>
      </div>

      {/* Reasoning */}
      {event.reasoning && (
        <div className="bg-slate-900/50 rounded-lg p-4 mb-4">
          <div className="flex items-start gap-2">
            <Lightbulb className="w-4 h-4 text-yellow-400 mt-0.5 shrink-0" />
            <p className="text-gray-300 text-sm leading-relaxed whitespace-pre-wrap">
              {event.reasoning}
            </p>
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="flex items-center gap-6 text-sm">
        {event.tasks_created > 0 && (
          <span className="flex items-center gap-1.5 text-cyan-400">
            <Zap className="w-3.5 h-3.5" />
            创建了 {event.tasks_created} 个任务
          </span>
        )}
        {event.adjustments_executed > 0 && (
          <span className="flex items-center gap-1.5 text-amber-400">
            <TrendingUp className="w-3.5 h-3.5" />
            执行了 {event.adjustments_executed} 项调整
          </span>
        )}
        {event.tasks_created === 0 && event.adjustments_executed === 0 && (
          <span className="text-gray-500 italic">本轮无需调整</span>
        )}
      </div>
    </div>
  );
}

function KRProgressSection({ goals }: { goals: Goal[] }) {
  // 过滤出 KR 类型的 goals（area_okr 且有 parent_id）
  const krs = goals.filter(
    (g) => g.parent_id && g.status !== 'cancelled' && g.type === 'area_okr'
  );

  if (krs.length === 0) {
    return (
      <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 p-6">
        <div className="flex items-center gap-3 mb-3">
          <div className="p-2 bg-cyan-500/20 rounded-lg">
            <Target className="w-5 h-5 text-cyan-400" />
          </div>
          <h2 className="text-lg font-semibold text-white">KR 进度</h2>
        </div>
        <p className="text-gray-500 text-sm">暂无 KR 数据</p>
      </div>
    );
  }

  return (
    <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 p-6">
      <div className="flex items-center gap-3 mb-5">
        <div className="p-2 bg-cyan-500/20 rounded-lg">
          <Target className="w-5 h-5 text-cyan-400" />
        </div>
        <h2 className="text-lg font-semibold text-white">KR 进度</h2>
        <span className="text-sm text-gray-500 ml-auto">{krs.length} 个 KR</span>
      </div>
      <div className="space-y-4">
        {krs.map((kr) => {
          const progress = Math.min(100, Math.max(0, kr.progress || 0));
          const progressColor =
            progress >= 80
              ? 'bg-green-500'
              : progress >= 50
              ? 'bg-blue-500'
              : progress >= 20
              ? 'bg-amber-500'
              : 'bg-red-500';

          return (
            <div key={kr.id} className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-300 truncate max-w-[70%]" title={kr.title}>
                  {kr.title}
                </span>
                <div className="flex items-center gap-2">
                  {kr.status === 'in_progress' ? (
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                  ) : kr.status === 'completed' ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />
                  ) : kr.status === 'paused' ? (
                    <Pause className="w-3.5 h-3.5 text-gray-400" />
                  ) : null}
                  <span className="text-sm font-mono font-medium text-white">{progress}%</span>
                </div>
              </div>
              <div className="w-full h-2 bg-slate-700 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${progressColor}`}
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PhaseColumn({
  phase,
  projects,
  label,
  icon: Icon,
  color,
}: {
  phase: 'now' | 'next' | 'later';
  projects: Project[];
  label: string;
  icon: typeof Zap;
  color: string;
}) {
  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2 mb-4">
        <Icon className={`w-4 h-4 ${color}`} />
        <h3 className={`text-sm font-semibold uppercase tracking-wider ${color}`}>{label}</h3>
        <span className="text-xs text-gray-500 ml-auto">{projects.length}</span>
      </div>
      <div className="space-y-2">
        {projects.length === 0 ? (
          <div className="bg-slate-800/30 rounded-lg p-3 border border-dashed border-slate-700">
            <p className="text-gray-600 text-xs text-center">暂无项目</p>
          </div>
        ) : (
          projects.map((project) => (
            <div
              key={project.id}
              className="bg-slate-800/50 rounded-lg p-3 border border-slate-700/50 hover:border-slate-600 transition-colors"
            >
              <div className="flex items-start justify-between gap-2 mb-1">
                <span className="text-sm text-white font-medium leading-snug">{project.name}</span>
              </div>
              <div className="flex items-center gap-2 mt-2">
                <span className={`px-1.5 py-0.5 text-[10px] rounded ${getStatusColor(project.status)}`}>
                  {project.status}
                </span>
                {project.type && (
                  <span className="text-[10px] text-gray-500">{project.type}</span>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function AgentStatusSection({ tasks, tickStatus }: { tasks: AgentTask[]; tickStatus: TickStatus | null }) {
  return (
    <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 p-6">
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 bg-green-500/20 rounded-lg">
          <Bot className="w-5 h-5 text-green-400" />
        </div>
        <h2 className="text-lg font-semibold text-white">Agent 状态</h2>
        {tickStatus && (
          <span
            className={`ml-auto px-2 py-0.5 text-xs rounded-full ${
              tickStatus.loop_running
                ? 'bg-green-500/20 text-green-400'
                : 'bg-red-500/20 text-red-400'
            }`}
          >
            调度器{tickStatus.loop_running ? '运行中' : '已停止'}
          </span>
        )}
      </div>

      {tasks.length === 0 ? (
        <div className="text-center py-4">
          <Bot className="w-8 h-8 text-gray-600 mx-auto mb-2" />
          <p className="text-gray-500 text-sm">当前没有正在执行的任务</p>
        </div>
      ) : (
        <div className="space-y-3">
          {tasks.map((task) => (
            <div
              key={task.id}
              className="flex items-center gap-3 p-3 bg-slate-900/50 rounded-lg"
            >
              <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm text-white truncate">{task.title}</div>
                <div className="flex items-center gap-2 mt-1">
                  <span className={`px-1.5 py-0.5 text-[10px] rounded ${getPriorityColor(task.priority)}`}>
                    {task.priority}
                  </span>
                  <span className="text-[10px] text-gray-500">{task.task_type}</span>
                  {task.started_at && (
                    <span className="text-[10px] text-gray-500">
                      开始于 {timeAgo(task.started_at)}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============ 主组件 ============

export default function RoadmapPage() {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selfDriveEvent, setSelfDriveEvent] = useState<SelfDriveEvent | null>(null);
  const [agentTasks, setAgentTasks] = useState<AgentTask[]>([]);
  const [tickStatus, setTickStatus] = useState<TickStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  const loadData = useCallback(async () => {
    try {
      const [goalsRes, projectsRes, selfDriveRes, tasksRes, tickRes] = await Promise.allSettled([
        axios.get('/api/brain/goals'),
        axios.get('/api/brain/projects'),
        axios.get('/api/brain/self-drive/latest'),
        axios.get('/api/brain/tasks/tasks', { params: { status: 'in_progress', limit: 20 } }),
        axios.get('/api/brain/tick/status'),
      ]);

      if (goalsRes.status === 'fulfilled') {
        setGoals(Array.isArray(goalsRes.value.data) ? goalsRes.value.data : []);
      }
      if (projectsRes.status === 'fulfilled') {
        setProjects(Array.isArray(projectsRes.value.data) ? projectsRes.value.data : []);
      }
      if (selfDriveRes.status === 'fulfilled' && selfDriveRes.value.data?.success) {
        setSelfDriveEvent(selfDriveRes.value.data.event);
      }
      if (tasksRes.status === 'fulfilled') {
        const taskData = tasksRes.value.data;
        setAgentTasks(Array.isArray(taskData) ? taskData : []);
      }
      if (tickRes.status === 'fulfilled') {
        setTickStatus(tickRes.value.data);
      }

      setError(null);
      setLastRefresh(new Date());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    // 每 30 秒自动刷新
    const timer = setInterval(loadData, 30000);
    return () => clearInterval(timer);
  }, [loadData]);

  // 按 phase 分组 projects（排除已完成和已取消的）
  const activeProjects = projects.filter(
    (p) => p.status !== 'completed' && p.status !== 'cancelled' && p.status !== 'done'
  );
  const nowProjects = activeProjects.filter((p) => getPhaseForProject(p) === 'now');
  const nextProjects = activeProjects.filter((p) => getPhaseForProject(p) === 'next');
  const laterProjects = activeProjects.filter((p) => getPhaseForProject(p) === 'later');

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-900/20 border border-red-800 rounded-xl p-6 text-center">
        <XCircle className="w-12 h-12 text-red-500 mx-auto mb-3" />
        <p className="text-red-400">加载失败: {error}</p>
        <button
          onClick={() => { setLoading(true); loadData(); }}
          className="mt-4 px-4 py-2 bg-red-900/30 text-red-400 rounded-lg hover:bg-red-900/50"
        >
          重试
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-xl">
            <Target className="w-8 h-8 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white dark:text-white text-gray-900">Roadmap</h1>
            <p className="text-gray-400 dark:text-gray-400 text-gray-500 text-sm">
              OKR 进度 &middot; 项目规划 &middot; Agent 状态
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500">
            {lastRefresh.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} 更新
          </span>
          <button
            onClick={() => { setLoading(true); loadData(); }}
            className="p-2 text-gray-400 hover:text-white hover:bg-slate-700 dark:hover:bg-slate-700 hover:bg-gray-200 rounded-lg transition-colors"
            title="刷新数据"
          >
            <RefreshCw className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Cecelia 思考 */}
      <CeceliaThinking event={selfDriveEvent} />

      {/* KR 进度 */}
      <KRProgressSection goals={goals} />

      {/* Now / Next / Later */}
      <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 bg-indigo-500/20 rounded-lg">
            <ArrowRight className="w-5 h-5 text-indigo-400" />
          </div>
          <h2 className="text-lg font-semibold text-white">项目规划</h2>
          <span className="text-sm text-gray-500 ml-auto">
            {activeProjects.length} 个活跃项目
          </span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <PhaseColumn
            phase="now"
            projects={nowProjects}
            label="Now"
            icon={Zap}
            color="text-green-400"
          />
          <PhaseColumn
            phase="next"
            projects={nextProjects}
            label="Next"
            icon={ArrowRight}
            color="text-amber-400"
          />
          <PhaseColumn
            phase="later"
            projects={laterProjects}
            label="Later"
            icon={Clock}
            color="text-gray-400"
          />
        </div>
      </div>

      {/* Agent 状态 */}
      <AgentStatusSection tasks={agentTasks} tickStatus={tickStatus} />
    </div>
  );
}
