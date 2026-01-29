import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Brain,
  Send,
  RefreshCw,
  Target,
  FolderKanban,
  ListTodo,
  ChevronRight,
  ChevronDown,
  CheckCircle2,
  Clock,
  AlertCircle,
  Sparkles
} from 'lucide-react';

interface Project {
  id: string;
  name: string;
  status: string;
}

interface KeyResult {
  id: string;
  title: string;
  progress: number;
  weight: number;
}

interface OKRTree {
  id: string;
  title: string;
  status: string;
  priority: string;
  progress: number;
  keyResults: KeyResult[];
}

interface Task {
  id: string;
  title: string;
  priority: string;
  status: string;
  goal_id?: string;
}

interface SystemState {
  focus: { objective?: { id: string; title: string; progress: number } } | null;
  projects: Project[];
  okrTrees: OKRTree[];
  tasks: { total: Record<string, number>; top: Task[] };
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  highlights?: string[];
  actions?: Array<{ type: string; label: string; params: Record<string, unknown> }>;
}

interface ChatResponse {
  message: string;
  highlights: string[];
  actions: Array<{ type: string; label: string; params: Record<string, unknown> }>;
}

export default function OrchestratorPage() {
  const [state, setState] = useState<SystemState | null>(null);
  const [loading, setLoading] = useState(true);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [highlights, setHighlights] = useState<Set<string>>(new Set());
  const [expandedOKRs, setExpandedOKRs] = useState<Set<string>>(new Set());
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 获取系统状态
  const fetchState = useCallback(async () => {
    try {
      const [brainRes, projectsRes, goalsRes, tasksRes] = await Promise.all([
        fetch('/api/brain/status'),
        fetch('/api/tasks/projects'),
        fetch('/api/tasks/goals'),
        fetch('/api/tasks/tasks?status=queued,in_progress&limit=20')
      ]);

      const [brain, projects, goals, tasks] = await Promise.all([
        brainRes.json(),
        projectsRes.json(),
        goalsRes.json(),
        tasksRes.json()
      ]);

      const objectives = goals.filter((g: any) => g.type === 'objective' || !g.parent_id);
      const keyResults = goals.filter((g: any) => g.type === 'key_result' || g.parent_id);

      const okrTrees = objectives.map((obj: any) => ({
        id: obj.id,
        title: obj.title,
        status: obj.status,
        priority: obj.priority,
        progress: obj.progress || 0,
        keyResults: keyResults
          .filter((kr: any) => kr.parent_id === obj.id)
          .map((kr: any) => ({
            id: kr.id,
            title: kr.title,
            progress: kr.progress || 0,
            weight: kr.weight || 0
          }))
      }));

      setState({
        focus: brain.daily_focus,
        projects: projects.slice(0, 10),
        okrTrees: okrTrees.slice(0, 10),
        tasks: {
          total: brain.task_digest?.stats || {},
          top: tasks.slice(0, 10)
        }
      });
    } catch (error) {
      console.error('Failed to fetch state:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchState();
  }, [fetchState]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // 发送消息
  const sendMessage = async () => {
    if (!input.trim() || sending) return;

    const userMessage = input.trim();
    setInput('');
    setSending(true);

    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);

    try {
      const res = await fetch('/api/orchestrator/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMessage,
          history: messages.slice(-10).map(m => ({
            role: m.role,
            content: m.content
          }))
        })
      });

      const data = await res.json();

      if (data.success && data.response) {
        const response: ChatResponse = data.response;

        setMessages(prev => [...prev, {
          role: 'assistant',
          content: response.message,
          highlights: response.highlights,
          actions: response.actions
        }]);

        // 设置高亮
        if (response.highlights?.length) {
          setHighlights(new Set(response.highlights));
          // 展开相关 OKR
          response.highlights.forEach(h => {
            if (h.startsWith('okr:')) {
              setExpandedOKRs(prev => new Set([...prev, h.replace('okr:', '')]));
            }
          });
          // 3秒后清除高亮
          setTimeout(() => setHighlights(new Set()), 3000);
        }
      }
    } catch (error) {
      console.error('Chat error:', error);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: '抱歉，出现了错误。请重试。'
      }]);
    } finally {
      setSending(false);
    }
  };

  // 执行动作
  const executeAction = async (action: { type: string; params: Record<string, unknown> }) => {
    try {
      const res = await fetch('/api/orchestrator/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action)
      });

      if (res.ok) {
        fetchState(); // 刷新状态
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `✅ 已执行: ${action.type}`
        }]);
      }
    } catch (error) {
      console.error('Action error:', error);
    }
  };

  const toggleOKR = (id: string) => {
    setExpandedOKRs(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const isHighlighted = (type: string, id: string) => highlights.has(`${type}:${id}`);

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'P0': return 'text-red-500 bg-red-50 dark:bg-red-900/20';
      case 'P1': return 'text-amber-500 bg-amber-50 dark:bg-amber-900/20';
      case 'P2': return 'text-emerald-500 bg-emerald-50 dark:bg-emerald-900/20';
      default: return 'text-slate-500 bg-slate-50 dark:bg-slate-700/50';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed': return <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
      case 'in_progress': return <Clock className="w-4 h-4 text-amber-500" />;
      default: return <AlertCircle className="w-4 h-4 text-slate-400" />;
    }
  };

  // 渲染消息内容，处理 [[type:id:name]] 引用
  const renderMessage = (content: string) => {
    const parts = content.split(/(\[\[[^\]]+\]\])/g);
    return parts.map((part, i) => {
      const match = part.match(/\[\[(\w+):([^:]+):([^\]]+)\]\]/);
      if (match) {
        const [, type, id, name] = match;
        return (
          <button
            key={i}
            onClick={() => {
              setHighlights(new Set([`${type}:${id}`]));
              if (type === 'okr') setExpandedOKRs(prev => new Set([...prev, id]));
              setTimeout(() => setHighlights(new Set()), 3000);
            }}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded text-sm hover:bg-blue-200 dark:hover:bg-blue-800/50 transition-colors"
          >
            {type === 'okr' && <Target className="w-3 h-3" />}
            {type === 'task' && <ListTodo className="w-3 h-3" />}
            {type === 'project' && <FolderKanban className="w-3 h-3" />}
            {name}
          </button>
        );
      }
      return <span key={i}>{part}</span>;
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-8 h-8 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-8rem)] gap-6">
      {/* 左侧状态面板 */}
      <div className="w-80 flex-shrink-0 space-y-4 overflow-y-auto">
        {/* 今日焦点 */}
        <div className={`bg-white dark:bg-slate-800 rounded-xl p-4 border transition-all ${
          state?.focus?.objective && isHighlighted('okr', state.focus.objective.id)
            ? 'border-blue-500 ring-2 ring-blue-500/20'
            : 'border-slate-200 dark:border-slate-700'
        }`}>
          <div className="flex items-center gap-2 mb-3">
            <Target className="w-5 h-5 text-violet-500" />
            <h3 className="font-semibold text-slate-900 dark:text-white">今日焦点</h3>
          </div>
          {state?.focus?.objective ? (
            <div>
              <p className="text-sm font-medium text-slate-900 dark:text-white">
                {state.focus.objective.title}
              </p>
              <div className="mt-2 h-2 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-violet-500 to-purple-500 transition-all"
                  style={{ width: `${state.focus.objective.progress || 0}%` }}
                />
              </div>
              <p className="mt-1 text-xs text-slate-500">{state.focus.objective.progress || 0}%</p>
            </div>
          ) : (
            <p className="text-sm text-slate-400">未设置焦点</p>
          )}
        </div>

        {/* Projects */}
        <div className="bg-white dark:bg-slate-800 rounded-xl p-4 border border-slate-200 dark:border-slate-700">
          <div className="flex items-center gap-2 mb-3">
            <FolderKanban className="w-5 h-5 text-blue-500" />
            <h3 className="font-semibold text-slate-900 dark:text-white">Projects</h3>
          </div>
          <div className="space-y-1">
            {state?.projects.map(project => (
              <div
                key={project.id}
                className={`flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm transition-all ${
                  isHighlighted('project', project.id)
                    ? 'bg-blue-100 dark:bg-blue-900/30 ring-1 ring-blue-500'
                    : 'hover:bg-slate-50 dark:hover:bg-slate-700/50'
                }`}
              >
                <span className="text-slate-600 dark:text-slate-300">{project.name}</span>
              </div>
            ))}
          </div>
        </div>

        {/* OKR Trees */}
        <div className="bg-white dark:bg-slate-800 rounded-xl p-4 border border-slate-200 dark:border-slate-700">
          <div className="flex items-center gap-2 mb-3">
            <Target className="w-5 h-5 text-emerald-500" />
            <h3 className="font-semibold text-slate-900 dark:text-white">OKR</h3>
          </div>
          <div className="space-y-2">
            {state?.okrTrees.map(okr => (
              <div key={okr.id}>
                <button
                  onClick={() => toggleOKR(okr.id)}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm transition-all ${
                    isHighlighted('okr', okr.id)
                      ? 'bg-emerald-100 dark:bg-emerald-900/30 ring-1 ring-emerald-500'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-700/50'
                  }`}
                >
                  {expandedOKRs.has(okr.id) ? (
                    <ChevronDown className="w-4 h-4 text-slate-400" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-slate-400" />
                  )}
                  <span className={`px-1.5 py-0.5 text-xs font-medium rounded ${getPriorityColor(okr.priority)}`}>
                    {okr.priority}
                  </span>
                  <span className="flex-1 text-left text-slate-700 dark:text-slate-200 truncate">
                    {okr.title}
                  </span>
                  <span className="text-xs text-slate-400">{okr.progress}%</span>
                </button>
                {expandedOKRs.has(okr.id) && okr.keyResults.length > 0 && (
                  <div className="ml-6 mt-1 space-y-1">
                    {okr.keyResults.map(kr => (
                      <div
                        key={kr.id}
                        className="flex items-center gap-2 px-2 py-1 text-xs text-slate-500 dark:text-slate-400"
                      >
                        <div className="w-16 h-1.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-emerald-500"
                            style={{ width: `${kr.progress}%` }}
                          />
                        </div>
                        <span className="truncate">{kr.title}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Tasks */}
        <div className="bg-white dark:bg-slate-800 rounded-xl p-4 border border-slate-200 dark:border-slate-700">
          <div className="flex items-center gap-2 mb-3">
            <ListTodo className="w-5 h-5 text-amber-500" />
            <h3 className="font-semibold text-slate-900 dark:text-white">Tasks</h3>
            <span className="text-xs text-slate-400">
              P0: {state?.tasks.total.open_p0 || 0} | P1: {state?.tasks.total.open_p1 || 0}
            </span>
          </div>
          <div className="space-y-1">
            {state?.tasks.top.map(task => (
              <div
                key={task.id}
                className={`flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm transition-all ${
                  isHighlighted('task', task.id)
                    ? 'bg-amber-100 dark:bg-amber-900/30 ring-1 ring-amber-500'
                    : 'hover:bg-slate-50 dark:hover:bg-slate-700/50'
                }`}
              >
                {getStatusIcon(task.status)}
                <span className={`px-1.5 py-0.5 text-xs font-medium rounded ${getPriorityColor(task.priority)}`}>
                  {task.priority}
                </span>
                <span className="flex-1 text-slate-600 dark:text-slate-300 truncate">
                  {task.title}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 右侧聊天界面 */}
      <div className="flex-1 flex flex-col bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
        {/* 头部 */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-200 dark:border-slate-700">
          <div className="p-2 bg-gradient-to-br from-violet-500 to-purple-600 rounded-xl">
            <Brain className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="font-semibold text-slate-900 dark:text-white">Orchestrator</h2>
            <p className="text-xs text-slate-500">对话式任务拆解</p>
          </div>
          <button
            onClick={fetchState}
            className="ml-auto p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
          >
            <RefreshCw className="w-4 h-4 text-slate-400" />
          </button>
        </div>

        {/* 消息列表 */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {messages.length === 0 && (
            <div className="text-center py-12">
              <Sparkles className="w-12 h-12 mx-auto text-slate-300 dark:text-slate-600 mb-4" />
              <p className="text-slate-500 dark:text-slate-400">
                告诉我你想做什么，我来帮你拆解任务
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {['查看 Brain MVP 进度', '帮我规划今天的工作', '有哪些 P0 任务？'].map(q => (
                  <button
                    key={q}
                    onClick={() => setInput(q)}
                    className="px-3 py-1.5 text-sm bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-full hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((msg, i) => (
            <div
              key={i}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[80%] px-4 py-3 rounded-2xl ${
                  msg.role === 'user'
                    ? 'bg-blue-500 text-white'
                    : 'bg-slate-100 dark:bg-slate-700 text-slate-900 dark:text-white'
                }`}
              >
                <div className="text-sm whitespace-pre-wrap">
                  {msg.role === 'assistant' ? renderMessage(msg.content) : msg.content}
                </div>
                {msg.actions && msg.actions.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {msg.actions.map((action, j) => (
                      <button
                        key={j}
                        onClick={() => executeAction(action)}
                        className="px-3 py-1.5 text-xs bg-white dark:bg-slate-600 text-slate-700 dark:text-slate-200 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-500 transition-colors shadow-sm"
                      >
                        {action.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
          {sending && (
            <div className="flex justify-start">
              <div className="px-4 py-3 bg-slate-100 dark:bg-slate-700 rounded-2xl">
                <div className="flex items-center gap-2 text-sm text-slate-500">
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  思考中...
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* 输入框 */}
        <div className="px-5 py-4 border-t border-slate-200 dark:border-slate-700">
          <div className="flex items-center gap-3">
            <input
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendMessage()}
              placeholder="输入你的需求..."
              className="flex-1 px-4 py-2.5 bg-slate-100 dark:bg-slate-700 border-0 rounded-xl text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={sendMessage}
              disabled={!input.trim() || sending}
              className="p-2.5 bg-blue-500 hover:bg-blue-600 disabled:bg-slate-300 dark:disabled:bg-slate-600 text-white rounded-xl transition-colors"
            >
              <Send className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
