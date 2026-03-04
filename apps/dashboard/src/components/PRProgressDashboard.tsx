import React, { useState, useEffect, useCallback } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

// ── 数据类型 ──────────────────────────────────────────────────────────────────

interface TaskItem {
  id: string;
  title: string;
  status: string;
  task_type: string;
  completed_at: string | null;
  created_at: string;
  metadata?: {
    error?: string;
    [key: string]: unknown;
  };
}

interface GoalItem {
  id: string;
  title: string;
  progress: number;
  status: string;
  priority: string;
}

interface DailyCount {
  date: string;
  count: number;
}

interface PRProgressData {
  completedTasks: TaskItem[];
  failedTasks: TaskItem[];
  goal: GoalItem | null;
  dailyTrend: DailyCount[];
  totalCompleted: number;
  target: number;
  percentage: number;
}

// ── 常量 ──────────────────────────────────────────────────────────────────────

const KR_GOAL_ID = 'e5ec0510-d7b2-4ee7-99f6-314aac55b3f6';
const PR_TARGET = 30;

// ── 工具函数 ──────────────────────────────────────────────────────────────────

function getProgressColor(percentage: number): { bar: string; text: string; glow: string } {
  if (percentage >= 70) {
    return { bar: '#10b981', text: '#10b981', glow: '#10b98133' };
  } else if (percentage >= 30) {
    return { bar: '#f59e0b', text: '#f59e0b', glow: '#f59e0b33' };
  } else {
    return { bar: '#ef4444', text: '#ef4444', glow: '#ef444433' };
  }
}

function formatDateTime(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffMins = Math.floor(diffMs / (1000 * 60));

  if (diffMins < 60) return `${diffMins}分钟前`;
  if (diffHours < 24) return `${diffHours}小时前`;
  const month = d.getMonth() + 1;
  const day = d.getDate();
  return `${month}/${day}`;
}

function buildDailyTrend(tasks: TaskItem[]): DailyCount[] {
  const now = new Date();
  const days: DailyCount[] = [];

  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    d.setHours(0, 0, 0, 0);
    const nextD = new Date(d);
    nextD.setDate(nextD.getDate() + 1);

    const count = tasks.filter((t) => {
      if (!t.completed_at) return false;
      const completedAt = new Date(t.completed_at);
      return completedAt >= d && completedAt < nextD;
    }).length;

    days.push({
      date: `${d.getMonth() + 1}/${d.getDate()}`,
      count,
    });
  }

  return days;
}

// ── 卡片基础样式 ──────────────────────────────────────────────────────────────

const cardStyle: React.CSSProperties = {
  background: '#161b22',
  border: '1px solid #21262d',
  borderRadius: 8,
  padding: '12px 14px',
};

const sectionLabelStyle: React.CSSProperties = {
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: 1,
  textTransform: 'uppercase' as const,
  color: '#484f58',
  marginBottom: 8,
};

// ── PR 计数器卡片 ──────────────────────────────────────────────────────────────

interface PRCounterCardProps {
  totalCompleted: number;
  target: number;
  percentage: number;
}

const PRCounterCard: React.FC<PRCounterCardProps> = ({ totalCompleted, target, percentage }) => {
  const colors = getProgressColor(percentage);

  return (
    <div style={cardStyle}>
      <div style={sectionLabelStyle}>本月自主 PR 进度</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 8 }}>
        <span style={{ fontSize: 28, fontWeight: 700, color: colors.text, fontFamily: 'monospace' }}>
          {totalCompleted}
        </span>
        <span style={{ fontSize: 14, color: '#484f58' }}>/ {target}</span>
        <span style={{ fontSize: 12, color: colors.text, marginLeft: 'auto' }}>
          {percentage}%
        </span>
      </div>

      <div
        style={{
          width: '100%',
          height: 6,
          background: '#21262d',
          borderRadius: 3,
          overflow: 'hidden',
          marginBottom: 6,
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${Math.min(percentage, 100)}%`,
            background: colors.bar,
            borderRadius: 3,
            transition: 'width 0.5s ease',
            boxShadow: `0 0 8px ${colors.glow}`,
          }}
          role="progressbar"
          aria-valuenow={percentage}
          aria-valuemin={0}
          aria-valuemax={100}
        />
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#484f58' }}>
        <span>还差 {Math.max(0, target - totalCompleted)} 个达成目标</span>
        <span>{new Date().getMonth() + 1} 月</span>
      </div>
    </div>
  );
};

// ── 趋势图 ────────────────────────────────────────────────────────────────────

interface TrendChartProps {
  data: DailyCount[];
}

const TrendChart: React.FC<TrendChartProps> = ({ data }) => {
  const maxCount = Math.max(...data.map((d) => d.count), 1);

  return (
    <div style={cardStyle}>
      <div style={sectionLabelStyle}>过去 7 天 PR 产出趋势</div>
      <ResponsiveContainer width="100%" height={100}>
        <LineChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#21262d" />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 9, fill: '#484f58' }}
            tickLine={false}
            axisLine={{ stroke: '#21262d' }}
          />
          <YAxis
            tick={{ fontSize: 9, fill: '#484f58' }}
            tickLine={false}
            axisLine={false}
            domain={[0, Math.ceil(maxCount * 1.2) || 5]}
            allowDecimals={false}
          />
          <Tooltip
            contentStyle={{
              background: '#0d1117',
              border: '1px solid #21262d',
              borderRadius: 4,
              fontSize: 10,
              color: '#c9d1d9',
            }}
            formatter={(value: number) => [`${value} 个 PR`, '完成']}
            labelStyle={{ color: '#8b949e', marginBottom: 2 }}
          />
          <Line
            type="monotone"
            dataKey="count"
            stroke="#58a6ff"
            strokeWidth={1.5}
            dot={{ fill: '#58a6ff', r: 3, strokeWidth: 0 }}
            activeDot={{ r: 4, fill: '#58a6ff', strokeWidth: 0 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};

// ── KR 进度卡片 ──────────────────────────────────────────────────────────────

interface KRProgressCardProps {
  goal: GoalItem | null;
  completedPRs: number;
}

const KRProgressCard: React.FC<KRProgressCardProps> = ({ goal, completedPRs }) => {
  if (!goal) {
    return (
      <div style={cardStyle}>
        <div style={sectionLabelStyle}>KR 进度</div>
        <p style={{ fontSize: 10, color: '#484f58', margin: 0 }}>KR 未找到</p>
      </div>
    );
  }

  const calculatedProgress = Math.min(Math.round((completedPRs / PR_TARGET) * 100), 100);
  const colors = getProgressColor(calculatedProgress);
  const priorityColors: Record<string, string> = {
    P0: '#ef4444',
    P1: '#f59e0b',
    P2: '#58a6ff',
  };
  const priorityColor = priorityColors[goal.priority] ?? '#484f58';

  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={sectionLabelStyle}>KR 进度</div>
        <span
          style={{
            fontSize: 9,
            fontWeight: 700,
            color: priorityColor,
            background: priorityColor + '22',
            padding: '1px 6px',
            borderRadius: 10,
            border: `1px solid ${priorityColor}44`,
          }}
        >
          {goal.priority}
        </span>
      </div>

      <p style={{ fontSize: 11, color: '#c9d1d9', marginBottom: 8, lineHeight: 1.4 }}>{goal.title}</p>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <div
          style={{
            flex: 1,
            height: 4,
            background: '#21262d',
            borderRadius: 2,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${calculatedProgress}%`,
              background: colors.bar,
              borderRadius: 2,
              transition: 'width 0.5s ease',
            }}
            role="progressbar"
            aria-valuenow={calculatedProgress}
            aria-valuemin={0}
            aria-valuemax={100}
          />
        </div>
        <span style={{ fontSize: 11, fontWeight: 700, color: colors.text, fontFamily: 'monospace', minWidth: 32 }}>
          {calculatedProgress}%
        </span>
      </div>

      <p style={{ fontSize: 9, color: '#484f58', margin: 0 }}>
        基于 {completedPRs}/{PR_TARGET} 个自主 PR 计算
      </p>
    </div>
  );
};

// ── 失败任务列表 ──────────────────────────────────────────────────────────────

interface FailedTasksCardProps {
  tasks: TaskItem[];
}

const FailedTasksCard: React.FC<FailedTasksCardProps> = ({ tasks }) => {
  return (
    <div style={cardStyle}>
      <div style={sectionLabelStyle}>最近失败任务</div>
      {tasks.length === 0 ? (
        <p style={{ fontSize: 10, color: '#484f58', margin: 0 }}>无失败任务</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {tasks.map((task) => (
            <div
              key={task.id}
              style={{
                padding: '6px 8px',
                background: '#0d1117',
                borderRadius: 4,
                border: '1px solid #ef444422',
                borderLeft: '2px solid #ef4444',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                <p
                  style={{
                    fontSize: 10,
                    color: '#c9d1d9',
                    margin: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    flex: 1,
                  }}
                >
                  {task.title}
                </p>
                <span style={{ fontSize: 9, color: '#484f58', whiteSpace: 'nowrap', flexShrink: 0 }}>
                  {task.completed_at
                    ? formatDateTime(task.completed_at)
                    : formatDateTime(task.created_at)}
                </span>
              </div>
              {task.metadata?.error && (
                <p
                  style={{
                    fontSize: 9,
                    color: '#ef4444',
                    margin: '3px 0 0',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {String(task.metadata.error).slice(0, 80)}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ── 主组件 ────────────────────────────────────────────────────────────────────

interface PRProgressDashboardProps {
  refreshInterval?: number;
}

export const PRProgressDashboard: React.FC<PRProgressDashboardProps> = ({
  refreshInterval = 60000,
}) => {
  const [data, setData] = useState<PRProgressData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [completedRes, failedRes, goalRes] = await Promise.allSettled([
        fetch(
          `/api/brain/tasks?task_type=dev&status=completed&goal_id=${KR_GOAL_ID}&limit=200`
        ).then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json() as Promise<TaskItem[]>;
        }),
        fetch('/api/brain/tasks?status=failed&limit=5').then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json() as Promise<TaskItem[]>;
        }),
        fetch(`/api/brain/goals/${KR_GOAL_ID}`).then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json() as Promise<GoalItem>;
        }),
      ]);

      const completedTasks =
        completedRes.status === 'fulfilled' ? completedRes.value : [];
      const failedTasks =
        failedRes.status === 'fulfilled' ? failedRes.value : [];
      const goal = goalRes.status === 'fulfilled' ? goalRes.value : null;

      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const thisMonthTasks = completedTasks.filter((t) => {
        if (!t.completed_at) return false;
        return new Date(t.completed_at) >= monthStart;
      });

      const totalCompleted = thisMonthTasks.length;
      const percentage = Math.min(Math.round((totalCompleted / PR_TARGET) * 100), 100);
      const dailyTrend = buildDailyTrend(completedTasks);

      setData({
        completedTasks: thisMonthTasks,
        failedTasks,
        goal,
        dailyTrend,
        totalCompleted,
        target: PR_TARGET,
        percentage,
      });
      setError(null);
      setLastUpdated(new Date());
    } catch (err) {
      setError('数据加载失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const timer = setInterval(fetchData, refreshInterval);
    return () => clearInterval(timer);
  }, [fetchData, refreshInterval]);

  if (loading) {
    return (
      <div style={{ padding: '8px 0' }}>
        <div style={{ ...cardStyle, display: 'flex', alignItems: 'center', gap: 8 }}>
          <div
            style={{
              width: 12,
              height: 12,
              border: '2px solid #21262d',
              borderTopColor: '#58a6ff',
              borderRadius: '50%',
            }}
          />
          <span style={{ fontSize: 11, color: '#484f58' }}>加载 PR 进度数据...</span>
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div style={{ padding: '8px 0' }}>
        <div style={{ ...cardStyle, borderColor: '#ef444433' }}>
          <p style={{ fontSize: 11, color: '#ef4444', margin: 0 }}>{error}</p>
        </div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div
          style={{
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: 1,
            textTransform: 'uppercase',
            color: '#484f58',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: '#58a6ff',
              display: 'inline-block',
              boxShadow: '0 0 6px #58a6ff88',
            }}
          />
          PR 进度看板
        </div>
        {lastUpdated && (
          <span style={{ fontSize: 9, color: '#30363d' }}>
            更新于{' '}
            {lastUpdated.toLocaleTimeString('zh-CN', {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
        )}
      </div>

      <PRCounterCard
        totalCompleted={data.totalCompleted}
        target={data.target}
        percentage={data.percentage}
      />

      <TrendChart data={data.dailyTrend} />

      <KRProgressCard goal={data.goal} completedPRs={data.totalCompleted} />

      <FailedTasksCard tasks={data.failedTasks} />
    </div>
  );
};

export default PRProgressDashboard;
