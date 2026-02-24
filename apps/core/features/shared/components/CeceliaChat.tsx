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
import { useCecelia } from '@/contexts/CeceliaContext';
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
          messages: messages.slice(-10).map(m => ({ role: m.role, content: m.content })),
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

      // Brain API returns { reply, routing_level, intent }
      if (data.reply) {
        addMessage({ id: generateId(), role: 'assistant', content: data.reply });
      } else if (data.error) {
        addMessage({ id: generateId(), role: 'assistant', content: `⚠️ ${data.error}` });
      }
    } catch {
      addMessage({ id: generateId(), role: 'assistant', content: 'An error occurred' });
    } finally {
      setSending(false);
    }
  };

  if (chatOpen) {
    return (
      <div
        className="fixed w-80 flex flex-col bg-slate-900/95 backdrop-blur-xl rounded-2xl border border-slate-700/50 shadow-2xl shadow-purple-500/10 z-50 overflow-hidden"
        style={{ bottom: '24px', right: '24px', height: '480px', maxHeight: '480px', minHeight: '480px' }}
      >
        {/* Top glow line */}
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-purple-400/50 to-transparent" />

        <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-700/50 flex-shrink-0 bg-slate-800/50">
          <div className="relative">
            <div className="absolute inset-0 bg-purple-500/30 rounded-lg blur-sm" />
            <div className="relative p-1.5 bg-gradient-to-br from-slate-600 via-purple-600/20 to-slate-800 rounded-lg border border-slate-600/50">
              <Brain className="w-4 h-4 text-purple-300" />
            </div>
          </div>
          <span className="font-medium text-sm text-slate-100">Cecelia</span>
          {realtime.isConnected && (
            <span className="flex items-center gap-1 text-xs text-emerald-500">
              <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
              {realtime.isRecording && <Mic className="w-3 h-3" />}
              {realtime.isPlaying && <Volume2 className="w-3 h-3" />}
            </span>
          )}
          <button
            onClick={() => setChatOpen(false)}
            className="ml-auto p-1.5 hover:bg-slate-700/50 rounded-lg transition-colors"
          >
            <ChevronDown className="w-4 h-4 text-slate-400" />
          </button>
        </div>

        {/* Page Context Indicator */}
        {pageState && (
          <div className="px-4 py-1.5 bg-slate-800/30 border-b border-slate-700/30 flex-shrink-0">
            <div className="flex items-center gap-1.5 text-xs text-slate-400">
              <Eye className="w-3 h-3 text-purple-400/60" />
              <span className="truncate">{pageState.title}</span>
              <span className="text-slate-600">•</span>
              <span className="text-slate-500">{pageState.pageType}</span>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
          {messages.length === 0 && (
            <div className="text-center py-8">
              <Sparkles className="w-6 h-6 mx-auto text-purple-400/40 mb-2" />
              <p className="text-xs text-slate-400">Say something</p>
              <p className="text-xs text-slate-500 mt-1">
                Try: "go to projects" or "where am I"
              </p>
            </div>
          )}
          {messages.map(msg => (
            <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] rounded-xl text-sm break-words ${
                msg.role === 'user'
                  ? 'bg-gradient-to-br from-purple-600 to-purple-700 text-white px-3 py-2 shadow-lg shadow-purple-500/20'
                  : 'bg-slate-800/80 text-slate-200 px-3 py-2 border border-slate-700/50'
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
              <div className="px-3 py-2 bg-slate-800/80 rounded-xl border border-slate-700/50">
                <RefreshCw className="w-4 h-4 animate-spin text-purple-400" />
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
        <div className="p-3 border-t border-slate-700/50 flex-shrink-0 bg-slate-800/30">
          {realtime.error && <p className="text-xs text-red-400 mb-2 truncate">{realtime.error}</p>}
          <div className="flex gap-2">
            <button
              onClick={realtime.isConnected ? realtime.disconnect : realtime.connect}
              className={`p-2 rounded-lg transition-all ${realtime.isConnected ? 'bg-red-500/80 hover:bg-red-500' : 'bg-emerald-600/80 hover:bg-emerald-600'} text-white`}
            >
              {realtime.isConnected ? <PhoneOff className="w-4 h-4" /> : <Phone className="w-4 h-4" />}
            </button>
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && sendMessage()}
              placeholder="Type a message..."
              disabled={realtime.isConnected}
              className="flex-1 px-3 py-2 bg-slate-800/80 border border-slate-700/50 rounded-lg text-sm text-slate-200 placeholder-slate-500 disabled:opacity-50 focus:outline-none focus:border-purple-500/50"
            />
            <button
              onClick={sendMessage}
              disabled={!input.trim() || sending || realtime.isConnected}
              className="p-2 bg-purple-600 hover:bg-purple-500 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-lg transition-all"
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
      className="fixed p-4 bg-gradient-to-br from-slate-800 via-purple-900/50 to-slate-900 text-white rounded-full shadow-lg shadow-purple-500/20 hover:shadow-xl hover:shadow-purple-500/30 hover:scale-105 transition-all z-50 border border-slate-600/50 group"
      style={{ bottom: '24px', right: '24px' }}
    >
      {/* Glow effect */}
      <div className="absolute inset-0 rounded-full bg-purple-500/20 blur-md opacity-0 group-hover:opacity-100 transition-opacity" />
      <MessageCircle className="w-6 h-6 relative z-10" />
      {realtime.isConnected && (
        <span className="absolute -top-1 -right-1 w-3 h-3 bg-emerald-500 rounded-full animate-pulse" />
      )}
    </button>
  );
}

export default CeceliaChat;
