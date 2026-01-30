import { useRef, useEffect, useCallback } from 'react';
import {
  Brain,
  Send,
  RefreshCw,
  Phone,
  PhoneOff,
  Volume2,
  Mic,
  MessageCircle,
  Minimize2,
  Sparkles,
  Navigation,
  Eye,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { useCecelia } from '../../../../dashboard/frontend/src/contexts/CeceliaContext';
import { useRealtimeVoice } from '../hooks/useRealtimeVoice';

// Frontend command patterns for local execution (more flexible matching)
const FRONTEND_PATTERNS = {
  // Navigate patterns - very flexible, captures destination
  navigate: /(go to|navigate to|open|跳转到?|打开|去|转到|调[整转]到?|进入|切换到?|帮我[打开去看]?)\s*([a-zA-Z\u4e00-\u9fa5]+)/i,
  expand: /(expand|展开)\s+(.+)/i,
  collapse: /(collapse|收起|折叠)\s+(.+)/i,
  toggle: /(toggle|切换)\s+(.+)/i,
  refresh: /(refresh|刷新)/i,
  whereAmI: /(where am i|current page|what page|我在哪|当前页面|哪个页面|在哪个?页)/i,
  filter: /(filter|筛选|过滤)\s+(.+)/i,
};

// Route aliases for navigation (Chinese + English)
const ROUTE_ALIASES: Record<string, string> = {
  // OKR
  'okr': '/okr',
  'okrs': '/okr',
  'objectives': '/okr',
  '目标': '/okr',
  'okr目标': '/okr',
  '工作目标': '/okr',
  // Projects
  'projects': '/projects',
  'project': '/projects',
  '项目': '/projects',
  '项目列表': '/projects',
  // Orchestrator / Command Center
  'orchestrator': '/orchestrator',
  'command center': '/orchestrator',
  'commandcenter': '/orchestrator',
  'command': '/orchestrator',
  'opcenter': '/orchestrator',
  'op center': '/orchestrator',
  'control center': '/orchestrator',
  'controlcenter': '/orchestrator',
  '调度': '/orchestrator',
  '任务调度': '/orchestrator',
  '调度器': '/orchestrator',
  '编排': '/orchestrator',
  '指挥中心': '/orchestrator',
  '控制中心': '/orchestrator',
  // Tasks
  'tasks': '/tasks',
  'task': '/tasks',
  '任务': '/tasks',
  '任务列表': '/tasks',
  // Planner / 工作规划
  'planner': '/planner',
  '规划': '/planner',
  '工作规划': '/planner',
  '计划': '/planner',
  // Brain
  'brain': '/brain',
  '大脑': '/brain',
  // Home / Dashboard
  'home': '/',
  'dashboard': '/',
  '首页': '/',
  '主页': '/',
  '仪表盘': '/',
};

// Friendly page names for display
const PAGE_DISPLAY_NAMES: Record<string, string> = {
  '/okr': 'OKR 目标',
  '/projects': '项目列表',
  '/orchestrator': 'Command Center',
  '/tasks': '任务列表',
  '/planner': '工作规划',
  '/brain': '大脑',
  '/': '首页',
};

export function CeceliaChat() {
  const {
    messages,
    addMessage,
    updateMessage,
    chatOpen,
    setChatOpen,
    input,
    setInput,
    sending,
    setSending,
    generateId,
    currentStreamingIdRef,
    // New page awareness
    currentRoute,
    pageState,
    frontendTools,
    executeFrontendTool,
    getPageContext,
    showNavigationToast,
  } = useCecelia();

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Try to handle message as a frontend command (defined first so it can be used by handleUserSpeech)
  const tryFrontendCommand = useCallback(async (message: string): Promise<{ handled: boolean; result?: string }> => {
    const lowerMsg = message.toLowerCase().trim();
    console.log('[Cecelia] Checking frontend command:', lowerMsg);

    // Check for "where am I" type queries
    if (FRONTEND_PATTERNS.whereAmI.test(lowerMsg)) {
      console.log('[Cecelia] Matched: whereAmI');
      const result = await executeFrontendTool('get_current_page', {});
      return { handled: true, result };
    }

    // Check for refresh
    if (FRONTEND_PATTERNS.refresh.test(lowerMsg)) {
      console.log('[Cecelia] Matched: refresh');
      const result = await executeFrontendTool('refresh_page', {});
      return { handled: true, result };
    }

    // Simple navigation check: does message contain a known route + navigation intent?
    const hasNavIntent = /打开|去|转|看|进入|切换|跳转|navigate|open|go/i.test(lowerMsg);

    if (hasNavIntent) {
      console.log('[Cecelia] Has navigation intent, checking routes...');

      // Check each route alias (longer aliases first to avoid partial matches)
      const sortedAliases = Object.entries(ROUTE_ALIASES)
        .sort((a, b) => b[0].length - a[0].length);

      for (const [alias, route] of sortedAliases) {
        if (lowerMsg.includes(alias)) {
          console.log('[Cecelia] Found route alias:', alias, '→', route);
          await executeFrontendTool('navigate_to', { path: route });
          const displayName = PAGE_DISPLAY_NAMES[route] || alias;
          return { handled: true, result: `🧭 正在前往「${displayName}」` };
        }
      }
    }

    // Check for expand
    const expandMatch = message.match(FRONTEND_PATTERNS.expand);
    if (expandMatch) {
      const itemId = expandMatch[2].trim();
      const result = await executeFrontendTool('expand_item', { id: itemId });
      return { handled: true, result };
    }

    // Check for collapse
    const collapseMatch = message.match(FRONTEND_PATTERNS.collapse);
    if (collapseMatch) {
      const itemId = collapseMatch[2].trim();
      const result = await executeFrontendTool('collapse_item', { id: itemId });
      return { handled: true, result };
    }

    // Check for toggle
    const toggleMatch = message.match(FRONTEND_PATTERNS.toggle);
    if (toggleMatch) {
      const itemId = toggleMatch[2].trim();
      const result = await executeFrontendTool('toggle_item', { id: itemId });
      return { handled: true, result };
    }

    // Check for filter
    const filterMatch = message.match(FRONTEND_PATTERNS.filter);
    if (filterMatch) {
      const filterValue = filterMatch[2].trim();
      // Try to parse "status active" or "priority P0"
      const parts = filterValue.split(/\s+/);
      if (parts.length >= 2) {
        const result = await executeFrontendTool('set_filter', {
          filterName: parts[0],
          value: parts.slice(1).join(' ')
        });
        return { handled: true, result };
      }
    }

    return { handled: false };
  }, [executeFrontendTool]);

  // Voice-related callbacks (must be after tryFrontendCommand)
  const handleToolCall = useCallback(async (toolName: string, result: any) => {
    console.log('[CeceliaChat] Tool:', toolName, result);

    // Intercept open_detail when there's no specific item - treat as navigation
    if (toolName === 'open_detail' && result === null) {
      // The tool failed, likely because no name was provided
      // This usually means the user wants to navigate to the page
      // We can't get the original args here, but we can handle it in handleUserSpeech
    }

    // Handle navigate_to_page if backend sends it
    if (toolName === 'navigate_to_page' && result?.page) {
      const pageRoutes: Record<string, string> = {
        'okr': '/okr',
        'projects': '/projects',
        'tasks': '/tasks',
        'orchestrator': '/orchestrator',
        'planner': '/planner',
        'brain': '/brain',
        'home': '/',
      };
      const path = pageRoutes[result.page];
      if (path) {
        await executeFrontendTool('navigate_to', { path });
        const displayName = PAGE_DISPLAY_NAMES[path] || result.page;
        addMessage({
          id: generateId(),
          role: 'assistant',
          content: `🧭 正在前往「${displayName}」`,
          toolCall: { name: 'navigate', result: path }
        });
      }
    }
  }, [executeFrontendTool, addMessage, generateId]);

  const handleUserSpeech = useCallback(async (transcript: string) => {
    console.log('[Cecelia] User speech received:', transcript);
    addMessage({ id: generateId(), role: 'user', content: transcript, isVoice: true });

    // Try to handle as frontend command (navigation, etc.)
    // This allows voice commands to control the UI
    const frontendResult = await tryFrontendCommand(transcript);
    if (frontendResult.handled) {
      console.log('[Cecelia] Frontend command handled:', frontendResult.result);
      addMessage({
        id: generateId(),
        role: 'assistant',
        content: frontendResult.result || '好的',
        toolCall: { name: 'frontend_action', result: frontendResult.result }
      });
      // Note: OpenAI Realtime may still respond, but user will see our quick local response
    }
    // If not a frontend command, let the realtime API handle it normally
  }, [addMessage, generateId, tryFrontendCommand]);

  const handleAssistantSpeech = useCallback((transcript: string, isComplete: boolean) => {
    if (currentStreamingIdRef.current) {
      updateMessage(currentStreamingIdRef.current, {
        content: transcript,
        isStreaming: !isComplete
      });
      if (isComplete) currentStreamingIdRef.current = null;
    } else {
      const newId = generateId();
      currentStreamingIdRef.current = isComplete ? null : newId;
      addMessage({
        id: newId,
        role: 'assistant',
        content: transcript,
        isVoice: true,
        isStreaming: !isComplete
      });
    }
  }, [addMessage, updateMessage, generateId, currentStreamingIdRef]);

  const realtime = useRealtimeVoice({
    onUserSpeech: handleUserSpeech,
    onAssistantSpeech: handleAssistantSpeech,
    onToolCall: handleToolCall
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = async () => {
    if (!input.trim() || sending) return;
    const userMessage = input.trim();
    setInput('');
    setSending(true);
    addMessage({ id: generateId(), role: 'user', content: userMessage });

    try {
      // First, try to handle as frontend command
      const frontendResult = await tryFrontendCommand(userMessage);

      if (frontendResult.handled) {
        // Add assistant message with frontend tool result
        addMessage({
          id: generateId(),
          role: 'assistant',
          content: frontendResult.result || 'Done',
          toolCall: { name: 'frontend_action', result: frontendResult.result }
        });
        setSending(false);
        return;
      }

      // Not a frontend command - send to backend with page context
      const pageContext = getPageContext();
      const res = await fetch('/api/orchestrator/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMessage,
          context: {
            currentRoute,
            pageContext,
            availableTools: frontendTools.map(t => ({
              name: t.name,
              description: t.description,
              parameters: t.parameters
            }))
          }
        })
      });
      const data = await res.json();

      if (data.success && data.response) {
        // Check if backend wants to execute a frontend tool
        if (data.response.frontendTool) {
          const toolResult = await executeFrontendTool(
            data.response.frontendTool.name,
            data.response.frontendTool.args
          );
          addMessage({
            id: generateId(),
            role: 'assistant',
            content: data.response.message || toolResult,
            toolCall: { name: data.response.frontendTool.name, result: toolResult }
          });
        } else {
          addMessage({ id: generateId(), role: 'assistant', content: data.response.message });
        }
      }
    } catch {
      addMessage({ id: generateId(), role: 'assistant', content: 'An error occurred' });
    } finally {
      setSending(false);
    }
  };

  if (chatOpen) {
    return (
      <div className="fixed bottom-20 right-6 w-80 h-[480px] flex flex-col bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xl z-50">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-100 dark:border-slate-700 flex-shrink-0">
          <div className="p-1.5 bg-gradient-to-br from-slate-600 to-slate-800 rounded">
            <Brain className="w-4 h-4 text-white" />
          </div>
          <span className="font-medium text-sm text-slate-900 dark:text-white">Cecelia</span>
          {realtime.isConnected && (
            <span className="flex items-center gap-1 text-xs text-emerald-500">
              <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
              {realtime.isRecording && <Mic className="w-3 h-3" />}
              {realtime.isPlaying && <Volume2 className="w-3 h-3" />}
            </span>
          )}
          <button
            onClick={() => setChatOpen(false)}
            className="ml-auto p-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded"
          >
            <Minimize2 className="w-4 h-4 text-slate-400" />
          </button>
        </div>

        {/* Page Context Indicator */}
        {pageState && (
          <div className="px-3 py-1.5 bg-slate-50 dark:bg-slate-900/50 border-b border-slate-100 dark:border-slate-700 flex-shrink-0">
            <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
              <Eye className="w-3 h-3" />
              <span className="truncate">{pageState.title}</span>
              <span className="text-slate-300 dark:text-slate-600">•</span>
              <span className="text-slate-400">{pageState.pageType}</span>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-3 space-y-2 min-h-0">
          {messages.length === 0 && (
            <div className="text-center py-8">
              <Sparkles className="w-6 h-6 mx-auto text-slate-300 dark:text-slate-600 mb-2" />
              <p className="text-xs text-slate-400">Say something</p>
              <p className="text-xs text-slate-300 dark:text-slate-600 mt-1">
                Try: "go to projects" or "where am I"
              </p>
            </div>
          )}
          {messages.map(msg => (
            <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] rounded-lg text-sm break-words ${
                msg.role === 'user'
                  ? 'bg-blue-500 text-white px-3 py-2'
                  : 'bg-slate-100 dark:bg-slate-700 text-slate-900 dark:text-white px-3 py-2'
              } ${msg.isStreaming ? 'animate-pulse' : ''}`}>
                {msg.toolCall && (
                  <div className="flex items-center gap-1.5 text-xs opacity-70 mb-1">
                    <Navigation className="w-3 h-3" />
                    <span>{msg.toolCall.name}</span>
                  </div>
                )}
                {msg.content}
              </div>
            </div>
          ))}
          {sending && (
            <div className="flex justify-start">
              <div className="px-3 py-2 bg-slate-100 dark:bg-slate-700 rounded-lg">
                <RefreshCw className="w-4 h-4 animate-spin text-slate-400" />
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
        <div className="p-3 border-t border-slate-100 dark:border-slate-700 flex-shrink-0">
          {realtime.error && <p className="text-xs text-red-500 mb-2 truncate">{realtime.error}</p>}
          <div className="flex gap-2">
            <button
              onClick={realtime.isConnected ? realtime.disconnect : realtime.connect}
              className={`p-2 rounded-lg ${realtime.isConnected ? 'bg-red-500' : 'bg-emerald-500'} text-white`}
            >
              {realtime.isConnected ? <PhoneOff className="w-4 h-4" /> : <Phone className="w-4 h-4" />}
            </button>
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && sendMessage()}
              placeholder="Type a message..."
              disabled={realtime.isConnected}
              className="flex-1 px-3 py-2 bg-slate-100 dark:bg-slate-700 rounded-lg text-sm disabled:opacity-50"
            />
            <button
              onClick={sendMessage}
              disabled={!input.trim() || sending || realtime.isConnected}
              className="p-2 bg-blue-500 disabled:bg-slate-300 text-white rounded-lg"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <button
      onClick={() => setChatOpen(true)}
      className="fixed bottom-6 right-6 p-4 bg-gradient-to-br from-slate-700 to-slate-900 text-white rounded-full shadow-lg hover:shadow-xl hover:from-slate-600 hover:to-slate-800 transition-all z-50 border border-slate-600/50"
    >
      <MessageCircle className="w-6 h-6" />
      {realtime.isConnected && (
        <span className="absolute -top-1 -right-1 w-3 h-3 bg-emerald-500 rounded-full animate-pulse" />
      )}
    </button>
  );
}

export default CeceliaChat;
