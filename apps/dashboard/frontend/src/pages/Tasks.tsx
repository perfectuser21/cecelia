import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { CheckSquare, Plus, RefreshCw, AlertCircle, Loader2, GripVertical, Star, ChevronLeft, ChevronRight, Sparkles, ExternalLink } from 'lucide-react';
import type { DropResult } from '@hello-pangea/dnd';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { useAuth } from '../contexts/AuthContext';
import type { Task} from '../api/tasks.api';
import { fetchTasks, updateTaskStatus, createTask } from '../api/tasks.api';

type ViewType = 'day' | 'week';

// 工作时间配置（北京时间）
const WORK_PERIODS = [
  { name: '上午', start: 8 * 60, end: 12 * 60, icon: '☀️', gradient: 'from-amber-500/20 via-orange-500/10 to-yellow-500/20' },
  { name: '下午', start: 13 * 60 + 30, end: 18 * 60, icon: '🌤️', gradient: 'from-blue-500/20 via-indigo-500/10 to-purple-500/20' },
];

// 生成 15 分钟间隔的时间槽
const TIME_SLOTS = (() => {
  const slots: { minutes: number; label: string; isHourStart: boolean }[] = [];
  WORK_PERIODS.forEach(period => {
    for (let m = period.start; m < period.end; m += 15) {
      const hour = Math.floor(m / 60);
      const minute = m % 60;
      slots.push({
        minutes: m,
        label: `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`,
        isHourStart: minute === 0,
      });
    }
  });
  return slots;
})();

// 优先级配置
const PRIORITY_CONFIG: Record<string, { color: string; bg: string; border: string }> = {
  '高': { color: 'text-rose-600 dark:text-rose-400', bg: 'bg-rose-50 dark:bg-rose-900/30', border: 'border-rose-200 dark:border-rose-700' },
  '中': { color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-900/30', border: 'border-amber-200 dark:border-amber-700' },
  '低': { color: 'text-sky-600 dark:text-sky-400', bg: 'bg-sky-50 dark:bg-sky-900/30', border: 'border-sky-200 dark:border-sky-700' },
};

// 日期工具函数
const formatDate = (date: Date) => date.toISOString().split('T')[0];
const formatDateDisplay = (date: Date) => `${date.getMonth() + 1}月${date.getDate()}日`;
const getWeekday = (date: Date) => ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][date.getDay()];
const getWeekdayShort = (date: Date) => ['日', '一', '二', '三', '四', '五', '六'][date.getDay()];
const isWeekend = (date: Date) => date.getDay() === 0 || date.getDay() === 6;

const getWeekDates = (baseDate: Date) => {
  const day = baseDate.getDay();
  const monday = new Date(baseDate);
  monday.setDate(baseDate.getDate() - (day === 0 ? 6 : day - 1));

  // 返回周一到周日 7 天
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });
};

export default function Tasks() {
  const { user } = useAuth();

  // 视图状态
  const [viewType, setViewType] = useState<ViewType>('day');
  const [selectedDate, setSelectedDate] = useState(new Date());

  // 数据状态
  const [allTasks, setAllTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingTasks, setUpdatingTasks] = useState<Set<string>>(new Set());

  // 时间分配 { taskId: { date: 'YYYY-MM-DD', minutes: number } }
  const [taskSchedule, setTaskSchedule] = useState<Record<string, { date: string; minutes: number }>>(() => {
    try {
      const saved = localStorage.getItem('zenithjoy_task_schedule');
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  // 新任务
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskPriority, setNewTaskPriority] = useState<'高' | '中' | '低' | ''>('');
  const [newTaskHighlight, setNewTaskHighlight] = useState(false);
  const [creating, setCreating] = useState(false);

  // 确认框和 Toast
  const [confirmTask, setConfirmTask] = useState<Task | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // 当前时间指示器
  const [currentTime, setCurrentTime] = useState(new Date());
  const currentTimeLineRef = useRef<HTMLDivElement>(null);
  const timelineContainerRef = useRef<HTMLDivElement>(null);

  const showToast = useCallback((type: 'success' | 'error', message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3000);
  }, []);

  // 计算当前显示的日期
  const weekDates = useMemo(() => getWeekDates(selectedDate), [selectedDate]);
  const displayDates = viewType === 'day' ? [selectedDate] : weekDates;

  // 计算任务统计
  const taskStats = useMemo(() => {
    const today = formatDate(new Date());
    const weekStart = formatDate(weekDates[0]);
    const weekEnd = formatDate(weekDates[6]);

    // 今日任务统计（allTasks 只包含未完成的）
    const todayTasks = allTasks.filter(t => t.due === today);

    // 本周任务统计
    const weekTasks = allTasks.filter(t => {
      if (!t.due) return false;
      return t.due >= weekStart && t.due <= weekEnd;
    });

    return {
      today: { total: todayTasks.length },
      week: { total: weekTasks.length },
    };
  }, [allTasks, weekDates]);

  // 加载任务
  const loadTasks = useCallback(async () => {
    if (!user?.name) return;
    setLoading(true);
    setError(null);
    try {
      const tasks = await fetchTasks({ name: user.name, range: 'week', includeDone: false });
      setAllTasks(tasks);
    } catch (err: any) {
      setError(err.message || '加载失败');
    } finally {
      setLoading(false);
    }
  }, [user?.name]);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  // 持久化 taskSchedule 到 localStorage
  useEffect(() => {
    try {
      localStorage.setItem('zenithjoy_task_schedule', JSON.stringify(taskSchedule));
    } catch (err) {
      console.error('Failed to save task schedule:', err);
    }
  }, [taskSchedule]);

  // 更新当前时间（每分钟）
  useEffect(() => {
    const updateTime = () => setCurrentTime(new Date());
    updateTime();
    const timer = setInterval(updateTime, 60000); // 每分钟更新
    return () => clearInterval(timer);
  }, []);

  // 自动滚动到当前时间
  useEffect(() => {
    if (currentTimeLineRef.current && timelineContainerRef.current) {
      const timeout = setTimeout(() => {
        currentTimeLineRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 300); // 延迟以确保 DOM 已渲染
      return () => clearTimeout(timeout);
    }
  }, [viewType, selectedDate]); // 当视图或日期变化时重新滚动

  // 键盘快捷键
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 忽略在输入框中的按键
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') {
        return;
      }

      switch (e.key.toLowerCase()) {
        case 't':
          e.preventDefault();
          goToday();
          break;
        case 'arrowleft':
          e.preventDefault();
          goPrev();
          break;
        case 'arrowright':
          e.preventDefault();
          goNext();
          break;
        case 'd':
          e.preventDefault();
          setViewType('day');
          break;
        case 'w':
          e.preventDefault();
          setViewType('week');
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [viewType, selectedDate]);

  // 获取某日期的任务
  const getTasksForDate = (date: Date) => {
    const dateStr = formatDate(date);
    return allTasks.filter(t => t.due === dateStr);
  };

  // 获取某日期某时间槽的任务
  const getTasksInSlot = (date: Date, minutes: number) => {
    const dateStr = formatDate(date);
    return allTasks.filter(t => {
      const schedule = taskSchedule[t.id];
      return schedule && schedule.date === dateStr && schedule.minutes === minutes;
    });
  };

  // 获取未安排的任务
  const getUnscheduledTasks = (date: Date) => {
    const dateStr = formatDate(date);
    return allTasks.filter(t => t.due === dateStr && !taskSchedule[t.id]);
  };

  // 日期导航
  const goToday = () => setSelectedDate(new Date());
  const goPrev = () => {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() - (viewType === 'day' ? 1 : 7));
    setSelectedDate(d);
  };
  const goNext = () => {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() + (viewType === 'day' ? 1 : 7));
    setSelectedDate(d);
  };

  // 确认完成任务
  const confirmToggleDone = async () => {
    if (!confirmTask) return;
    const task = confirmTask;
    setConfirmTask(null);
    setAllTasks(prev => prev.filter(t => t.id !== task.id));
    setUpdatingTasks(prev => new Set(prev).add(task.id));

    try {
      await updateTaskStatus(task.id, true);
      showToast('success', '已完成');
    } catch {
      loadTasks();
      showToast('error', '更新失败');
    } finally {
      setUpdatingTasks(prev => {
        const next = new Set(prev);
        next.delete(task.id);
        return next;
      });
    }
  };

  // 创建任务
  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTaskTitle.trim() || creating) return;

    setCreating(true);
    try {
      const newTask = await createTask({
        title: newTaskTitle.trim(),
        due: formatDate(selectedDate),
        assigneeName: user?.name || '',
        priority: newTaskPriority || undefined,
        highlight: newTaskHighlight,
      });
      setAllTasks(prev => [...prev, newTask]);
      setNewTaskTitle('');
      setNewTaskPriority('');
      setNewTaskHighlight(false);
      showToast('success', '已创建');
    } catch {
      showToast('error', '创建失败');
    } finally {
      setCreating(false);
    }
  };

  // 拖拽处理
  const handleDragEnd = async (result: DropResult) => {
    const { draggableId, destination } = result;
    if (!destination) return;

    const [type, dateStr, minutesStr] = destination.droppableId.split('|');

    if (type === 'unscheduled') {
      // 拖回未安排区域
      setTaskSchedule(prev => {
        const next = { ...prev };
        delete next[draggableId];
        return next;
      });
      showToast('success', '已移除时间安排');
    } else if (type === 'slot') {
      // 拖到时间槽
      const minutes = parseInt(minutesStr);
      if (!isNaN(minutes)) {
        setTaskSchedule(prev => ({ ...prev, [draggableId]: { date: dateStr, minutes } }));
        const hour = Math.floor(minutes / 60);
        const min = minutes % 60;
        showToast('success', `已安排到 ${hour.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`);
      }
    }
  };

  // 渲染优先级标签
  const PriorityBadge = ({ priority }: { priority: string | null }) => {
    if (!priority || !PRIORITY_CONFIG[priority]) return null;
    const config = PRIORITY_CONFIG[priority];
    return (
      <span className={`px-1.5 py-0.5 text-[10px] font-semibold rounded-md border ${config.bg} ${config.color} ${config.border}`}>
        {priority}
      </span>
    );
  };

  // 渲染当前时间指示线
  const CurrentTimeLine = ({ dateStr, slotMinutes }: { dateStr: string; slotMinutes: number }) => {
    const currentMinutes = getCurrentMinutes();
    const todayStr = formatDate(new Date());

    // 只在当天且当前时间在这个时间槽内显示
    if (dateStr !== todayStr || !isInWorkTime()) return null;

    // 计算在15分钟时间槽内的精确位置（0-100%）
    const slotStart = slotMinutes;
    const slotEnd = slotMinutes + 15;

    if (currentMinutes < slotStart || currentMinutes >= slotEnd) return null;

    // 计算百分比位置
    const percentage = ((currentMinutes - slotStart) / 15) * 100;

    return (
      <div
        ref={currentTimeLineRef}
        className="absolute left-0 right-0 z-20 flex items-center pointer-events-none"
        style={{ top: `${percentage}%` }}
      >
        {/* 左侧圆点 */}
        <div className="absolute left-0 w-14 flex items-center justify-end pr-1">
          <div className="w-2 h-2 rounded-full bg-red-500 shadow-lg shadow-red-500/50 animate-pulse" />
        </div>
        {/* 红色线条 */}
        <div className="flex-1 h-[2px] bg-red-500 shadow-md shadow-red-500/30 ml-14" />
      </div>
    );
  };

  // 渲染任务卡片
  const TaskCard = ({ task, compact = false }: { task: Task; compact?: boolean }) => (
    <div className={`group flex items-center gap-1.5 px-2.5 py-2 rounded-xl border transition-all duration-200 cursor-grab active:cursor-grabbing active:scale-[0.98] ${
      task.highlight
        ? 'bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-900/30 dark:to-orange-900/20 border-amber-200/80 dark:border-amber-700/50 shadow-sm shadow-amber-500/10'
        : 'bg-white dark:bg-slate-700/80 border-gray-200/80 dark:border-slate-600/80'
    } hover:shadow-lg hover:border-gray-300 dark:hover:border-slate-500 hover:-translate-y-0.5`}>
      <GripVertical className="w-3 h-3 text-gray-300 dark:text-gray-500 flex-shrink-0 opacity-50 group-hover:opacity-100" />
      {task.highlight && (
        <div className="relative flex-shrink-0">
          <Star className="w-3.5 h-3.5 text-amber-500 fill-amber-400" />
          <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400 absolute inset-0 animate-ping opacity-30" />
        </div>
      )}
      <div className="flex items-center gap-1 flex-1 min-w-0">
        <a
          href={task.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className={`font-medium text-gray-800 dark:text-white hover:text-blue-600 dark:hover:text-blue-400 truncate transition-colors ${compact ? 'text-[11px] max-w-[80px]' : 'text-sm max-w-[140px]'}`}
        >
          {task.title}
        </a>
        <a
          href={task.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <ExternalLink className="w-3 h-3 text-gray-400 hover:text-blue-500 dark:hover:text-blue-400" />
        </a>
      </div>
      {!compact && <PriorityBadge priority={task.priority} />}
      <button
        onClick={(e) => { e.stopPropagation(); setConfirmTask(task); }}
        className="ml-auto p-1 opacity-0 group-hover:opacity-100 hover:bg-green-100 dark:hover:bg-green-900/40 rounded-lg transition-all duration-200"
      >
        <CheckSquare className="w-3.5 h-3.5 text-gray-400 hover:text-green-500 dark:hover:text-green-400" />
      </button>
    </div>
  );

  if (!user?.name) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-500">请先登录</p>
      </div>
    );
  }

  const isToday = (date: Date) => formatDate(date) === formatDate(new Date());

  // 计算当前时间的分钟数（用于时间指示线）
  const getCurrentMinutes = () => {
    const hours = currentTime.getHours();
    const minutes = currentTime.getMinutes();
    return hours * 60 + minutes;
  };

  // 检查当前时间是否在工作时间段内
  const isInWorkTime = () => {
    const minutes = getCurrentMinutes();
    return WORK_PERIODS.some(period => minutes >= period.start && minutes < period.end);
  };

  return (
    <div className="h-full flex flex-col">
      {/* 确认框 */}
      {confirmTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setConfirmTask(null)} />
          <div className="relative bg-white dark:bg-slate-800 rounded-2xl shadow-2xl p-6 max-w-sm w-full mx-4">
            <div className="flex justify-center mb-4">
              <div className="w-14 h-14 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                <CheckSquare className="w-7 h-7 text-green-500" />
              </div>
            </div>
            <h3 className="text-lg font-bold text-center text-gray-900 dark:text-white mb-2">完成任务？</h3>
            <p className="text-center text-gray-600 dark:text-gray-300 mb-1">{confirmTask.title}</p>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setConfirmTask(null)} className="flex-1 px-4 py-2.5 bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-gray-300 rounded-xl font-medium">取消</button>
              <button onClick={confirmToggleDone} className="flex-1 px-4 py-2.5 bg-green-500 hover:bg-green-600 text-white rounded-xl font-medium flex items-center justify-center gap-2">
                <CheckSquare className="w-4 h-4" /> 完成
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-xl shadow-lg flex items-center gap-2 ${
          toast.type === 'success' ? 'bg-green-500 text-white' : 'bg-red-500 text-white'
        }`}>
          {toast.message}
        </div>
      )}

      {/* 顶部工具栏 */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="flex items-center gap-4">
          {/* 日期导航 */}
          <div className="flex items-center gap-0.5 bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm rounded-2xl border border-gray-200/60 dark:border-slate-700/60 p-1 shadow-sm">
            <button onClick={goPrev} className="p-2.5 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-xl transition-colors">
              <ChevronLeft className="w-4 h-4 text-gray-600 dark:text-gray-400" />
            </button>
            <button onClick={goToday} className="px-4 py-2 text-sm font-semibold bg-gradient-to-r from-blue-500 to-indigo-500 text-white rounded-xl shadow-sm hover:shadow-md transition-all">
              今天
            </button>
            <button onClick={goNext} className="p-2.5 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-xl transition-colors">
              <ChevronRight className="w-4 h-4 text-gray-600 dark:text-gray-400" />
            </button>
          </div>

          {/* 当前日期显示 */}
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold bg-gradient-to-r from-gray-900 via-gray-700 to-gray-900 dark:from-white dark:via-gray-300 dark:to-white bg-clip-text text-transparent">
              {viewType === 'day'
                ? `${formatDateDisplay(selectedDate)} ${getWeekday(selectedDate)}`
                : `${formatDateDisplay(weekDates[0])} - ${formatDateDisplay(weekDates[6])}`
              }
            </h2>
            {viewType === 'day' && isWeekend(selectedDate) && (
              <span className="px-2.5 py-1 text-xs font-semibold bg-gradient-to-r from-violet-500 to-purple-500 text-white rounded-full shadow-sm flex items-center gap-1">
                <Sparkles className="w-3 h-3" />
                周末
              </span>
            )}
          </div>

          {/* 任务统计 */}
          <div className="px-3 py-1.5 bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm rounded-xl border border-gray-200/60 dark:border-slate-700/60 shadow-sm flex items-center gap-2">
            <span className="text-xs text-gray-500 dark:text-gray-400">今日</span>
            <span className="text-sm font-bold text-gray-900 dark:text-white">{taskStats.today.total}</span>
            <span className="text-xs text-gray-400 dark:text-gray-500">|</span>
            <span className="text-xs text-gray-500 dark:text-gray-400">本周</span>
            <span className="text-sm font-bold text-gray-900 dark:text-white">{taskStats.week.total}</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* 视图切换 */}
          <div className="flex gap-1 bg-gray-100/80 dark:bg-slate-700/80 backdrop-blur-sm p-1 rounded-xl">
            <button
              onClick={() => setViewType('day')}
              className={`px-5 py-2 rounded-lg text-sm font-semibold transition-all duration-200 ${
                viewType === 'day'
                  ? 'bg-white dark:bg-slate-600 text-gray-900 dark:text-white shadow-md'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
              }`}
            >
              日
            </button>
            <button
              onClick={() => setViewType('week')}
              className={`px-5 py-2 rounded-lg text-sm font-semibold transition-all duration-200 ${
                viewType === 'week'
                  ? 'bg-white dark:bg-slate-600 text-gray-900 dark:text-white shadow-md'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
              }`}
            >
              周
            </button>
          </div>

          <button
            onClick={loadTasks}
            disabled={loading}
            className="p-2.5 rounded-xl bg-white/80 dark:bg-slate-800/80 border border-gray-200/60 dark:border-slate-700/60 hover:bg-gray-50 dark:hover:bg-slate-700 transition-all shadow-sm"
          >
            <RefreshCw className={`w-4 h-4 text-gray-500 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* 新建任务 */}
      <form onSubmit={handleCreateTask} className="mb-5">
        <div className="flex gap-2 items-center p-2 bg-white/60 dark:bg-slate-800/60 backdrop-blur-sm rounded-2xl border border-gray-200/60 dark:border-slate-700/60 shadow-sm">
          <input
            type="text"
            value={newTaskTitle}
            onChange={e => setNewTaskTitle(e.target.value)}
            placeholder={`✨ 添加新任务到 ${formatDateDisplay(selectedDate)}...`}
            className="flex-1 px-4 py-2.5 bg-transparent text-sm placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none"
          />
          <div className="flex items-center gap-1.5">
            <select
              value={newTaskPriority}
              onChange={e => setNewTaskPriority(e.target.value as any)}
              className="px-3 py-2 bg-gray-100/80 dark:bg-slate-700/80 border-0 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/50 cursor-pointer"
            >
              <option value="">优先级</option>
              <option value="高">🔴 高</option>
              <option value="中">🟡 中</option>
              <option value="低">🔵 低</option>
            </select>
            <button
              type="button"
              onClick={() => setNewTaskHighlight(!newTaskHighlight)}
              className={`p-2.5 rounded-xl transition-all duration-200 ${
                newTaskHighlight
                  ? 'bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow-md shadow-amber-500/30'
                  : 'bg-gray-100/80 dark:bg-slate-700/80 text-gray-400 hover:text-amber-500'
              }`}
            >
              <Star className={`w-4 h-4 ${newTaskHighlight ? 'fill-white' : ''}`} />
            </button>
            <button
              type="submit"
              disabled={!newTaskTitle.trim() || creating}
              className="px-5 py-2.5 bg-gradient-to-r from-blue-500 to-indigo-500 hover:from-blue-600 hover:to-indigo-600 text-white rounded-xl font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 shadow-md shadow-blue-500/30 transition-all duration-200"
            >
              {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              <span className="hidden sm:inline">添加</span>
            </button>
          </div>
        </div>
      </form>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
        </div>
      ) : error ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <AlertCircle className="w-10 h-10 text-red-400 mx-auto mb-2" />
            <p className="text-gray-500 mb-4">{error}</p>
            <button onClick={loadTasks} className="px-4 py-2 bg-blue-500 text-white rounded-lg">重试</button>
          </div>
        </div>
      ) : allTasks.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center max-w-md">
            <div className="relative mb-6">
              <div className="w-24 h-24 mx-auto rounded-full bg-gradient-to-br from-green-400 via-emerald-500 to-teal-500 flex items-center justify-center shadow-2xl shadow-green-500/30">
                <CheckSquare className="w-12 h-12 text-white" strokeWidth={2.5} />
              </div>
              <div className="absolute -top-2 -right-8 animate-bounce">
                <Sparkles className="w-8 h-8 text-yellow-400 fill-yellow-300" />
              </div>
            </div>
            <h3 className="text-2xl font-bold bg-gradient-to-r from-green-600 via-emerald-600 to-teal-600 dark:from-green-400 dark:via-emerald-400 dark:to-teal-400 bg-clip-text text-transparent mb-3">
              太棒了，任务都完成了！
            </h3>
            <p className="text-gray-500 dark:text-gray-400 mb-6 leading-relaxed">
              暂无待办任务，享受今天的美好时光<br />
              或者创建新任务开始新的征程
            </p>
            <div className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-blue-500 to-indigo-500 text-white rounded-2xl shadow-lg shadow-blue-500/30 font-medium">
              <Plus className="w-5 h-5" />
              <span>在上方快速添加任务</span>
            </div>
          </div>
        </div>
      ) : (
        <DragDropContext onDragEnd={handleDragEnd}>
          <div className="flex-1 flex gap-4 overflow-hidden">
            {/* 左侧：待安排任务 */}
            <div className="w-60 flex-shrink-0">
              <div className="bg-gradient-to-b from-white to-gray-50/50 dark:from-slate-800 dark:to-slate-800/50 rounded-2xl border border-gray-200/60 dark:border-slate-700/60 p-4 h-full overflow-y-auto shadow-sm">
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-2 h-2 rounded-full bg-gradient-to-r from-blue-500 to-indigo-500" />
                  <h3 className="text-xs font-bold text-gray-600 dark:text-gray-300 uppercase tracking-wider">待安排</h3>
                </div>
                {displayDates.map(date => {
                  const unscheduled = getUnscheduledTasks(date);
                  if (unscheduled.length === 0 && viewType === 'week') return null;
                  const weekend = isWeekend(date);

                  return (
                    <div key={formatDate(date)} className="mb-5 last:mb-0">
                      {viewType === 'week' && (
                        <p className={`text-xs font-medium mb-2 flex items-center gap-1.5 ${
                          weekend ? 'text-violet-500 dark:text-violet-400' : 'text-gray-500 dark:text-gray-400'
                        }`}>
                          {weekend && <span className="text-[10px]">✨</span>}
                          {getWeekday(date)} {date.getDate()}日
                        </p>
                      )}
                      <Droppable droppableId={`unscheduled|${formatDate(date)}|0`}>
                        {(provided, snapshot) => (
                          <div
                            ref={provided.innerRef}
                            {...provided.droppableProps}
                            className={`space-y-2 min-h-[48px] p-2 -m-2 rounded-xl transition-colors ${
                              snapshot.isDraggingOver ? 'bg-blue-50/50 dark:bg-blue-900/20' : ''
                            }`}
                          >
                            {unscheduled.map((task, index) => (
                              <Draggable key={task.id} draggableId={task.id} index={index}>
                                {(provided) => (
                                  <div ref={provided.innerRef} {...provided.draggableProps} {...provided.dragHandleProps}>
                                    <TaskCard task={task} />
                                  </div>
                                )}
                              </Draggable>
                            ))}
                            {provided.placeholder}
                            {unscheduled.length === 0 && (
                              <div className="flex flex-col items-center justify-center py-4 text-gray-300 dark:text-gray-600">
                                <CheckSquare className="w-5 h-5 mb-1" />
                                <p className="text-[11px]">全部已安排</p>
                              </div>
                            )}
                          </div>
                        )}
                      </Droppable>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 右侧：日历时间轴 */}
            <div className="flex-1 bg-gradient-to-b from-white to-gray-50/30 dark:from-slate-800 dark:to-slate-900/30 rounded-2xl border border-gray-200/60 dark:border-slate-700/60 overflow-hidden flex flex-col shadow-sm">
              {/* 日期头部（周视图） */}
              {viewType === 'week' && (
                <div className="flex border-b border-gray-200/50 dark:border-slate-700/50 flex-shrink-0 bg-gradient-to-r from-gray-50 via-white to-gray-50 dark:from-slate-800 dark:via-slate-750 dark:to-slate-800">
                  <div className="w-14 flex-shrink-0" /> {/* 时间列占位 */}
                  {weekDates.map(date => {
                    const weekend = isWeekend(date);
                    const today = isToday(date);
                    return (
                      <div
                        key={formatDate(date)}
                        className={`flex-1 py-3 text-center border-l border-gray-200/50 dark:border-slate-700/50 transition-all ${
                          today
                            ? 'bg-gradient-to-b from-blue-100 to-blue-50 dark:from-blue-900/40 dark:to-blue-900/20'
                            : weekend
                              ? 'bg-gradient-to-b from-violet-50 to-purple-50/50 dark:from-violet-900/20 dark:to-purple-900/10'
                              : ''
                        }`}
                      >
                        <p className={`text-xs font-medium ${
                          today
                            ? 'text-blue-600 dark:text-blue-400'
                            : weekend
                              ? 'text-violet-500 dark:text-violet-400'
                              : 'text-gray-500 dark:text-gray-400'
                        }`}>
                          周{getWeekdayShort(date)}
                        </p>
                        <div className="flex items-center justify-center gap-1">
                          {today && (
                            <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                          )}
                          <p className={`text-lg font-bold ${
                            today
                              ? 'text-blue-600 dark:text-blue-400'
                              : weekend
                                ? 'text-violet-600 dark:text-violet-400'
                                : 'text-gray-900 dark:text-white'
                          }`}>
                            {date.getDate()}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* 时间槽 */}
              <div ref={timelineContainerRef} className="flex-1 overflow-y-auto relative">
                {/* 上午标题 */}
                <div className="sticky top-0 z-10 backdrop-blur-sm bg-gradient-to-r from-amber-100/90 via-orange-50/90 to-yellow-100/90 dark:from-amber-900/50 dark:via-orange-900/40 dark:to-yellow-900/50 px-4 py-2 border-b border-amber-200/50 dark:border-amber-700/30">
                  <div className="flex items-center gap-2">
                    <span className="text-base">☀️</span>
                    <span className="text-xs font-semibold text-amber-800 dark:text-amber-200">上午</span>
                    <span className="text-xs text-amber-600/70 dark:text-amber-300/70">8:00 - 12:00</span>
                  </div>
                </div>

                {TIME_SLOTS.filter(s => s.minutes < 12 * 60).map(slot => (
                  <div key={slot.minutes} className={`flex border-b ${slot.isHourStart ? 'border-gray-200/60 dark:border-slate-600/60' : 'border-gray-100/40 dark:border-slate-700/40'}`}>
                    {/* 时间标签 */}
                    <div className={`w-14 flex-shrink-0 py-1.5 px-2 text-right border-r border-gray-100/50 dark:border-slate-700/50 ${
                      slot.isHourStart ? 'bg-gradient-to-r from-gray-50 to-transparent dark:from-slate-700/30' : ''
                    }`}>
                      <span className={`text-[11px] font-mono ${slot.isHourStart ? 'font-semibold text-gray-700 dark:text-gray-200' : 'text-gray-400 dark:text-gray-500'}`}>
                        {slot.isHourStart ? slot.label : slot.label.split(':')[1]}
                      </span>
                    </div>

                    {/* 每天的时间槽 */}
                    {displayDates.map(date => {
                      const weekend = isWeekend(date);
                      const today = isToday(date);
                      const dateStr = formatDate(date);
                      return (
                        <Droppable key={`${dateStr}-${slot.minutes}`} droppableId={`slot|${dateStr}|${slot.minutes}`}>
                          {(provided, snapshot) => (
                            <div
                              ref={provided.innerRef}
                              {...provided.droppableProps}
                              className={`flex-1 min-h-[32px] p-0.5 flex flex-wrap gap-0.5 items-start border-l border-gray-100/50 dark:border-slate-700/50 transition-all duration-200 relative ${
                                snapshot.isDraggingOver
                                  ? 'bg-blue-100 dark:bg-blue-900/40 ring-2 ring-inset ring-blue-400/50'
                                  : today
                                    ? 'bg-blue-50/50 dark:bg-blue-900/20'
                                    : weekend
                                      ? 'bg-violet-50/30 dark:bg-violet-900/10'
                                      : 'hover:bg-gray-50/50 dark:hover:bg-slate-700/30'
                              }`}
                            >
                              {getTasksInSlot(date, slot.minutes).map((task, index) => (
                                <Draggable key={task.id} draggableId={task.id} index={index}>
                                  {(provided) => (
                                    <div ref={provided.innerRef} {...provided.draggableProps} {...provided.dragHandleProps}>
                                      <TaskCard task={task} compact={viewType === 'week'} />
                                    </div>
                                  )}
                                </Draggable>
                              ))}
                              {provided.placeholder}
                            <CurrentTimeLine dateStr={dateStr} slotMinutes={slot.minutes} />
                            </div>
                          )}
                        </Droppable>
                      );
                    })}
                  </div>
                ))}

                {/* 午休 */}
                <div className="bg-gradient-to-r from-gray-100 via-gray-50 to-gray-100 dark:from-slate-700/60 dark:via-slate-600/40 dark:to-slate-700/60 px-4 py-3 flex items-center justify-center gap-2 border-y border-gray-200/50 dark:border-slate-600/50">
                  <span className="text-lg">🍽️</span>
                  <span className="text-xs font-medium text-gray-500 dark:text-gray-400">午休时间</span>
                  <span className="text-xs text-gray-400 dark:text-gray-500">12:00 - 13:30</span>
                </div>

                {/* 下午标题 */}
                <div className="sticky top-0 z-10 backdrop-blur-sm bg-gradient-to-r from-blue-100/90 via-indigo-50/90 to-sky-100/90 dark:from-blue-900/50 dark:via-indigo-900/40 dark:to-sky-900/50 px-4 py-2 border-b border-blue-200/50 dark:border-blue-700/30">
                  <div className="flex items-center gap-2">
                    <span className="text-base">🌤️</span>
                    <span className="text-xs font-semibold text-blue-800 dark:text-blue-200">下午</span>
                    <span className="text-xs text-blue-600/70 dark:text-blue-300/70">13:30 - 18:00</span>
                  </div>
                </div>

                {TIME_SLOTS.filter(s => s.minutes >= 13 * 60 + 30).map(slot => (
                  <div key={slot.minutes} className={`flex border-b ${slot.isHourStart ? 'border-gray-200/60 dark:border-slate-600/60' : 'border-gray-100/40 dark:border-slate-700/40'}`}>
                    <div className={`w-14 flex-shrink-0 py-1.5 px-2 text-right border-r border-gray-100/50 dark:border-slate-700/50 ${
                      slot.isHourStart ? 'bg-gradient-to-r from-gray-50 to-transparent dark:from-slate-700/30' : ''
                    }`}>
                      <span className={`text-[11px] font-mono ${slot.isHourStart ? 'font-semibold text-gray-700 dark:text-gray-200' : 'text-gray-400 dark:text-gray-500'}`}>
                        {slot.isHourStart ? slot.label : slot.label.split(':')[1]}
                      </span>
                    </div>

                    {displayDates.map(date => {
                      const weekend = isWeekend(date);
                      const today = isToday(date);
                      const dateStr = formatDate(date);
                      return (
                        <Droppable key={`${dateStr}-${slot.minutes}`} droppableId={`slot|${dateStr}|${slot.minutes}`}>
                          {(provided, snapshot) => (
                            <div
                              ref={provided.innerRef}
                              {...provided.droppableProps}
                              className={`flex-1 min-h-[32px] p-0.5 flex flex-wrap gap-0.5 items-start border-l border-gray-100/50 dark:border-slate-700/50 transition-all duration-200 relative ${
                                snapshot.isDraggingOver
                                  ? 'bg-blue-100 dark:bg-blue-900/40 ring-2 ring-inset ring-blue-400/50'
                                  : today
                                    ? 'bg-blue-50/50 dark:bg-blue-900/20'
                                    : weekend
                                      ? 'bg-violet-50/30 dark:bg-violet-900/10'
                                      : 'hover:bg-gray-50/50 dark:hover:bg-slate-700/30'
                              }`}
                            >
                              {getTasksInSlot(date, slot.minutes).map((task, index) => (
                                <Draggable key={task.id} draggableId={task.id} index={index}>
                                  {(provided) => (
                                    <div ref={provided.innerRef} {...provided.draggableProps} {...provided.dragHandleProps}>
                                      <TaskCard task={task} compact={viewType === 'week'} />
                                    </div>
                                  )}
                                </Draggable>
                              ))}
                              {provided.placeholder}
                            <CurrentTimeLine dateStr={dateStr} slotMinutes={slot.minutes} />
                            </div>
                          )}
                        </Droppable>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </DragDropContext>
      )}
    </div>
  );
}
