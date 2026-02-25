import React, { useState, useEffect, useCallback, useRef, Suspense, lazy } from 'react';
import {
  Activity,
  Clock,
  Trash2,
  XCircle,
  Search,
  Filter,
  ChevronDown,
  ChevronUp,
  Terminal,
  User,
  Zap,
  FileText,
  Code,
  Globe,
  CheckCircle2,
  AlertCircle,
  Ban,
  Loader2,
  Cog,
  Play,
  Sparkles,
} from 'lucide-react';
import {
  claudeMonitorApi,
  Run,
  Event,
  RunSource,
  AIFactoryStep,
  StepStatus,
  StepPayload,
  AIFactoryState,
} from '../api/claude-monitor.api';

type FilterType = 'all' | 'running' | 'done';

// Utility functions
function formatDuration(startMs: number, endMs?: number | null): string {
  const end = endMs || Date.now();
  const seconds = Math.floor((end - startMs) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatPath(path: string): string {
  const parts = path.split('/');
  return parts.slice(-2).join('/') || path;
}

function estimateCost(input: number, output: number): string {
  const cost = (input / 1000000) * 3 + (output / 1000000) * 15;
  if (cost === 0) return '-';
  if (cost < 0.01) return '<$0.01';
  return `$${cost.toFixed(2)}`;
}

function formatTokens(n: number): string {
  if (n === 0) return '0';
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(1)}k`;
}

function isInteractive(source: RunSource): boolean {
  // terminal/manual = 有头（用户交互）
  // ssh/n8n/api = 无头（自动化执行）
  return source === 'terminal' || source === 'manual';
}

function getToolIcon(toolName: string | null): React.ReactNode {
  switch (toolName) {
    case 'Bash':
      return <Terminal className="w-4 h-4" />;
    case 'Read':
      return <FileText className="w-4 h-4" />;
    case 'Edit':
    case 'Write':
      return <Code className="w-4 h-4" />;
    case 'WebFetch':
    case 'WebSearch':
      return <Globe className="w-4 h-4" />;
    default:
      return <Zap className="w-4 h-4" />;
  }
}

function getEventDisplay(event: Event): { type: string; detail: string } {
  let payload: Record<string, unknown> = {};
  try {
    payload = event.payload ? JSON.parse(event.payload) : {};
  } catch {}

  if (event.type === 'user.message') {
    return { type: '输入', detail: String(payload.text || '').slice(0, 100) };
  }
  if (event.type === 'assistant.message') {
    return { type: '回复', detail: String(payload.text || '').split('\n')[0].slice(0, 100) };
  }

  // Handle AI Factory step events
  if (event.type.startsWith('step.')) {
    const stepPayload = payload as Partial<StepPayload>;
    const stepMap: Record<string, string> = {
      'step.started': '步骤开始',
      'step.progress': '步骤进度',
      'step.completed': '步骤完成',
      'step.failed': '步骤失败',
    };
    const stepName = stepPayload.step || 'UNKNOWN';
    const description = stepPayload.description || stepPayload.substep || '';
    return {
      type: stepMap[event.type] || '步骤',
      detail: `${stepName}: ${description}`,
    };
  }

  const tool = event.tool_name || '';
  let detail = '';
  if (tool === 'Bash') detail = String(payload.command || '').slice(0, 60);
  else if (payload.file_path) detail = String(payload.file_path).split('/').slice(-2).join('/');
  else if (payload.pattern) detail = String(payload.pattern);

  const toolMap: Record<string, string> = {
    Bash: '命令',
    Read: '读取',
    Edit: '编辑',
    Write: '写入',
    Glob: '搜索',
    Grep: '查找',
    Task: '子任务',
    WebFetch: '网页',
  };

  return { type: toolMap[tool] || tool || '操作', detail };
}

// Parse AI Factory state from events
function parseAIFactoryState(events: Event[]): AIFactoryState | null {
  const stepEvents = events.filter((e) => e.type.startsWith('step.'));
  if (stepEvents.length === 0) return null;

  const substeps: AIFactoryState['substeps'] = [];
  const steps: Record<AIFactoryStep, StepStatus> = {
    PREPARE: 'pending',
    EXECUTE: 'pending',
    CLEANUP: 'pending',
  };
  let currentStep: AIFactoryStep | null = null;
  let task_id = '';

  for (const event of stepEvents) {
    try {
      const payload = JSON.parse(event.payload || '{}') as Partial<StepPayload>;
      if (payload.task_id) task_id = payload.task_id;
      if (!payload.step) continue;

      const step = payload.step as AIFactoryStep;

      if (event.type === 'step.started') {
        steps[step] = 'in_progress';
        currentStep = step;
        if (payload.substep) {
          substeps.push({
            name: payload.substep,
            description: payload.description || '',
            status: 'in_progress',
            timestamp: event.created_at,
          });
        }
      } else if (event.type === 'step.completed') {
        steps[step] = 'completed';
        if (payload.substep) {
          const existing = substeps.find((s) => s.name === payload.substep);
          if (existing) {
            existing.status = 'completed';
          }
        }
      } else if (event.type === 'step.failed') {
        steps[step] = 'failed';
        if (payload.substep) {
          const existing = substeps.find((s) => s.name === payload.substep);
          if (existing) {
            existing.status = 'failed';
          }
        }
      } else if (event.type === 'step.progress' && payload.substep) {
        substeps.push({
          name: payload.substep,
          description: payload.description || '',
          status: 'in_progress',
          timestamp: event.created_at,
        });
      }
    } catch {}
  }

  return { task_id, steps, currentStep, substeps };
}

// AI Factory Progress Component
function AIFactoryProgress({ state }: { state: AIFactoryState }) {
  const stepConfig: Record<AIFactoryStep, { icon: React.ReactNode; label: string }> = {
    PREPARE: { icon: <Cog className="w-4 h-4" />, label: '准备' },
    EXECUTE: { icon: <Play className="w-4 h-4" />, label: '执行' },
    CLEANUP: { icon: <Sparkles className="w-4 h-4" />, label: '清理' },
  };

  const getStatusColor = (status: StepStatus) => {
    switch (status) {
      case 'completed':
        return 'bg-green-500';
      case 'in_progress':
        return 'bg-blue-500 animate-pulse';
      case 'failed':
        return 'bg-red-500';
      default:
        return 'bg-gray-300 dark:bg-gray-600';
    }
  };

  return (
    <div className="mt-4 p-4 rounded-xl bg-gradient-to-br from-purple-50 to-violet-50 dark:from-purple-900/20 dark:to-violet-900/20 border border-purple-200 dark:border-purple-800">
      <div className="flex items-center gap-2 mb-3">
        <Sparkles className="w-4 h-4 text-purple-600 dark:text-purple-400" />
        <span className="text-sm font-medium text-purple-900 dark:text-purple-300">AI Factory 进度</span>
      </div>

      {/* Main Steps */}
      <div className="flex items-center gap-2 mb-4">
        {(['PREPARE', 'EXECUTE', 'CLEANUP'] as AIFactoryStep[]).map((step, index) => {
          const config = stepConfig[step];
          const status = state.steps[step];
          const isCurrent = state.currentStep === step;

          return (
            <React.Fragment key={step}>
              <div
                className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-all ${
                  isCurrent
                    ? 'bg-purple-600 text-white shadow-lg shadow-purple-500/50'
                    : status === 'completed'
                    ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                    : status === 'failed'
                    ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
                }`}
              >
                {config.icon}
                <span className="text-xs font-medium">{config.label}</span>
                {status === 'in_progress' && <Loader2 className="w-3 h-3 animate-spin ml-1" />}
              </div>
              {index < 2 && <div className={`flex-1 h-0.5 ${getStatusColor(status)}`} />}
            </React.Fragment>
          );
        })}
      </div>

      {/* Substeps */}
      {state.substeps.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs text-purple-700 dark:text-purple-300 font-medium mb-2">子步骤:</div>
          {state.substeps.slice(-5).map((substep, index) => (
            <div
              key={`${substep.name}-${index}`}
              className="flex items-start gap-2 text-xs p-2 rounded-lg bg-white/50 dark:bg-slate-800/50"
            >
              <div
                className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${getStatusColor(substep.status)}`}
              />
              <div className="flex-1 min-w-0">
                <div className="font-medium text-gray-900 dark:text-white truncate">{substep.name}</div>
                {substep.description && (
                  <div className="text-gray-600 dark:text-gray-400 truncate">{substep.description}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const LazyClaudeStats = lazy(() => import('./ClaudeStats'));

export default function ClaudeMonitor() {
  const [activeTab, setActiveTab] = useState<'live' | 'analytics'>('live');

  return (
    <div className="space-y-4">
      <div className="flex gap-2 border-b border-slate-700 pb-2">
        <button
          onClick={() => setActiveTab('live')}
          className={`flex items-center gap-2 px-4 py-2 rounded-t-lg text-sm font-medium transition-colors ${
            activeTab === 'live'
              ? 'bg-slate-800 text-white border border-slate-700 border-b-0'
              : 'text-gray-400 hover:text-white'
          }`}
        >
          <Activity className="w-4 h-4" />
          Live
        </button>
        <button
          onClick={() => setActiveTab('analytics')}
          className={`flex items-center gap-2 px-4 py-2 rounded-t-lg text-sm font-medium transition-colors ${
            activeTab === 'analytics'
              ? 'bg-slate-800 text-white border border-slate-700 border-b-0'
              : 'text-gray-400 hover:text-white'
          }`}
        >
          <Sparkles className="w-4 h-4" />
          Analytics
        </button>
      </div>
      {activeTab === 'live' ? (
        <ClaudeMonitorLive />
      ) : (
        <Suspense fallback={<div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin text-blue-500" /></div>}>
          <LazyClaudeStats />
        </Suspense>
      )}
    </div>
  );
}

function ClaudeMonitorLive() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [killing, setKilling] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterType>('all');
  const [search, setSearch] = useState('');
  const [expandedEvents, setExpandedEvents] = useState<Set<number>>(new Set());
  const eventsRef = useRef<HTMLDivElement>(null);

  const toggleEvent = (eventId: number) => {
    setExpandedEvents((prev) => {
      const next = new Set(prev);
      if (next.has(eventId)) next.delete(eventId);
      else next.add(eventId);
      return next;
    });
  };

  const fetchRuns = useCallback(async () => {
    try {
      const data = await claudeMonitorApi.getRuns();
      setRuns(data.runs);
      setError(null);
      if (!selectedRunId && data.runs.length > 0) {
        const running = data.runs.find((r) => r.status === 'running');
        setSelectedRunId(running?.id || data.runs[0].id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally {
      setLoading(false);
    }
  }, [selectedRunId]);

  const fetchEvents = useCallback(async (runId: string) => {
    try {
      const data = await claudeMonitorApi.getEvents(runId, 100);
      setEvents(data.events);
    } catch {}
  }, []);

  const handleKill = async (runId: string) => {
    if (!confirm('确定终止此会话？')) return;
    setKilling(runId);
    try {
      await claudeMonitorApi.killRun(runId);
      fetchRuns();
    } finally {
      setKilling(null);
    }
  };

  const handleDelete = async (runId: string) => {
    if (!confirm('确定删除？')) return;
    await claudeMonitorApi.deleteRun(runId);
    if (selectedRunId === runId) setSelectedRunId(null);
    fetchRuns();
  };

  const handleClearCompleted = async () => {
    const completed = runs.filter((r) => r.status !== 'running');
    if (!completed.length || !confirm(`清理 ${completed.length} 个已结束会话？`)) return;
    for (const run of completed) {
      await claudeMonitorApi.deleteRun(run.id);
    }
    if (selectedRunId && completed.some((r) => r.id === selectedRunId)) setSelectedRunId(null);
    fetchRuns();
  };

  useEffect(() => {
    fetchRuns();
    const interval = setInterval(fetchRuns, 30000);
    return () => clearInterval(interval);
  }, [fetchRuns]);

  useEffect(() => {
    if (selectedRunId) {
      fetchEvents(selectedRunId);
      const interval = setInterval(() => fetchEvents(selectedRunId), 3000);
      return () => clearInterval(interval);
    }
  }, [selectedRunId, fetchEvents]);

  const filteredRuns = runs.filter((r) => {
    if (filter === 'running' && r.status !== 'running') return false;
    if (filter === 'done' && r.status === 'running') return false;
    if (search) {
      const s = search.toLowerCase();
      return (
        r.cwd.toLowerCase().includes(s) ||
        r.title?.toLowerCase().includes(s) ||
        r.session_id.includes(s)
      );
    }
    return true;
  });

  const selectedRun = runs.find((r) => r.id === selectedRunId);
  const runningCount = runs.filter((r) => r.status === 'running').length;

  if (loading && !runs.length) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-96">
        <AlertCircle className="w-12 h-12 text-red-500 dark:text-red-400 mb-4" />
        <p className="text-red-600 dark:text-red-400 mb-3">{error}</p>
        <button
          onClick={fetchRuns}
          className="px-4 py-2 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-xl hover:from-blue-700 hover:to-blue-800 shadow-lg shadow-blue-500/25 magnetic-btn"
        >
          重试
        </button>
      </div>
    );
  }

  return (
    <div className="flex gap-6 h-[calc(100vh-8rem)]">
      {/* 左侧会话列表 */}
      <div className="w-96 flex flex-col bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 shadow-sm overflow-hidden">
        {/* 头部 */}
        <div className="p-4 border-b border-gray-200 dark:border-slate-700">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-gradient-to-br from-purple-500 to-violet-600 rounded-lg flex items-center justify-center shadow-lg shadow-purple-500/25">
                <Activity className="w-4 h-4 text-white" />
              </div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Claude Monitor</h2>
            </div>
            <div className="flex items-center gap-2">
              {runningCount > 0 && (
                <span className="px-2 py-1 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 text-xs rounded-full font-medium">
                  {runningCount} 运行中
                </span>
              )}
              <button
                onClick={handleClearCompleted}
                className="text-xs text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 transition-colors"
              >
                清理
              </button>
            </div>
          </div>

          {/* 搜索 */}
          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500" />
            <input
              type="text"
              placeholder="搜索会话..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-3 py-2 border border-gray-300 dark:border-slate-600 rounded-xl text-sm bg-white dark:bg-slate-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          {/* 过滤 */}
          <div className="flex gap-2">
            {(['all', 'running', 'done'] as FilterType[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`flex-1 py-1.5 text-xs rounded-xl transition ${
                  filter === f
                    ? 'bg-gradient-to-r from-blue-600 to-blue-700 text-white font-medium shadow-md shadow-blue-500/25'
                    : 'bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-slate-600'
                }`}
              >
                {f === 'all' ? '全部' : f === 'running' ? '运行中' : '已结束'}
              </button>
            ))}
          </div>
        </div>

        {/* 会话列表 */}
        <div className="flex-1 overflow-y-auto">
          {filteredRuns.length === 0 ? (
            <div className="p-8 text-center text-gray-500 dark:text-gray-400">暂无会话</div>
          ) : (
            <div className="p-2 space-y-2">
              {filteredRuns.map((run) => {
                const selected = run.id === selectedRunId;
                const running = run.status === 'running';
                const interactive = isInteractive(run.source);

                return (
                  <div
                    key={run.id}
                    onClick={() => setSelectedRunId(run.id)}
                    className={`p-3 rounded-xl cursor-pointer transition-all border-l-2 ${
                      interactive ? 'border-l-blue-500' : 'border-l-orange-500'
                    } ${selected
                      ? 'bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800'
                      : 'hover:bg-gray-50 dark:hover:bg-slate-700/50 border border-transparent'
                    }`}
                  >
                    {/* 第一行 */}
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        {running ? (
                          <Loader2 className="w-3 h-3 text-green-500 animate-spin flex-shrink-0" />
                        ) : run.status === 'done' ? (
                          <CheckCircle2 className="w-3 h-3 text-gray-400 dark:text-gray-500 flex-shrink-0" />
                        ) : (
                          <Ban className="w-3 h-3 text-red-400 flex-shrink-0" />
                        )}
                        <span
                          className={`text-xs px-2 py-0.5 rounded-lg flex-shrink-0 ${
                            interactive
                              ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-400'
                              : 'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-400'
                          }`}
                        >
                          {interactive ? (
                            <User className="w-3 h-3 inline" />
                          ) : (
                            <Terminal className="w-3 h-3 inline" />
                          )}
                        </span>
                        <span className="text-sm font-medium text-gray-900 dark:text-white truncate">
                          {run.title || formatPath(run.cwd)}
                        </span>
                      </div>
                      <span className="text-xs text-gray-500 dark:text-gray-400 flex-shrink-0 ml-2">
                        {formatDuration(run.started_at, run.ended_at)}
                      </span>
                    </div>

                    {/* 第二行 */}
                    <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                      <span className="truncate">{formatPath(run.cwd)}</span>
                      <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                        {run.token_input > 0 || run.token_output > 0 ? (
                          <span>{formatTokens(run.token_input + run.token_output)}</span>
                        ) : null}
                        {run.events_count ? <span>{run.events_count} 操作</span> : null}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* 右侧详情 */}
      <div className="flex-1 flex flex-col bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 shadow-sm overflow-hidden">
        {selectedRun ? (
          <>
            {/* 详情头部 */}
            <div className="p-6 border-b border-gray-200 dark:border-slate-700">
              <div className="flex items-start justify-between mb-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <span
                      className={`px-2.5 py-1 text-xs rounded-lg font-medium ${
                        selectedRun.status === 'running'
                          ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                          : selectedRun.status === 'done'
                          ? 'bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-gray-300'
                          : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                      }`}
                    >
                      {selectedRun.status === 'running'
                        ? '运行中'
                        : selectedRun.status === 'done'
                        ? '已完成'
                        : '已取消'}
                    </span>
                    <span
                      className={`px-2.5 py-1 text-xs rounded-lg ${
                        isInteractive(selectedRun.source)
                          ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
                          : 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400'
                      }`}
                    >
                      {isInteractive(selectedRun.source) ? '有头' : '无头'} · {selectedRun.source}
                    </span>
                  </div>
                  {selectedRun.title && (
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-white truncate mb-1">
                      {selectedRun.title}
                    </h2>
                  )}
                  <p className="text-sm text-gray-500 dark:text-gray-400 truncate">{selectedRun.cwd}</p>
                </div>
                <div className="flex gap-2 ml-4">
                  {selectedRun.status === 'running' && (
                    <button
                      onClick={() => handleKill(selectedRun.id)}
                      disabled={killing === selectedRun.id}
                      className="px-3 py-1.5 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 text-sm rounded-xl hover:bg-red-200 dark:hover:bg-red-900/50 disabled:opacity-50 flex items-center gap-1 transition-colors"
                    >
                      <XCircle className="w-4 h-4" />
                      {killing === selectedRun.id ? '...' : '终止'}
                    </button>
                  )}
                  <button
                    onClick={() => handleDelete(selectedRun.id)}
                    className="px-3 py-1.5 bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-gray-300 text-sm rounded-xl hover:bg-gray-200 dark:hover:bg-slate-600 flex items-center gap-1 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                    删除
                  </button>
                </div>
              </div>

              {/* 统计信息 */}
              <div className="grid grid-cols-6 gap-4 p-4 bg-gray-50 dark:bg-slate-700/50 rounded-xl">
                <div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">模型</div>
                  <div className="text-sm font-medium text-gray-900 dark:text-white truncate" title={selectedRun.model || '-'}>
                    {selectedRun.model?.replace('claude-', '').replace('-20251101', '') || '-'}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">时长</div>
                  <div className="text-sm font-medium text-gray-900 dark:text-white">
                    {formatDuration(selectedRun.started_at, selectedRun.ended_at)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">操作数</div>
                  <div className="text-sm font-medium text-gray-900 dark:text-white">{selectedRun.events_count || 0}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">输入 Token</div>
                  <div className="text-sm font-medium text-gray-900 dark:text-white">
                    {formatTokens(selectedRun.token_input || 0)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">输出 Token</div>
                  <div className="text-sm font-medium text-gray-900 dark:text-white">
                    {formatTokens(selectedRun.token_output || 0)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">预估费用</div>
                  <div className="text-sm font-medium text-green-600 dark:text-green-400">
                    {estimateCost(selectedRun.token_input || 0, selectedRun.token_output || 0)}
                  </div>
                </div>
              </div>

              {/* Session ID */}
              <div className="mt-3 text-xs text-gray-400 dark:text-gray-500">Session: {selectedRun.session_id}</div>

              {/* AI Factory Progress */}
              {(() => {
                const aiFactoryState = parseAIFactoryState(events);
                return aiFactoryState ? <AIFactoryProgress state={aiFactoryState} /> : null;
              })()}
            </div>

            {/* 事件列表 */}
            <div className="flex-1 overflow-hidden flex flex-col">
              <div className="px-6 py-3 border-b border-gray-200 dark:border-slate-700 flex items-center justify-between">
                <span className="text-sm font-medium text-gray-700 dark:text-gray-200">操作历史</span>
                <span className="text-xs text-gray-500 dark:text-gray-400">{events.length} 条记录</span>
              </div>
              <div ref={eventsRef} className="flex-1 overflow-y-auto p-4">
                {events.length === 0 ? (
                  <div className="text-center text-gray-400 dark:text-gray-500 py-12">暂无记录</div>
                ) : (
                  <div className="space-y-2">
                    {events.map((event) => {
                      const { type, detail } = getEventDisplay(event);
                      const isUser = event.type === 'user.message';
                      const isAssistant = event.type === 'assistant.message';
                      const isExpanded = expandedEvents.has(event.id);
                      let payload: Record<string, unknown> = {};
                      try {
                        payload = event.payload ? JSON.parse(event.payload) : {};
                      } catch {}

                      return (
                        <div
                          key={event.id}
                          className={`rounded-xl cursor-pointer transition-all ${
                            isUser
                              ? 'bg-blue-50 dark:bg-blue-900/20 border-l-2 border-l-blue-500'
                              : isAssistant
                              ? 'bg-gray-50 dark:bg-slate-700/50 border-l-2 border-l-gray-400 dark:border-l-gray-500'
                              : 'bg-white dark:bg-slate-800 hover:bg-gray-50 dark:hover:bg-slate-700 border border-gray-200 dark:border-slate-600'
                          }`}
                          onClick={() => toggleEvent(event.id)}
                        >
                          <div className="px-4 py-3 flex items-start gap-3">
                            <span className="text-xs text-gray-400 dark:text-gray-500 w-16 flex-shrink-0 pt-0.5">
                              {formatTime(event.created_at)}
                            </span>
                            <div className="flex items-center gap-2 w-20 flex-shrink-0 text-gray-500 dark:text-gray-400">
                              {getToolIcon(event.tool_name)}
                              <span
                                className={`text-xs ${
                                  isUser
                                    ? 'text-blue-700 dark:text-blue-400 font-medium'
                                    : isAssistant
                                    ? 'text-gray-700 dark:text-gray-300 font-medium'
                                    : 'text-gray-600 dark:text-gray-400'
                                }`}
                              >
                                {type}
                              </span>
                            </div>
                            <span
                              className={`flex-1 text-sm ${
                                isUser || isAssistant
                                  ? 'text-gray-900 dark:text-white'
                                  : 'text-gray-600 dark:text-gray-300 font-mono'
                              } ${!isExpanded ? 'truncate' : ''}`}
                            >
                              {detail || '-'}
                            </span>
                            <ChevronDown
                              className={`w-4 h-4 text-gray-400 dark:text-gray-500 flex-shrink-0 transition-transform ${
                                isExpanded ? 'rotate-180' : ''
                              }`}
                            />
                          </div>
                          {isExpanded && Object.keys(payload).length > 0 && (
                            <div className="px-4 pb-3 pt-0">
                              <pre className="text-xs text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-slate-900 p-3 rounded-lg overflow-x-auto max-h-64 overflow-y-auto whitespace-pre-wrap break-words">
                                {JSON.stringify(payload, null, 2)}
                              </pre>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-400 dark:text-gray-500">
            <Activity className="w-16 h-16 mb-4" />
            <p>选择一个会话查看详情</p>
          </div>
        )}
      </div>
    </div>
  );
}
