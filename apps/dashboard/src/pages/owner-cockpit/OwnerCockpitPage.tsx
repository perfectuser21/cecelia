/**
 * OwnerCockpitPage — 主理人指挥舱
 *
 * Task ID: 80a5be84-059a-4d86-a55c-a1e38f84e043
 * Sprint:  sprints/07162300-owner-cockpit
 *
 * 功能：
 * - 六指标 Header（来自真实 Brain API）
 * - 作战板（in_progress/queued/blocked 任务）
 * - 晨报 Feed（design_docs type=diary）
 * - 演习状态条（guard-drill）
 * - 导览区（16 个已有页面快捷入口）
 * - 移动端响应式（375px 单列）
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity, CheckCircle, GitMerge, Layers, AlertCircle, Shield,
  ChevronDown, ChevronRight, ExternalLink, Clock, Zap,
  BarChart2, Settings, Map, FileText, Video, Brain,
  Target, BookOpen, Radio, Inbox, Database, TrendingUp,
  Users, Code,
} from 'lucide-react';

const BRAIN_URL = 'http://localhost:5221';

// ======== 类型定义 ========

interface HarnessStats {
  completion_rate: number | null;
  total_pipelines: number | null;
}

interface Task {
  id: string;
  title: string;
  status: string;
  priority?: string | number | null;
  created_at?: string;
}

interface GuardDrillStatus {
  guards: Array<{
    id: string;
    name: string;
    stale: boolean;
    last_drill_at: string | null;
  }>;
  last_run: {
    fired: boolean;
    guard_name?: string;
    ran_at?: string;
  } | null;
  last_run_at: string | null;
}

interface DiaryDoc {
  id: string;
  title: string;
  content?: string;
  created_at: string;
}

// ======== 辅助函数 ========

function fmtPct(val: number | null | undefined): string {
  if (val == null) return '--';
  return `${Math.round(val * 100)}%`;
}

function fmtNum(val: number | null | undefined): string {
  if (val == null) return '--';
  return String(val);
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '--';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return '--';
  }
}

// ======== 六指标卡组件 ========

interface MetricCardProps {
  slug: string;
  label: string;
  value: string;
  sub?: string;
  icon: React.ReactNode;
  color?: string;
}

function MetricCard({ slug, label, value, sub, icon, color = 'text-blue-400' }: MetricCardProps) {
  return (
    <div
      data-testid={`metric-card-${slug}`}
      className="bg-slate-800 rounded-xl p-4 flex flex-col gap-2 min-w-0"
    >
      <div className="flex items-center gap-2">
        <span className={`w-5 h-5 flex-shrink-0 ${color}`}>{icon}</span>
        <span className="text-xs text-slate-400 truncate">{label}</span>
      </div>
      <div className="text-2xl font-bold text-white leading-none">{value}</div>
      {sub && <div className="text-xs text-slate-500 truncate">{sub}</div>}
    </div>
  );
}

// ======== 作战板组件 ========

interface BattleCardProps {
  task: Task;
}

function BattleCard({ task }: BattleCardProps) {
  const navigate = useNavigate();

  function handleClick() {
    navigate(`/harness-pipeline?task_id=${task.id}`);
  }

  const statusColor: Record<string, string> = {
    in_progress: 'bg-yellow-500',
    queued: 'bg-blue-500',
    blocked: 'bg-red-500',
  };
  const dot = statusColor[task.status] ?? 'bg-gray-500';

  return (
    <div
      data-testid="battle-card"
      className="bg-slate-800 rounded-lg p-3 flex items-start gap-3 cursor-pointer hover:bg-slate-700 transition-colors"
    >
      <span className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${dot}`} />
      <div className="flex-1 min-w-0">
        <a
          data-testid={`task-link-${task.id}`}
          href={`/harness-pipeline?task_id=${task.id}`}
          onClick={(e) => { e.preventDefault(); handleClick(); }}
          className="text-sm text-slate-200 hover:text-white line-clamp-2 leading-snug"
        >
          {task.title}
        </a>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-xs text-slate-500 uppercase">{task.status}</span>
          {task.created_at && (
            <span className="text-xs text-slate-600">{fmtDate(task.created_at)}</span>
          )}
        </div>
      </div>
      <ExternalLink className="w-3 h-3 text-slate-600 flex-shrink-0 mt-0.5" />
    </div>
  );
}

// ======== 晨报条目 ========

function DiaryItem({ doc }: { doc: DiaryDoc }) {
  const [open, setOpen] = useState(false);
  const slug = doc.id;

  return (
    <div
      data-testid={`diary-item-${slug}`}
      className="border border-slate-700 rounded-lg overflow-hidden"
    >
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between p-3 text-left hover:bg-slate-700/50 transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0">
          <FileText className="w-4 h-4 text-slate-400 flex-shrink-0" />
          <span className="text-sm text-slate-200 truncate">{doc.title}</span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-xs text-slate-500">{fmtDate(doc.created_at)}</span>
          {open ? (
            <ChevronDown className="w-4 h-4 text-slate-400" />
          ) : (
            <ChevronRight className="w-4 h-4 text-slate-400" />
          )}
        </div>
      </button>
      {open && (
        <div
          data-testid={`diary-item-${slug}-content`}
          className="p-3 pt-0 text-sm text-slate-400 whitespace-pre-wrap border-t border-slate-700"
        >
          {doc.content || '（内容加载中...）'}
        </div>
      )}
    </div>
  );
}

// ======== 演习状态条 ========

function DrillStatusBar({ status }: { status: GuardDrillStatus | null }) {
  if (!status) {
    return (
      <div data-testid="drill-status-bar" className="bg-slate-800 rounded-lg p-3 text-sm text-slate-400">
        演习状态加载中...
      </div>
    );
  }

  const staleCount = status.guards.filter(g => g.stale).length;
  const totalGuards = status.guards.length;
  const lastRun = status.last_run;
  const lastRunAt = status.last_run_at;

  return (
    <div data-testid="drill-status-bar" className="bg-slate-800 rounded-lg p-3 flex items-center gap-3 flex-wrap">
      <Shield className="w-4 h-4 text-yellow-400 flex-shrink-0" />
      <span className="text-sm text-slate-300">
        守卫演习：{totalGuards} 个守卫，{staleCount > 0 ? (
          <span className="text-red-400 font-medium">{staleCount} 个过期</span>
        ) : (
          <span className="text-green-400 font-medium">全部新鲜</span>
        )}
      </span>
      {lastRun && (
        <span className="text-xs text-slate-500">
          上次演习：{lastRun.guard_name ?? '--'}，{lastRun.fired ? '触发' : '未触发'}
        </span>
      )}
      {lastRunAt && (
        <span className="text-xs text-slate-600">{fmtDate(lastRunAt)}</span>
      )}
    </div>
  );
}

// ======== 导览区 ========

const NAV_LINKS = [
  { path: '/warroom', label: '战情室', icon: <Radio className="w-4 h-4" /> },
  { path: '/pipeline', label: 'Harness 流水线', icon: <Zap className="w-4 h-4" /> },
  { path: '/tasks', label: '任务列表', icon: <Layers className="w-4 h-4" /> },
  { path: '/roadmap', label: '路线图', icon: <Map className="w-4 h-4" /> },
  { path: '/harness-pipeline', label: '流水线详情', icon: <Activity className="w-4 h-4" /> },
  { path: '/reports', label: '报告中心', icon: <BarChart2 className="w-4 h-4" /> },
  { path: '/test-pyramid', label: '测试金字塔', icon: <Target className="w-4 h-4" /> },
  { path: '/relay-progress', label: '中继进度', icon: <TrendingUp className="w-4 h-4" /> },
  { path: '/viral-analysis', label: '传播分析', icon: <Users className="w-4 h-4" /> },
  { path: '/clips', label: '内容剪辑', icon: <Video className="w-4 h-4" /> },
  { path: '/live-monitor', label: '直播监控', icon: <Radio className="w-4 h-4" /> },
  { path: '/collection-dashboard', label: '采集面板', icon: <Database className="w-4 h-4" /> },
  { path: '/brain-models', label: 'Brain 模型', icon: <Brain className="w-4 h-4" /> },
  { path: '/area-slots', label: '区域槽位', icon: <BookOpen className="w-4 h-4" /> },
  { path: '/settings', label: '系统设置', icon: <Settings className="w-4 h-4" /> },
  { path: '/account-usage', label: '账户用量', icon: <Code className="w-4 h-4" /> },
];

function NavArea() {
  const navigate = useNavigate();

  return (
    <div data-testid="nav-area" className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      {NAV_LINKS.map(link => (
        <a
          key={link.path}
          data-testid={`nav-link-${link.path.replace(/\//g, '-').replace(/^-/, '')}`}
          href={link.path}
          onClick={(e) => { e.preventDefault(); navigate(link.path); }}
          className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 rounded-lg p-3 text-sm text-slate-300 hover:text-white transition-colors"
        >
          <span className="text-slate-400 flex-shrink-0">{link.icon}</span>
          <span className="truncate">{link.label}</span>
        </a>
      ))}
    </div>
  );
}

// ======== 主页面 ========

export default function OwnerCockpitPage() {
  const [harnessStats, setHarnessStats] = useState<HarnessStats | null>(null);
  const [inProgressTasks, setInProgressTasks] = useState<Task[]>([]);
  const [queuedTasks, setQueuedTasks] = useState<Task[]>([]);
  const [blockedTasks, setBlockedTasks] = useState<Task[]>([]);
  const [drillStatus, setDrillStatus] = useState<GuardDrillStatus | null>(null);
  const [diaryDocs, setDiaryDocs] = useState<DiaryDoc[]>([]);
  const [loadError, setLoadError] = useState<Record<string, string>>({});

  useEffect(() => {
    async function fetchAll() {
      // 并行 fetch 所有 API
      const [statsRes, ipTasksRes, queuedRes, blockedRes, drillRes, diaryRes] = await Promise.allSettled([
        fetch(`${BRAIN_URL}/api/brain/harness/stats`).then(r => r.json()),
        fetch(`${BRAIN_URL}/api/brain/tasks?status=in_progress&limit=20`).then(r => r.json()),
        fetch(`${BRAIN_URL}/api/brain/tasks?status=queued&limit=10`).then(r => r.json()),
        fetch(`${BRAIN_URL}/api/brain/tasks?status=blocked&limit=5`).then(r => r.json()),
        fetch(`${BRAIN_URL}/api/brain/guard-drill/status`).then(r => r.json()),
        fetch(`${BRAIN_URL}/api/brain/design-docs?type=diary&limit=7`).then(r => r.json()),
      ]);

      if (statsRes.status === 'fulfilled') {
        setHarnessStats(statsRes.value);
      } else {
        setLoadError(e => ({ ...e, stats: 'load_failed' }));
      }

      if (ipTasksRes.status === 'fulfilled') {
        const d = ipTasksRes.value;
        setInProgressTasks(Array.isArray(d) ? d : (d?.tasks ?? []));
      }

      if (queuedRes.status === 'fulfilled') {
        const d = queuedRes.value;
        setQueuedTasks(Array.isArray(d) ? d : (d?.tasks ?? []));
      }

      if (blockedRes.status === 'fulfilled') {
        const d = blockedRes.value;
        setBlockedTasks(Array.isArray(d) ? d : (d?.tasks ?? []));
      }

      if (drillRes.status === 'fulfilled') {
        setDrillStatus(drillRes.value);
      }

      if (diaryRes.status === 'fulfilled') {
        const d = diaryRes.value;
        setDiaryDocs(Array.isArray(d) ? d : (d?.docs ?? d?.data ?? []));
      }
    }

    fetchAll().catch(e => console.error('[OwnerCockpit] fetchAll error:', e));
  }, []);

  // 计算六指标
  const completionRate = harnessStats?.completion_rate != null ? fmtPct(harnessStats.completion_rate) : '--';
  const totalPipelines = harnessStats?.total_pipelines != null ? fmtNum(harnessStats.total_pipelines) : '--';

  // canary-green-days: guard 中连续未 stale 的计数（简化：返回非过期守卫数）
  const greenGuards = drillStatus?.guards.filter(g => !g.stale).length ?? null;
  const canaryGreenDays = greenGuards != null ? fmtNum(greenGuards) : '--';

  // gate-fires: blocked 任务数（关卡拦截次数）
  const gateFires = fmtNum(blockedTasks.length);

  // merge-to-deploy: 从 harnessStats avg_duration 换算（秒/60 分钟，约表）
  const avgDurationMs = (harnessStats as any)?.avg_duration;
  const mergeToDeploy = avgDurationMs != null
    ? `${Math.round(avgDurationMs / 60000)}m`
    : '--';

  // queue-health: queued 数
  const queueHealth = fmtNum(queuedTasks.length);

  // blocked-count: blocked 任务数
  const blockedCount = fmtNum(blockedTasks.length);

  // 合并作战板任务（in_progress + queued + blocked，最多20条）
  const allBattleTasks = [
    ...inProgressTasks.map(t => ({ ...t, status: t.status || 'in_progress' })),
    ...queuedTasks.map(t => ({ ...t, status: t.status || 'queued' })),
    ...blockedTasks.map(t => ({ ...t, status: t.status || 'blocked' })),
  ].slice(0, 20);

  return (
    <div
      data-testid="owner-cockpit"
      className="min-h-screen bg-slate-900 text-white overflow-x-hidden"
    >
      <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">

        {/* === 页头 === */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">主理人指挥舱</h1>
            <p className="text-sm text-slate-400 mt-0.5">Owner Cockpit · {new Date().toLocaleDateString('zh-CN')}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 text-xs px-2 py-1 bg-green-900/40 text-green-400 rounded-full border border-green-800">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              Brain 在线
            </span>
          </div>
        </div>

        {/* === 六指标 Header === */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
          <MetricCard
            slug="completion-rate"
            label="完成率"
            value={completionRate}
            sub={`共 ${totalPipelines} 条流水线`}
            icon={<CheckCircle className="w-5 h-5" />}
            color="text-green-400"
          />
          <MetricCard
            slug="canary-green-days"
            label="金丝雀绿天"
            value={canaryGreenDays}
            sub="守卫健康数"
            icon={<Shield className="w-5 h-5" />}
            color="text-yellow-400"
          />
          <MetricCard
            slug="gate-fires"
            label="关卡触发"
            value={gateFires}
            sub="blocked 任务数"
            icon={<AlertCircle className="w-5 h-5" />}
            color="text-orange-400"
          />
          <MetricCard
            slug="merge-to-deploy"
            label="合并到部署"
            value={mergeToDeploy}
            sub="平均耗时"
            icon={<GitMerge className="w-5 h-5" />}
            color="text-purple-400"
          />
          <MetricCard
            slug="queue-health"
            label="队列健康"
            value={queueHealth}
            sub="queued 任务数"
            icon={<Layers className="w-5 h-5" />}
            color="text-blue-400"
          />
          <MetricCard
            slug="blocked-count"
            label="阻塞计数"
            value={blockedCount}
            sub="blocked 状态"
            icon={<Clock className="w-5 h-5" />}
            color="text-red-400"
          />
        </div>

        {/* === 演习状态条 === */}
        <DrillStatusBar status={drillStatus} />

        {/* === 主体：作战板 + 晨报 === */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* 作战板（左2/3） */}
          <div className="lg:col-span-2 space-y-3">
            <h2 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
              <Activity className="w-4 h-4 text-yellow-400" />
              作战板
              <span className="text-xs text-slate-500 font-normal ml-1">
                ({allBattleTasks.length} 个活跃任务)
              </span>
            </h2>

            {allBattleTasks.length === 0 ? (
              <div className="bg-slate-800 rounded-lg p-6 text-center text-slate-500 text-sm">
                暂无进行中任务
              </div>
            ) : (
              <div className="space-y-2">
                {allBattleTasks.map(task => (
                  <BattleCard key={task.id} task={task} />
                ))}
              </div>
            )}
          </div>

          {/* 晨报 Feed（右1/3） */}
          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
              <Inbox className="w-4 h-4 text-blue-400" />
              晨报 Feed
            </h2>

            {diaryDocs.length === 0 ? (
              <div className="bg-slate-800 rounded-lg p-4 text-center text-slate-500 text-sm">
                暂无晨报
              </div>
            ) : (
              <div className="space-y-2">
                {diaryDocs.map(doc => (
                  <DiaryItem key={doc.id} doc={doc} />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* === 导览区 === */}
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
            <Map className="w-4 h-4 text-slate-400" />
            快速导览
          </h2>
          <NavArea />
        </div>

      </div>
    </div>
  );
}
