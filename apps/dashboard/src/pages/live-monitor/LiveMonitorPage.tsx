/**
 * LiveMonitorPage v2 - Real-time Task Flow Monitor (tmux Style)
 *
 * 实时任务流监控中心
 * 布局：左侧主控（2/3）+ 右侧 Agent 窗格（1/3）
 * 数据：Brain API 轮询 + 模拟 Agent 日志
 */

import { useState, useEffect, useRef } from 'react';
import {
  Activity,
  Cpu,
  MemoryStick,
  HardDrive,
  Zap,
  Clock,
  Users,
  AlertTriangle,
  Info,
  CheckCircle,
  GitBranch,
  Loader,
} from 'lucide-react';

// ============ Types ============
interface BrainTask {
  id: string;
  title: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  priority: 'P0' | 'P1' | 'P2';
  progress?: number;
  executor?: string;
  started_at?: string;
  estimated_duration?: number;
  metadata?: {
    current_step?: string;
    step_number?: number;
    total_steps?: number;
  };
}

interface BrainFocus {
  okr_title?: string;
  okr_priority?: string;
  okr_progress?: number;
  project_name?: string;
  task?: BrainTask;
}

interface BrainStatus {
  tick_number: number;
  alertness: { level: number; name: string };
  uptime_seconds: number;
  running_tasks_count: number;
  queued_tasks_count: number;
  completed_today_count: number;
}

interface TaskFlowEvent {
  timestamp: string;
  agent: string;
  message: string;
  icon: string;
}

interface AgentLog {
  text: string;
  timestamp: number;
}

interface AgentState {
  name: string;
  icon: string;
  status: 'Running' | 'Idle';
  task?: BrainTask;
  logs: AgentLog[];
}

// ============ Helper Functions ============
function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (days > 0) {
    return `${days}d ${hours}h`;
  }
  return `${hours}h ${minutes}m`;
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m ${secs}s`;
}

function formatTime(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

function calculateRunningDuration(startedAt: string): number {
  return Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
}

// ============ Mock Data Generators ============
function generateMockAgentLog(agentName: string): string {
  const logTemplates: Record<string, string[]> = {
    Caramel: [
      '> 编辑 LiveMonitorPage.tsx...',
      '> 添加新组件 CurrentFocus',
      '> 运行测试 npm test',
      '> 提交代码 git commit',
      '> 等待 CI 检查...',
      '> 修复 TypeScript 错误',
      '> 优化组件性能',
    ],
    秋米: [
      '> 分析 OKR: Quality Monitor v2',
      '> 拆解 KR #1 为 Features',
      '> 生成 Task 优先级排序',
      '> 评估工作量 3-5 天',
      '> 更新 Project 进度',
      '> 检查依赖关系',
    ],
    小检: [
      '> 扫描 RCI 覆盖率...',
      '> 检查回归契约 C2-001',
      '> 分析代码质量指标',
      '> 验证 DoD 映射',
      '> 生成质检报告',
      '> 发现 3 个潜在问题',
    ],
  };

  const templates = logTemplates[agentName] || ['> Processing...'];
  return templates[Math.floor(Math.random() * templates.length)];
}

// ============ Components ============
function CurrentFocusCard({ focus }: { focus: BrainFocus | null }) {
  if (!focus || !focus.task) {
    return (
      <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Zap className="w-5 h-5 text-yellow-500" />
          📌 Current Focus
        </h3>
        <div className="text-gray-400">No active task</div>
      </div>
    );
  }

  const { task } = focus;
  const runningDuration = task.started_at ? calculateRunningDuration(task.started_at) : 0;

  return (
    <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
      <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
        <Zap className="w-5 h-5 text-yellow-500" />
        📌 Current Focus
      </h3>

      <div className="space-y-3">
        {/* OKR */}
        {focus.okr_title && (
          <div>
            <div className="text-sm text-gray-400">OKR</div>
            <div className="font-medium">
              {focus.okr_title}
              {focus.okr_priority && (
                <span className="ml-2 px-2 py-0.5 text-xs rounded bg-red-500/20 text-red-400">
                  {focus.okr_priority}
                </span>
              )}
            </div>
            {focus.okr_progress !== undefined && (
              <div className="mt-1 h-1 bg-gray-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500"
                  style={{ width: `${focus.okr_progress}%` }}
                />
              </div>
            )}
          </div>
        )}

        {/* Project */}
        {focus.project_name && (
          <div className="ml-4">
            <div className="text-sm text-gray-400">└─ Project</div>
            <div className="font-medium">{focus.project_name}</div>
          </div>
        )}

        {/* Task */}
        <div className="ml-8">
          <div className="text-sm text-gray-400">└─ Task</div>
          <div className="font-medium">
            {task.title}
            {task.id && <span className="text-gray-500 ml-2">#{task.id}</span>}
          </div>

          {/* Step info */}
          {task.metadata?.current_step && (
            <div className="mt-2 text-sm text-gray-300">
              Step: {task.metadata.step_number}/{task.metadata.total_steps} - {task.metadata.current_step}
            </div>
          )}

          {/* Executor */}
          {task.executor && (
            <div className="mt-1 text-sm text-gray-400">
              Executor: <span className="text-blue-400">{task.executor}</span>
            </div>
          )}

          {/* Running duration */}
          {task.started_at && (
            <div className="mt-1 text-sm text-gray-400">
              Running: {formatDuration(runningDuration)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function NextInQueueCard({ tasks }: { tasks: BrainTask[] }) {
  return (
    <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
      <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
        <Users className="w-5 h-5 text-purple-500" />
        📋 Next in Queue ({tasks.length} total)
      </h3>

      {tasks.length === 0 ? (
        <div className="text-gray-400">Queue is empty</div>
      ) : (
        <div className="space-y-3">
          {tasks.slice(0, 5).map((task, index) => (
            <div key={task.id} className="border-l-2 border-gray-600 pl-3">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="font-medium">
                    {index + 1}. {task.title}
                    <span className={`ml-2 px-2 py-0.5 text-xs rounded ${
                      task.priority === 'P0' ? 'bg-red-500/20 text-red-400' :
                      task.priority === 'P1' ? 'bg-orange-500/20 text-orange-400' :
                      'bg-blue-500/20 text-blue-400'
                    }`}>
                      {task.priority}
                    </span>
                  </div>
                  {task.metadata?.current_step && (
                    <div className="text-sm text-gray-400 mt-1">
                      Project: {task.metadata.current_step}
                    </div>
                  )}
                  {task.estimated_duration && (
                    <div className="text-sm text-gray-400">
                      Estimated: {Math.floor(task.estimated_duration / 60)}min
                    </div>
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

function RealtimeMetricsCard({ status }: { status: BrainStatus | null }) {
  if (!status) {
    return (
      <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Activity className="w-5 h-5 text-green-500" />
          📊 Real-time Metrics
        </h3>
        <div className="text-gray-400">Loading...</div>
      </div>
    );
  }

  return (
    <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
      <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
        <Activity className="w-5 h-5 text-green-500" />
        📊 Real-time Metrics
      </h3>

      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <div className="text-gray-400">Tasks</div>
          <div className="font-mono">
            Running: {status.running_tasks_count} |
            Queued: {status.queued_tasks_count} |
            Done Today: {status.completed_today_count}
          </div>
        </div>

        <div>
          <div className="text-gray-400">Brain</div>
          <div className="font-mono">
            Tick #{status.tick_number} |
            {status.alertness.name} |
            {formatUptime(status.uptime_seconds)}
          </div>
        </div>
      </div>
    </div>
  );
}

function LiveTaskFlowCard({ events }: { events: TaskFlowEvent[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [events]);

  return (
    <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
      <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
        <GitBranch className="w-5 h-5 text-cyan-500" />
        🔄 Live Task Flow
      </h3>

      <div
        ref={scrollRef}
        className="space-y-2 max-h-96 overflow-y-auto font-mono text-sm"
      >
        {events.length === 0 ? (
          <div className="text-gray-400">No recent events</div>
        ) : (
          events.map((event, index) => (
            <div key={index} className="flex items-start gap-2 text-gray-300">
              <span className="text-gray-500">{formatTime(event.timestamp)}</span>
              <span>{event.icon}</span>
              <span className="text-blue-400">{event.agent}</span>
              <span>→</span>
              <span className="flex-1">{event.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function AgentPane({ agent }: { agent: AgentState }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [agent.logs]);

  return (
    <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-700 bg-gray-750">
        <div className="flex items-center justify-between">
          <span className="font-semibold">
            {agent.icon} {agent.name}
          </span>
          <span className={`px-2 py-0.5 text-xs rounded ${
            agent.status === 'Running'
              ? 'bg-green-500/20 text-green-400'
              : 'bg-gray-500/20 text-gray-400'
          }`}>
            {agent.status}
          </span>
        </div>
        {agent.task && (
          <div className="text-sm text-gray-400 mt-1 truncate">
            Task: {agent.task.title}
            {agent.task.metadata?.current_step && (
              <span className="ml-2">
                ({agent.task.metadata.step_number}/{agent.task.metadata.total_steps})
              </span>
            )}
          </div>
        )}
      </div>

      {/* Log Output */}
      <div
        ref={scrollRef}
        className="px-4 py-3 font-mono text-xs h-32 overflow-y-auto bg-gray-900"
      >
        {agent.logs.length === 0 ? (
          <div className="text-gray-500">Waiting...</div>
        ) : (
          agent.logs.map((log, index) => (
            <div key={index} className="text-gray-300 truncate">
              {log.text}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ============ Main Component ============
export default function LiveMonitorPage() {
  const [focus, setFocus] = useState<BrainFocus | null>(null);
  const [queuedTasks, setQueuedTasks] = useState<BrainTask[]>([]);
  const [status, setStatus] = useState<BrainStatus | null>(null);
  const [taskFlowEvents, setTaskFlowEvents] = useState<TaskFlowEvent[]>([]);
  const [agents, setAgents] = useState<AgentState[]>([
    { name: 'Caramel', icon: '🤖', status: 'Idle', logs: [] },
    { name: '秋米', icon: '🍂', status: 'Idle', logs: [] },
    { name: '小检', icon: '🔍', status: 'Idle', logs: [] },
  ]);

  // Fetch Brain data (focus, queue, status)
  useEffect(() => {
    const fetchBrainData = async () => {
      try {
        // Note: In real implementation, fetch from Brain API
        // For now, use mock data

        // Mock focus
        setFocus({
          okr_title: 'Quality Monitor v2',
          okr_priority: 'P0',
          okr_progress: 80,
          project_name: 'cecelia-workspace',
          task: {
            id: '309',
            title: 'LiveMonitor v2 - Real-time Task Flow',
            status: 'in_progress',
            priority: 'P0',
            executor: 'Caramel',
            started_at: new Date(Date.now() - 900000).toISOString(), // 15min ago
            metadata: {
              current_step: 'Writing Code',
              step_number: 5,
              total_steps: 11,
            },
          },
        });

        // Mock queue
        setQueuedTasks([
          {
            id: '310',
            title: 'QA Regression Scan',
            status: 'pending',
            priority: 'P0',
            estimated_duration: 1800,
          },
          {
            id: '311',
            title: 'Code Audit - Security Review',
            status: 'pending',
            priority: 'P1',
            estimated_duration: 2700,
          },
          {
            id: '312',
            title: 'Platform Scraper - 小红书数据',
            status: 'pending',
            priority: 'P1',
            estimated_duration: 1200,
          },
        ]);

        // Mock status
        setStatus({
          tick_number: 1847,
          alertness: { level: 1, name: 'NORMAL' },
          uptime_seconds: 87345,
          running_tasks_count: 2,
          queued_tasks_count: 12,
          completed_today_count: 156,
        });

      } catch (error) {
        console.error('Failed to fetch Brain data:', error);
      }
    };

    fetchBrainData();
    const interval = setInterval(fetchBrainData, 2000);
    return () => clearInterval(interval);
  }, []);

  // Generate task flow events
  useEffect(() => {
    const generateEvent = () => {
      const agentNames = ['Caramel', '秋米', '小检'];
      const agentIcons = ['🤖', '🍂', '🔍'];
      const randomAgent = Math.floor(Math.random() * agentNames.length);

      const messages = [
        `Step 5/11: Writing code`,
        `Started Task #${Math.floor(Math.random() * 100) + 300}`,
        `Completed OKR breakdown`,
        `Running tests...`,
        `QA Analysis in progress`,
        `Checking RCI coverage`,
      ];

      const newEvent: TaskFlowEvent = {
        timestamp: new Date().toISOString(),
        agent: agentNames[randomAgent],
        icon: agentIcons[randomAgent],
        message: messages[Math.floor(Math.random() * messages.length)],
      };

      setTaskFlowEvents(prev => [newEvent, ...prev.slice(0, 19)]);
    };

    const interval = setInterval(generateEvent, 3000);
    return () => clearInterval(interval);
  }, []);

  // Update agent logs
  useEffect(() => {
    const updateAgentLogs = () => {
      setAgents(prev => {
        const updated = [...prev];
        const randomIndex = Math.floor(Math.random() * updated.length);
        const agent = updated[randomIndex];

        const newLog: AgentLog = {
          text: generateMockAgentLog(agent.name),
          timestamp: Date.now(),
        };

        agent.logs = [...agent.logs.slice(-9), newLog];
        agent.status = Math.random() > 0.3 ? 'Running' : 'Idle';

        return updated;
      });
    };

    const interval = setInterval(updateAgentLogs, 3500);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen bg-gray-900 text-white p-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold flex items-center gap-3">
          <Activity className="w-8 h-8 text-red-500 animate-pulse" />
          Cecelia Live Monitor
        </h1>
        <p className="text-gray-400 mt-1">
          实时任务流监控中心 - Brain 状态、任务队列、Agent 活动
        </p>
      </div>

      {/* Main Layout: Left (2/3) + Right (1/3) */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Left: Main Control Area (2 columns) */}
        <div className="xl:col-span-2 space-y-6">
          <CurrentFocusCard focus={focus} />
          <NextInQueueCard tasks={queuedTasks} />
          <RealtimeMetricsCard status={status} />
          <LiveTaskFlowCard events={taskFlowEvents} />
        </div>

        {/* Right: Agent Panes (1 column) */}
        <div className="space-y-4">
          {agents.map(agent => (
            <AgentPane key={agent.name} agent={agent} />
          ))}
        </div>
      </div>
    </div>
  );
}
