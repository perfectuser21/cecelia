/**
 * OKR Roadmap Page - Brain 驱动的 OKR + Now/Next/Later 视图
 *
 * 数据来源：
 *   /api/goals           → KR/OKR 列表（goals 表）
 *   /api/tasks/projects  → Projects（projects 表）
 *   /api/brain/tasks?status=in_progress → 当前 Agent 活动
 *   /api/brain/events?event_type=cycle_complete → SelfDrive 思考
 *
 * 布局：三列 Now/Next/Later | 右侧 SelfDrive + Agents
 */

import { useState, useEffect, useCallback } from 'react';
import {
  RefreshCw,
  Target,
  CheckCircle2,
  Clock,
  Brain,
  Zap,
  AlertCircle,
  MapPin,
  Circle,
  ChevronRight,
  Layers,
  Activity,
  Bot,
} from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────

interface Goal {
  id: string;
  title: string;
  type: 'area_okr' | 'area_kr' | 'global_okr' | 'kr';
  progress: number | null;
  current_value: string | null;
  target_value: string | null;
  status: string;
  priority?: string;
  parent_id: string | null;
  area_id: string | null;
}

interface Project {
  id: string;
  title: string;
  type?: string;
  status: string;
  parent_id: string | null;
  kr_id: string | null;
  priority?: string;
  deadline: string | null;
  end_date?: string | null;
  created_at: string | null;
  description?: string | null;
}

interface BrainTask {
  id: string;
  title: string;
  priority: 'P0' | 'P1' | 'P2';
  status: string;
  task_type?: string;
  custom_props?: { dev_step?: number; dev_step_name?: string };
}

interface SelfDriveEvent {
  id: number;
  event_type: string;
  payload: {
    reasoning?: string;
    tasks_created?: number;
    adjustments_executed?: number;
    tasks?: Array<{ title: string; type: string }>;
    adjustments?: Array<{ type: string }>;
  };
  created_at: string;
}

// ── Progress helpers ─────────────────────────────────────────────

function computeKrProgress(g: Goal): number {
  // 优先用 progress 字段（如后端有）
  if (g.progress !== null && g.progress !== undefined) return g.progress;
  // 用 current_value / target_value
  const cur = parseFloat(g.current_value ?? '0');
  const tgt = parseFloat(g.target_value ?? '0');
  if (tgt > 0) return Math.min(Math.round((cur / tgt) * 100), 100);
  // target_value 为空时，current_value 直接当百分比（0-100）
  if (!isNaN(cur) && cur >= 0 && cur <= 100) return Math.round(cur);
  return 0;
}

// ── Column logic ─────────────────────────────────────────────────

type Column = 'now' | 'next' | 'later';

function classifyProject(project: Project): Column {
  if (project.status === 'in_progress') return 'now';
  if (project.status === 'completed') return 'later'; // completed 归 later，稍后过滤
  // pending 项目：有 kr_id → next，否则 later
  if (project.kr_id) return 'next';
  return 'later';
}

// ── Sub-components ────────────────────────────────────────────────

function ProgressBar({ value, color = 'blue' }: { value: number; color?: string }) {
  const colorMap: Record<string, string> = {
    blue: 'bg-blue-500',
    green: 'bg-green-500',
    amber: 'bg-amber-500',
    red: 'bg-red-500',
    purple: 'bg-purple-500',
  };
  return (
    <div className="w-full h-1.5 bg-slate-700 rounded-full overflow-hidden">
      <div
        className={`h-full rounded-full transition-all ${colorMap[color] ?? colorMap.blue}`}
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
}

function PriorityBadge({ priority }: { priority?: string }) {
  const cls =
    priority === 'P0'
      ? 'bg-red-500/20 text-red-400'
      : priority === 'P1'
      ? 'bg-amber-500/20 text-amber-400'
      : 'bg-slate-600/50 text-slate-400';
  return priority ? (
    <span className={`px-1.5 py-0.5 text-xs rounded font-medium ${cls}`}>{priority}</span>
  ) : null;
}

function StatusDot({ status }: { status: string }) {
  const color =
    status === 'in_progress'
      ? 'text-green-400'
      : status === 'completed'
      ? 'text-blue-400'
      : 'text-slate-500';
  return <Circle className={`w-2 h-2 fill-current ${color}`} />;
}

function ProjectCard({
  project,
  linkedKR,
}: {
  project: Project;
  linkedKR?: Goal;
}) {
  return (
    <div className="bg-slate-800/80 border border-slate-700/60 rounded-xl p-4 hover:border-slate-600 transition-colors">
      {/* Header */}
      <div className="flex items-start gap-2 mb-2">
        <StatusDot status={project.status} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-white leading-tight truncate max-w-[180px]">
              {project.title}
            </span>
            <PriorityBadge priority={project.priority} />
          </div>
          {project.type && (
            <span className="text-xs text-slate-500 mt-0.5 block">{project.type}</span>
          )}
        </div>
      </div>

      {/* KR 进度条 */}
      {linkedKR && (
        <div className="mt-3 space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-400 flex items-center gap-1 truncate">
              <Target className="w-3 h-3 flex-shrink-0 text-blue-400" />
              <span className="truncate">{linkedKR.title}</span>
            </span>
            <span className="text-slate-300 font-medium ml-2 flex-shrink-0">
              {computeKrProgress(linkedKR)}%
            </span>
          </div>
          <ProgressBar
            value={computeKrProgress(linkedKR)}
            color={
              computeKrProgress(linkedKR) >= 80
                ? 'green'
                : computeKrProgress(linkedKR) >= 50
                ? 'blue'
                : computeKrProgress(linkedKR) >= 20
                ? 'amber'
                : 'red'
            }
          />
        </div>
      )}

      {/* Deadline */}
      {(project.deadline || project.end_date) && (
        <div className="mt-2 flex items-center gap-1 text-xs text-slate-500">
          <Clock className="w-3 h-3" />
          {new Date((project.deadline || project.end_date)!).toLocaleDateString('zh-CN')}
        </div>
      )}
    </div>
  );
}

function ColumnHeader({
  label,
  count,
  icon,
  colorClass,
}: {
  label: string;
  count: number;
  icon: React.ReactNode;
  colorClass: string;
}) {
  return (
    <div className="flex items-center gap-2 px-1 mb-4">
      <div className={colorClass}>{icon}</div>
      <h3 className="text-sm font-semibold text-white">{label}</h3>
      <span className="ml-auto text-xs px-2 py-0.5 rounded-full bg-slate-700/60 text-slate-400">
        {count}
      </span>
    </div>
  );
}

function SelfDrivePanel({ events }: { events: SelfDriveEvent[] }) {
  if (events.length === 0) {
    return (
      <div className="text-center py-6 text-slate-500">
        <Brain className="w-8 h-8 mx-auto mb-2 opacity-30" />
        <p className="text-xs">暂无 SelfDrive 记录</p>
      </div>
    );
  }
  const latest = events[0];
  const { reasoning, tasks_created = 0, adjustments_executed = 0, tasks = [] } = latest.payload;

  return (
    <div className="space-y-3">
      {/* 最新 reasoning */}
      {reasoning && (
        <div className="bg-slate-800/60 border border-slate-700/50 rounded-lg p-3">
          <div className="flex items-center gap-1.5 mb-2">
            <Brain className="w-3.5 h-3.5 text-purple-400" />
            <span className="text-xs font-medium text-purple-300">最新思考</span>
            <span className="text-xs text-slate-500 ml-auto">
              {new Date(latest.created_at).toLocaleTimeString('zh-CN', {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          </div>
          <p className="text-xs text-slate-300 leading-relaxed">{reasoning}</p>
        </div>
      )}

      {/* 本轮行动 */}
      {(tasks_created > 0 || adjustments_executed > 0) && (
        <div className="flex gap-3">
          {tasks_created > 0 && (
            <div className="flex items-center gap-1.5 text-xs text-green-400">
              <Zap className="w-3 h-3" />
              创建 {tasks_created} 个任务
            </div>
          )}
          {adjustments_executed > 0 && (
            <div className="flex items-center gap-1.5 text-xs text-blue-400">
              <Activity className="w-3 h-3" />
              {adjustments_executed} 次调整
            </div>
          )}
        </div>
      )}

      {/* 创建的任务列表 */}
      {tasks.length > 0 && (
        <div className="space-y-1.5">
          {tasks.slice(0, 3).map((t, i) => (
            <div key={i} className="flex items-start gap-1.5 text-xs text-slate-400">
              <ChevronRight className="w-3 h-3 mt-0.5 flex-shrink-0 text-slate-600" />
              <span className="truncate">{t.title}</span>
            </div>
          ))}
          {tasks.length > 3 && (
            <p className="text-xs text-slate-600">+ {tasks.length - 3} 更多...</p>
          )}
        </div>
      )}

      {/* 历史记录 */}
      {events.length > 1 && (
        <div className="space-y-1 pt-2 border-t border-slate-700/40">
          {events.slice(1, 4).map((e) => (
            <div key={e.id} className="flex items-center gap-2 text-xs text-slate-500">
              <span className="text-slate-600">
                {new Date(e.created_at).toLocaleTimeString('zh-CN', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
              <span className="truncate">{e.payload.reasoning?.slice(0, 60) ?? '—'}...</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AgentsPanel({ tasks }: { tasks: BrainTask[] }) {
  if (tasks.length === 0) {
    return (
      <div className="text-center py-4 text-slate-500">
        <Bot className="w-7 h-7 mx-auto mb-2 opacity-30" />
        <p className="text-xs">暂无 Agent 在运行</p>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {tasks.slice(0, 8).map((t) => (
        <div key={t.id} className="flex items-start gap-2 p-2 bg-slate-800/50 rounded-lg">
          <div className="w-1.5 h-1.5 rounded-full bg-green-400 mt-1.5 flex-shrink-0 animate-pulse" />
          <div className="flex-1 min-w-0">
            <div className="text-xs text-white truncate">{t.title}</div>
            <div className="flex items-center gap-2 mt-0.5">
              {t.task_type && (
                <span className="text-xs text-slate-500">{t.task_type}</span>
              )}
              {t.custom_props?.dev_step_name && (
                <span className="text-xs text-blue-400">{t.custom_props.dev_step_name}</span>
              )}
            </div>
          </div>
          <PriorityBadge priority={t.priority} />
        </div>
      ))}
      {tasks.length > 8 && (
        <p className="text-xs text-slate-500 text-center">+ {tasks.length - 8} 更多</p>
      )}
    </div>
  );
}

// ── KR 摘要卡片 ───────────────────────────────────────────────────

function KRSummary({ goals }: { goals: Goal[] }) {
  const krs = goals.filter((g) => g.type === 'area_kr' || g.type === 'kr');
  if (krs.length === 0) return null;

  const avg = krs.reduce((s, k) => s + computeKrProgress(k), 0) / krs.length;
  const done = krs.filter((k) => computeKrProgress(k) >= 100).length;

  return (
    <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <Target className="w-4 h-4 text-blue-400" />
        <span className="text-sm font-medium text-white">KR 总览</span>
        <span className="text-xs text-slate-500 ml-auto">{krs.length} 个 KR</span>
      </div>
      <div className="flex items-center gap-4 mb-3">
        <div className="text-center">
          <div className="text-2xl font-bold text-white">{Math.round(avg) || 0}%</div>
          <div className="text-xs text-slate-400">平均进度</div>
        </div>
        <div className="flex-1">
          <ProgressBar value={avg || 0} color={(avg || 0) >= 70 ? 'green' : (avg || 0) >= 40 ? 'blue' : 'amber'} />
        </div>
        <div className="text-center">
          <div className="text-lg font-bold text-green-400">{done}</div>
          <div className="text-xs text-slate-400">已完成</div>
        </div>
      </div>
      {/* Top 5 KRs */}
      <div className="space-y-2">
        {krs.slice(0, 5).map((kr) => {
          const pct = computeKrProgress(kr);
          return (
            <div key={kr.id} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-300 truncate max-w-[200px]">{kr.title}</span>
                <span className="text-slate-400 ml-2 flex-shrink-0">{pct}%</span>
              </div>
              <ProgressBar
                value={pct}
                color={pct >= 80 ? 'green' : pct >= 50 ? 'blue' : 'amber'}
              />
            </div>
          );
        })}
        {krs.length > 5 && (
          <p className="text-xs text-slate-500">+ {krs.length - 5} 更多 KR...</p>
        )}
      </div>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────

export default function RoadmapPage() {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [agentTasks, setAgentTasks] = useState<BrainTask[]>([]);
  const [selfDriveEvents, setSelfDriveEvents] = useState<SelfDriveEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      const [goalsRes, projectsRes, tasksRes, eventsRes] = await Promise.all([
        fetch('/api/brain/goals?limit=200'),
        fetch('/api/brain/projects?limit=200'),
        fetch('/api/brain/tasks?status=in_progress'),
        fetch('/api/brain/events?event_type=cycle_complete&limit=5'),
      ]);

      const [goalsData, projectsData, tasksData, eventsData] = await Promise.all([
        goalsRes.json(),
        projectsRes.json(),
        tasksRes.json(),
        eventsRes.json(),
      ]);

      setGoals(Array.isArray(goalsData) ? goalsData : []);
      setProjects(Array.isArray(projectsData) ? projectsData : []);
      setAgentTasks(Array.isArray(tasksData) ? tasksData : []);
      setSelfDriveEvents(
        eventsData?.events
          ? eventsData.events
          : Array.isArray(eventsData)
          ? eventsData
          : []
      );
      setError(null);
      setLastUpdated(new Date());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, 30_000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  // 按列分类（仅展示非 completed 项目）
  const goalsById = Object.fromEntries(goals.map((g) => [g.id, g]));
  const activeProjects = projects.filter((p) => p.status !== 'completed');

  const nowProjects = activeProjects.filter((p) => classifyProject(p) === 'now');
  const nextProjects = activeProjects.filter((p) => classifyProject(p) === 'next');
  const laterProjects = activeProjects.filter((p) => classifyProject(p) === 'later');

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
        <AlertCircle className="w-10 h-10 text-red-500 mx-auto mb-2" />
        <p className="text-red-400 text-sm">加载失败: {error}</p>
        <button
          onClick={fetchAll}
          className="mt-3 px-4 py-2 bg-red-900/30 text-red-400 rounded-lg text-sm"
        >
          重试
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl">
            <MapPin className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">OKR Roadmap</h1>
            <p className="text-xs text-slate-400">
              {activeProjects.length} 个项目 · {goals.filter((g) => g.type === 'area_kr' || g.type === 'kr').length} 个 KR
              {lastUpdated && (
                <span className="ml-2">
                  · 更新于{' '}
                  {lastUpdated.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
            </p>
          </div>
        </div>
        <button
          onClick={fetchAll}
          className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
          title="刷新"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* ── KR 总览 ── */}
      <KRSummary goals={goals} />

      {/* ── 主体：三列 + 右边栏 ── */}
      <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
        {/* Now / Next / Later 三列 */}
        <div className="xl:col-span-3 grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Now */}
          <div className="bg-slate-900/50 rounded-xl p-4 border border-slate-700/40">
            <ColumnHeader
              label="Now"
              count={nowProjects.length}
              icon={<Zap className="w-4 h-4" />}
              colorClass="text-green-400"
            />
            <div className="space-y-3">
              {nowProjects.length === 0 ? (
                <p className="text-xs text-slate-600 text-center py-4">暂无进行中项目</p>
              ) : (
                nowProjects.map((p) => (
                  <ProjectCard
                    key={p.id}
                    project={p}
                    linkedKR={p.kr_id ? goalsById[p.kr_id] : undefined}
                  />
                ))
              )}
            </div>
          </div>

          {/* Next */}
          <div className="bg-slate-900/50 rounded-xl p-4 border border-slate-700/40">
            <ColumnHeader
              label="Next"
              count={nextProjects.length}
              icon={<ChevronRight className="w-4 h-4" />}
              colorClass="text-blue-400"
            />
            <div className="space-y-3">
              {nextProjects.length === 0 ? (
                <p className="text-xs text-slate-600 text-center py-4">暂无 KR 关联项目</p>
              ) : (
                nextProjects.map((p) => (
                  <ProjectCard
                    key={p.id}
                    project={p}
                    linkedKR={p.kr_id ? goalsById[p.kr_id] : undefined}
                  />
                ))
              )}
            </div>
          </div>

          {/* Later */}
          <div className="bg-slate-900/50 rounded-xl p-4 border border-slate-700/40">
            <ColumnHeader
              label="Later"
              count={laterProjects.length}
              icon={<Layers className="w-4 h-4" />}
              colorClass="text-slate-400"
            />
            <div className="space-y-3">
              {laterProjects.length === 0 ? (
                <p className="text-xs text-slate-600 text-center py-4">暂无待规划项目</p>
              ) : (
                laterProjects.slice(0, 10).map((p) => (
                  <ProjectCard
                    key={p.id}
                    project={p}
                    linkedKR={p.kr_id ? goalsById[p.kr_id] : undefined}
                  />
                ))
              )}
              {laterProjects.length > 10 && (
                <p className="text-xs text-slate-600 text-center">
                  + {laterProjects.length - 10} 更多
                </p>
              )}
            </div>
          </div>
        </div>

        {/* ── 右侧面板 ── */}
        <div className="space-y-5">
          {/* SelfDrive 思考 */}
          <div className="bg-slate-900/50 rounded-xl p-4 border border-slate-700/40">
            <div className="flex items-center gap-2 mb-4">
              <Brain className="w-4 h-4 text-purple-400" />
              <h3 className="text-sm font-semibold text-white">SelfDrive 思考</h3>
            </div>
            <SelfDrivePanel events={selfDriveEvents} />
          </div>

          {/* 当前 Agent 活动 */}
          <div className="bg-slate-900/50 rounded-xl p-4 border border-slate-700/40">
            <div className="flex items-center gap-2 mb-4">
              <Activity className="w-4 h-4 text-green-400" />
              <h3 className="text-sm font-semibold text-white">Agent 活动</h3>
              <span className="ml-auto text-xs text-slate-500">{agentTasks.length} 运行中</span>
            </div>
            <AgentsPanel tasks={agentTasks} />
          </div>

          {/* 快速统计 */}
          <div className="bg-slate-900/50 rounded-xl p-4 border border-slate-700/40">
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle2 className="w-4 h-4 text-blue-400" />
              <h3 className="text-sm font-semibold text-white">快速统计</h3>
            </div>
            <div className="space-y-2.5">
              {[
                { label: 'Now（进行中）', value: nowProjects.length, cls: 'text-green-400' },
                { label: 'Next（KR 关联）', value: nextProjects.length, cls: 'text-blue-400' },
                { label: 'Later（待规划）', value: laterProjects.length, cls: 'text-slate-400' },
                { label: 'Agent 运行中', value: agentTasks.length, cls: 'text-green-400' },
              ].map(({ label, value, cls }) => (
                <div key={label} className="flex items-center justify-between">
                  <span className="text-xs text-slate-400">{label}</span>
                  <span className={`text-sm font-bold ${cls}`}>{value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
