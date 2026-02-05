/**
 * EngineDashboard - Engine 工作台首页
 * 玻璃科技风 - Glassmorphism + 高级感 + 动画
 */

import { useEffect, useState, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  GitBranch,
  CheckCircle2,
  Clock,
  AlertCircle,
  Cpu,
  Code,
  ArrowRight,
  RefreshCw,
  Terminal,
  Zap,
  Sun,
  Cloud,
  CloudRain,
  CloudSnow,
  Quote,
  Timer,
  PartyPopper,
  Bot,
} from 'lucide-react';
import { getAllTasks, type DevTaskStatus } from '../api/dev-tracker.api';
import { getEngineInfo, type EngineInfo } from '../api/engine.api';

// Stub for auth context - replace with actual implementation if needed
const useAuth = () => ({ user: { name: 'Developer' } });

// ============ 天气和问候语相关 ============

const DAILY_QUOTES = [
  { text: '把每一件简单的事做好就是不简单。', author: '稻盛和夫' },
  { text: '不要等待机会，而要创造机会。', author: '林肯' },
  { text: '成功不是终点，失败也不是终结，唯有勇气才是永恒。', author: '丘吉尔' },
  { text: '今天的努力是明天的礼物。', author: '佚名' },
  { text: '专注于当下，未来自然清晰。', author: '佚名' },
  { text: 'Code is poetry.', author: 'WordPress' },
  { text: 'Talk is cheap. Show me the code.', author: 'Linus Torvalds' },
  { text: '代码写得好，BUG 少不了。', author: '程序员' },
  { text: '今天的 TODO，就是明天的 DONE。', author: '乐观开发者' },
  { text: 'Stay hungry, stay foolish.', author: 'Steve Jobs' },
];

const HOLIDAYS: Record<string, { name: string; greeting: string }> = {
  '01-01': { name: '元旦', greeting: '新年快乐' },
  '02-14': { name: '情人节', greeting: '愿你被爱包围' },
  '05-01': { name: '劳动节', greeting: '休息一下吧' },
  '10-01': { name: '国庆节', greeting: '祖国生日快乐' },
  '12-25': { name: '圣诞节', greeting: 'Merry Christmas' },
};

const getHoliday = () => {
  const now = new Date();
  const key = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return HOLIDAYS[key] || null;
};

const getDailyQuote = () => {
  const today = new Date();
  const seed = today.getFullYear() * 10000 + (today.getMonth() + 1) * 100 + today.getDate();
  return DAILY_QUOTES[seed % DAILY_QUOTES.length];
};

const getOffWorkCountdown = () => {
  const now = new Date();
  const day = now.getDay();
  if (day === 0 || day === 6) return null;
  const timeValue = now.getHours() + now.getMinutes() / 60;
  if (timeValue < 8.5 || timeValue >= 18) return null;
  const offWorkTime = new Date(now);
  offWorkTime.setHours(18, 0, 0, 0);
  const diff = offWorkTime.getTime() - now.getTime();
  return { hours: Math.floor(diff / 3600000), minutes: Math.floor((diff % 3600000) / 60000) };
};

const getWeekendCountdown = () => {
  const day = new Date().getDay();
  return day === 0 || day === 6 ? null : 6 - day;
};

interface WeatherInfo {
  temp: string;
  desc: string;
  icon: 'sun' | 'cloud' | 'rain' | 'snow';
  city: string;
}

const getWeatherIcon = (code: string) => {
  const c = parseInt(code);
  if (c >= 600 && c < 700) return 'snow';
  if (c >= 200 && c < 600) return 'rain';
  if (c === 800) return 'sun';
  return 'cloud';
};

const getDynamicGreeting = (holiday: ReturnType<typeof getHoliday>) => {
  const hour = new Date().getHours();
  const day = new Date().getDay();

  if (holiday) return { greeting: `${holiday.name}快乐`, subtitle: holiday.greeting };
  if (day === 0 || day === 6) return { greeting: '周末好', subtitle: '享受你的时光' };
  if (hour < 9) return { greeting: '早上好', subtitle: '新的一天，新的可能' };
  if (hour < 12) return { greeting: '上午好', subtitle: '保持专注，效率拉满' };
  if (hour < 14) return { greeting: '中午好', subtitle: '记得吃饭休息' };
  if (hour < 18) return { greeting: '下午好', subtitle: '继续加油' };
  if (hour < 21) return { greeting: '晚上好', subtitle: '辛苦了，注意休息' };
  return { greeting: '夜深了', subtitle: '早点休息吧' };
};

interface RecentActivity {
  id: string;
  type: 'commit' | 'pr' | 'task_start' | 'task_complete' | 'ci_pass' | 'ci_fail';
  title: string;
  project: string;
  time: string;
  branch?: string;
}

// ============ 动画 Hooks ============

// 数字递增动画 Hook
const useCountUp = (end: number, duration = 800) => {
  const [count, setCount] = useState(0);
  const startTime = useRef<number | null>(null);
  const rafId = useRef<number | null>(null);

  useEffect(() => {
    if (end === 0) {
      setCount(0);
      return;
    }

    const animate = (timestamp: number) => {
      if (!startTime.current) startTime.current = timestamp;
      const progress = Math.min((timestamp - startTime.current) / duration, 1);
      // easeOutQuart 缓动函数
      const eased = 1 - Math.pow(1 - progress, 4);
      setCount(Math.floor(eased * end));

      if (progress < 1) {
        rafId.current = requestAnimationFrame(animate);
      } else {
        setCount(end);
      }
    };

    startTime.current = null;
    rafId.current = requestAnimationFrame(animate);

    return () => {
      if (rafId.current) cancelAnimationFrame(rafId.current);
    };
  }, [end, duration]);

  return count;
};

// ============ 骨架屏组件 ============

const SkeletonCard = ({ className = '' }: { className?: string }) => (
  <div className={`rounded-2xl bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 ${className}`}>
    <div className="animate-pulse p-5">
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 bg-slate-200 dark:bg-slate-700 rounded-xl" />
        <div className="flex-1 space-y-2">
          <div className="h-3 bg-slate-200 dark:bg-slate-700 rounded w-1/3" />
          <div className="h-6 bg-slate-200 dark:bg-slate-700 rounded w-1/4" />
        </div>
      </div>
    </div>
  </div>
);

const SkeletonWelcome = () => (
  <div className="rounded-2xl bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 p-6">
    <div className="animate-pulse flex items-center justify-between">
      <div className="space-y-3">
        <div className="h-8 bg-slate-200 dark:bg-slate-700 rounded w-48" />
        <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-32" />
      </div>
      <div className="flex items-center gap-6">
        <div className="space-y-2">
          <div className="h-3 bg-slate-200 dark:bg-slate-700 rounded w-12" />
          <div className="h-5 bg-slate-200 dark:bg-slate-700 rounded w-16" />
        </div>
        <div className="w-16 h-16 bg-slate-200 dark:bg-slate-700 rounded-2xl" />
      </div>
    </div>
  </div>
);

const SkeletonActivity = () => (
  <div className="rounded-2xl bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 lg:col-span-2">
    <div className="p-5 border-b border-slate-200 dark:border-slate-700">
      <div className="h-5 bg-slate-200 dark:bg-slate-700 rounded w-24 animate-pulse" />
    </div>
    <div className="p-4 space-y-3">
      {[1, 2, 3].map((i) => (
        <div key={i} className="animate-pulse p-3 bg-slate-50 dark:bg-slate-700/50 rounded-xl">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 bg-slate-200 dark:bg-slate-600 rounded-lg" />
            <div className="flex-1 space-y-2">
              <div className="h-4 bg-slate-200 dark:bg-slate-600 rounded w-3/4" />
              <div className="h-3 bg-slate-200 dark:bg-slate-600 rounded w-1/2" />
            </div>
          </div>
        </div>
      ))}
    </div>
  </div>
);

// 动画数字组件
const AnimatedNumber = ({ value }: { value: number }) => {
  const count = useCountUp(value, 800);
  return <span>{count}</span>;
};

// ============ 卡片组件 ============

interface GlassCardProps {
  children: React.ReactNode;
  className?: string;
  delay?: number; // 动画延迟(ms)
}

const GlassCard = ({ children, className = '', delay = 0 }: GlassCardProps) => (
  <div
    className={`
      rounded-2xl
      bg-white dark:bg-slate-800/80
      backdrop-blur-xl
      border border-slate-200 dark:border-slate-700
      shadow-lg shadow-slate-200/50 dark:shadow-black/30
      transition-all duration-300 ease-out
      hover:scale-[1.02] hover:-translate-y-0.5 hover:shadow-xl
      animate-fade-in-up
      ${className}
    `}
    style={{ animationDelay: `${delay}ms` }}
  >
    {children}
  </div>
);

// ============ 主组件 ============
export default function EngineDashboard() {
  const { user } = useAuth();
  const [tasks, setTasks] = useState<DevTaskStatus[]>([]);
  const [engineInfo, setEngineInfo] = useState<EngineInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [weather, setWeather] = useState<WeatherInfo | null>(null);
  const [offWorkCountdown, setOffWorkCountdown] = useState(getOffWorkCountdown());

  const holiday = useMemo(() => getHoliday(), []);
  const dailyQuote = useMemo(() => getDailyQuote(), []);
  const greeting = getDynamicGreeting(holiday);
  const weekendCountdown = getWeekendCountdown();

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [tasksRes, engineRes] = await Promise.all([getAllTasks(), getEngineInfo()]);
        if (tasksRes.success && tasksRes.data) setTasks(tasksRes.data);
        if (engineRes.success && engineRes.engine) setEngineInfo(engineRes.engine);
      } catch {
        // Error handled silently - data will show empty state
      } finally {
        setLoading(false);
      }
    };
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setOffWorkCountdown(getOffWorkCountdown()), 60000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const fetchWeather = async () => {
      try {
        const res = await fetch("https://wttr.in/Xi'an?format=j1");
        if (res.ok) {
          const data = await res.json();
          const current = data.current_condition?.[0];
          if (current) {
            setWeather({
              temp: current.temp_C,
              desc: current.lang_zh?.[0]?.value || current.weatherDesc?.[0]?.value || '未知',
              icon: getWeatherIcon(current.weatherCode),
              city: '西安',
            });
          }
        }
      } catch (e) {
        // Weather fetch failed silently
      }
    };
    fetchWeather();
    const timer = setInterval(fetchWeather, 30 * 60 * 1000);
    return () => clearInterval(timer);
  }, []);

  const recentActivities: RecentActivity[] = tasks
    .flatMap((task) => {
      const activities: RecentActivity[] = [];
      const { repo, task: taskInfo, steps, quality } = task;

      if (taskInfo.createdAt) {
        activities.push({
          id: `${repo.name}-start`,
          type: 'task_start',
          title: `开始: ${taskInfo.name || task.branches.current}`,
          project: repo.name,
          time: taskInfo.createdAt,
          branch: task.branches.current,
        });
      }

      steps.items.filter((s) => s.status === 'done' && s.completedAt).forEach((step) => {
        activities.push({
          id: `${repo.name}-step-${step.id}`,
          type: 'task_complete',
          title: `Step ${step.id}: ${step.name}`,
          project: repo.name,
          time: step.completedAt!,
          branch: task.branches.current,
        });
      });

      if (quality.ci === 'passed') {
        activities.push({ id: `${repo.name}-ci`, type: 'ci_pass', title: 'CI 通过', project: repo.name, time: quality.lastCheck, branch: task.branches.current });
      } else if (quality.ci === 'failed') {
        activities.push({ id: `${repo.name}-ci`, type: 'ci_fail', title: 'CI 失败', project: repo.name, time: quality.lastCheck, branch: task.branches.current });
      }

      return activities;
    })
    .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
    .slice(0, 8);

  const stats = {
    active: tasks.filter((t) => t.steps.current > 0 && t.steps.current < 10).length,
    completed: tasks.filter((t) => t.steps.items.every((s) => s.status === 'done' || s.status === 'skipped')).length,
    failed: tasks.filter((t) => t.quality.ci === 'failed').length,
    repos: new Set(tasks.map((t) => t.repo.name)).size,
  };

  const getActivityIcon = (type: RecentActivity['type']) => {
    const icons = {
      commit: <GitBranch className="w-4 h-4 text-slate-500" />,
      pr: <GitBranch className="w-4 h-4 text-slate-400" />,
      task_start: <Zap className="w-4 h-4 text-slate-500" />,
      task_complete: <CheckCircle2 className="w-4 h-4 text-slate-400" />,
      ci_pass: <CheckCircle2 className="w-4 h-4 text-slate-400" />,
      ci_fail: <AlertCircle className="w-4 h-4 text-slate-500" />,
    };
    return icons[type] || <Activity className="w-4 h-4 text-slate-400" />;
  };

  const formatTime = (time: string) => {
    const mins = Math.floor((Date.now() - new Date(time).getTime()) / 60000);
    if (mins < 1) return '刚刚';
    if (mins < 60) return `${mins}分钟前`;
    if (mins < 1440) return `${Math.floor(mins / 60)}小时前`;
    return new Date(time).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  };

  if (loading) {
    return (
      <div className="min-h-screen -m-8 -mt-8 p-8">
        <div className="relative space-y-6 p-2">
          <SkeletonWelcome />
          <div className="flex flex-wrap gap-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="animate-pulse h-9 bg-slate-200 dark:bg-slate-700 rounded-full w-32" />
            ))}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <SkeletonActivity />
            <div className="space-y-4">
              <SkeletonCard className="h-40" />
              <SkeletonCard className="h-32" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen -m-8 -mt-8 p-8">

      <div className="relative space-y-6 p-2">
        {/* 顶部欢迎栏 */}
        <GlassCard className="p-6" delay={0}>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-[#1d1d1f] dark:text-white mb-2">
                {greeting.greeting}，{user?.name || 'Developer'}
              </h1>
              <p className="text-[#86868b] dark:text-slate-300">{greeting.subtitle}</p>
            </div>
            <div className="flex items-center gap-6">
              {engineInfo && (
                <div className="text-right">
                  <p className="text-sm text-[#86868b] dark:text-slate-300">Engine</p>
                  <p className="text-xl font-mono text-slate-600 dark:text-slate-400">v{engineInfo.version}</p>
                </div>
              )}
              <div className="p-4 bg-gradient-to-br from-slate-500 to-slate-600 rounded-2xl shadow-lg">
                <Cpu className="w-10 h-10 text-white" />
              </div>
            </div>
          </div>
        </GlassCard>

        {/* 信息胶囊 */}
        <div className="flex flex-wrap gap-3">
          {weather && (
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-700/80 rounded-full border border-slate-200 dark:border-slate-600 shadow-sm">
              {weather.icon === 'sun' && <Sun className="w-4 h-4 text-slate-500 dark:text-slate-300" />}
              {weather.icon === 'cloud' && <Cloud className="w-4 h-4 text-slate-500 dark:text-slate-300" />}
              {weather.icon === 'rain' && <CloudRain className="w-4 h-4 text-slate-500 dark:text-slate-300" />}
              {weather.icon === 'snow' && <CloudSnow className="w-4 h-4 text-slate-500 dark:text-slate-300" />}
              <span className="text-sm text-slate-700 dark:text-slate-200">
                {weather.city} <span className="font-semibold text-slate-900 dark:text-white">{weather.temp}°</span> {weather.desc}
              </span>
            </div>
          )}

          {offWorkCountdown && (
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-700/80 rounded-full border border-slate-200 dark:border-slate-600 shadow-sm">
              <Timer className="w-4 h-4 text-slate-500 dark:text-slate-300" />
              <span className="text-sm text-slate-700 dark:text-slate-200">
                下班倒计时 <span className="font-semibold text-slate-900 dark:text-white">{offWorkCountdown.hours}h {offWorkCountdown.minutes}m</span>
              </span>
            </div>
          )}

          {weekendCountdown !== null && weekendCountdown > 0 && (
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-700/80 rounded-full border border-slate-200 dark:border-slate-600 shadow-sm">
              <PartyPopper className="w-4 h-4 text-slate-500 dark:text-slate-300" />
              <span className="text-sm text-slate-700 dark:text-slate-200">
                周末还有 <span className="font-semibold text-slate-900 dark:text-white">{weekendCountdown}天</span>
              </span>
            </div>
          )}

          <div className="inline-flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-700/80 rounded-full border border-slate-200 dark:border-slate-600 shadow-sm">
            <Quote className="w-4 h-4 text-slate-500 dark:text-slate-300" />
            <span className="text-sm text-slate-700 dark:text-slate-200">
              {dailyQuote.text} <span className="text-slate-500 dark:text-slate-400">— {dailyQuote.author}</span>
            </span>
          </div>
        </div>

        {/* 统计卡片 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: '进行中', value: stats.active, icon: Activity, iconColor: 'text-violet-600 dark:text-violet-400', bgColor: 'bg-violet-500/10' },
            { label: '已完成', value: stats.completed, icon: CheckCircle2, iconColor: 'text-slate-600 dark:text-slate-400', bgColor: 'bg-slate-500/10' },
            { label: '需关注', value: stats.failed, icon: AlertCircle, iconColor: 'text-slate-600 dark:text-slate-400', bgColor: 'bg-slate-500/10' },
            { label: '活跃仓库', value: stats.repos, icon: GitBranch, iconColor: 'text-purple-600 dark:text-purple-400', bgColor: 'bg-purple-500/10' },
          ].map((stat, index) => (
            <GlassCard key={stat.label} className="p-5" delay={200 + index * 100}>
              <div className="flex items-center gap-4">
                <div className={`p-3 rounded-xl ${stat.bgColor} transition-transform group-hover:scale-110`}>
                  <stat.icon className={`w-5 h-5 ${stat.iconColor}`} />
                </div>
                <div>
                  <p className="text-sm text-[#86868b] dark:text-slate-300">{stat.label}</p>
                  <p className="text-2xl font-semibold text-[#1d1d1f] dark:text-white">
                    <AnimatedNumber value={stat.value} />
                  </p>
                </div>
              </div>
            </GlassCard>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* 最近活动 */}
          <GlassCard className="lg:col-span-2" delay={600}>
            <div className="p-5 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-800 dark:text-white flex items-center gap-2">
                <Clock className="w-5 h-5 text-slate-500 dark:text-slate-400" />
                最近活动
              </h2>
              <Link to="/engine/dev" className="text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 flex items-center gap-1 transition-colors">
                查看全部 <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
            <div className="p-4 space-y-3">
              {recentActivities.length === 0 ? (
                <div className="p-8 text-center text-slate-500 dark:text-slate-400">
                  <Activity className="w-12 h-12 mx-auto mb-3 opacity-50" />
                  <p>暂无最近活动</p>
                </div>
              ) : (
                recentActivities.map((activity) => (
                  <div key={activity.id} className="p-3 bg-slate-50 dark:bg-slate-700/50 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-xl transition-all border border-slate-200 dark:border-slate-600">
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 p-1.5 bg-white dark:bg-slate-600 rounded-lg border border-slate-200 dark:border-slate-500">{getActivityIcon(activity.type)}</div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-800 dark:text-white truncate">{activity.title}</p>
                        <div className="flex items-center gap-2 mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                          <span className="font-mono bg-slate-200 dark:bg-slate-600 px-2 py-0.5 rounded-md text-slate-600 dark:text-slate-300">{activity.project}</span>
                          {activity.branch && (
                            <span className="flex items-center gap-1 text-slate-500 dark:text-slate-400">
                              <GitBranch className="w-3 h-3" />
                              {activity.branch}
                            </span>
                          )}
                        </div>
                      </div>
                      <span className="text-xs text-slate-400 dark:text-slate-500 bg-slate-100 dark:bg-slate-600 px-2 py-1 rounded-md">{formatTime(activity.time)}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </GlassCard>

          {/* 右侧栏 */}
          <div className="space-y-4">
            {/* 进行中的任务 */}
            <GlassCard className="p-5" delay={700}>
              <h3 className="text-sm font-semibold text-slate-800 dark:text-white mb-4 flex items-center gap-2">
                <Terminal className="w-4 h-4 text-slate-500 dark:text-slate-400" />
                进行中
              </h3>
              {tasks.filter((t) => t.steps.current > 0 && t.steps.current < 10).length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400 py-4 text-center">暂无进行中的任务</p>
              ) : (
                <div className="space-y-3">
                  {tasks.filter((t) => t.steps.current > 0 && t.steps.current < 10).slice(0, 3).map((task) => (
                    <Link key={task.repo.name} to="/engine/dev" className="block p-3 bg-slate-50 dark:bg-slate-700/50 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-xl transition-all border border-slate-200 dark:border-slate-600 shadow-sm hover:shadow">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium text-slate-800 dark:text-white truncate">{task.task.name || task.branches.current}</span>
                        <span className="text-xs font-medium text-slate-500 dark:text-slate-300 bg-slate-200 dark:bg-slate-600 px-2 py-0.5 rounded-full">{task.steps.current}/10</span>
                      </div>
                      <div className="w-full h-2 bg-slate-200 dark:bg-slate-600 rounded-full overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-violet-500 to-purple-400 dark:from-violet-400 dark:to-purple-300 rounded-full transition-all" style={{ width: `${(task.steps.current / 10) * 100}%` }} />
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </GlassCard>

            {/* 快捷入口 */}
            <GlassCard className="p-5" delay={800}>
              <h3 className="text-sm font-semibold text-slate-800 dark:text-white mb-4">快捷入口</h3>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { to: '/engine', icon: Cpu, label: '能力概览', accent: false },
                  { to: '/engine/tasks', icon: Activity, label: '任务监控', accent: true },
                  { to: '/engine/dev', icon: Code, label: '开发任务', accent: true },
                  { to: '/cecelia', icon: Bot, label: 'Cecelia', accent: false },
                ].map((item) => (
                  <Link key={item.to} to={item.to} className={`flex items-center gap-2.5 p-3 rounded-xl transition-all group border shadow-sm hover:shadow ${
                    item.accent
                      ? 'bg-violet-50 dark:bg-violet-900/20 hover:bg-violet-100 dark:hover:bg-violet-900/30 border-violet-200 dark:border-violet-700/50'
                      : 'bg-slate-50 dark:bg-slate-700/50 hover:bg-slate-100 dark:hover:bg-slate-700 border-slate-200 dark:border-slate-600'
                  }`}>
                    <item.icon className={`w-4 h-4 transition-colors ${
                      item.accent
                        ? 'text-violet-500 dark:text-violet-400 group-hover:text-violet-600 dark:group-hover:text-violet-300'
                        : 'text-slate-500 dark:text-slate-400 group-hover:text-slate-700 dark:group-hover:text-white'
                    }`} />
                    <span className={`text-sm font-medium transition-colors ${
                      item.accent
                        ? 'text-violet-700 dark:text-violet-300 group-hover:text-violet-800 dark:group-hover:text-violet-200'
                        : 'text-slate-700 dark:text-slate-200 group-hover:text-slate-900 dark:group-hover:text-white'
                    }`}>{item.label}</span>
                  </Link>
                ))}
              </div>
            </GlassCard>

            {/* Engine 能力 */}
            {engineInfo && (
              <GlassCard className="p-5" delay={900}>
                <h3 className="text-sm font-semibold text-slate-800 dark:text-white mb-4 flex items-center gap-2">
                  <Zap className="w-4 h-4 text-slate-500 dark:text-slate-400" />
                  Engine 能力
                </h3>
                <div className="space-y-3 text-sm">
                  <div className="flex justify-between items-center p-2.5 bg-slate-50 dark:bg-slate-700/50 rounded-lg border border-slate-200 dark:border-slate-600">
                    <span className="text-slate-600 dark:text-slate-300">Skills</span>
                    <span className="font-semibold text-slate-800 dark:text-white">{engineInfo.skills.length} 个</span>
                  </div>
                  <div className="flex justify-between items-center p-2.5 bg-slate-50 dark:bg-slate-700/50 rounded-lg border border-slate-200 dark:border-slate-600">
                    <span className="text-slate-600 dark:text-slate-300">Hooks</span>
                    <span className="font-semibold text-slate-800 dark:text-white">{engineInfo.hooks.length} 个</span>
                  </div>
                  <div className="flex justify-between items-center p-2.5 bg-slate-50 dark:bg-slate-700/50 rounded-lg border border-slate-200 dark:border-slate-600">
                    <span className="text-slate-600 dark:text-slate-300">更新</span>
                    <span className="font-semibold text-slate-800 dark:text-white">{engineInfo.changelog[0]?.date || '-'}</span>
                  </div>
                </div>
              </GlassCard>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
