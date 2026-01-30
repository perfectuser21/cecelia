import type { ReactNode } from 'react';
import { createContext, useContext, useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Navigation, Sparkles } from 'lucide-react';

// Page display names for navigation toast
const PAGE_DISPLAY_NAMES: Record<string, string> = {
  '/okr': 'OKR 目标',
  '/projects': '项目列表',
  '/orchestrator': 'Command Center',
  '/tasks': '任务列表',
  '/planner': '工作规划',
  '/brain': '大脑',
  '/': '首页',
};

// ============ Types ============

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  isVoice?: boolean;
  isStreaming?: boolean;
  toolCall?: {
    name: string;
    result: any;
  };
}

// Page state that each page registers
export interface PageState {
  pageType: string;           // 'okr' | 'projects' | 'project-detail' | 'orchestrator' | etc
  title: string;              // Page title for Cecelia to know
  data: any;                  // Current page data (OKRs, projects, tasks, etc)
  uiState: Record<string, any>; // UI state (expandedIds, selectedId, filters, etc)
  summary?: string;           // Brief summary of what's on the page
}

// Actions that each page registers
export interface PageActions {
  // Common actions
  refresh?: () => void;
  // Item actions
  expandItem?: (id: string) => void;
  collapseItem?: (id: string) => void;
  toggleItem?: (id: string) => void;
  selectItem?: (id: string) => void;
  // Custom actions - pages can register their own
  [key: string]: ((...args: any[]) => any) | undefined;
}

// Frontend Tool definitions
export interface FrontendTool {
  name: string;
  description: string;
  parameters: {
    name: string;
    type: string;
    description: string;
    required?: boolean;
  }[];
  execute: (args: Record<string, any>, context: CeceliaContextType) => Promise<string>;
}

// Navigation toast state
interface NavigationToast {
  visible: boolean;
  destination: string;
  path: string;
}

interface CeceliaContextType {
  // Chat state
  messages: ChatMessage[];
  addMessage: (message: ChatMessage) => void;
  updateMessage: (id: string, updates: Partial<ChatMessage>) => void;
  clearMessages: () => void;
  chatOpen: boolean;
  setChatOpen: (open: boolean) => void;
  toggleChat: () => void;
  input: string;
  setInput: (input: string) => void;
  sending: boolean;
  setSending: (sending: boolean) => void;
  generateId: () => string;
  currentStreamingIdRef: React.MutableRefObject<string | null>;

  // Page awareness
  currentRoute: string;
  pageState: PageState | null;
  pageActions: PageActions;
  registerPage: (state: PageState, actions: PageActions) => void;
  unregisterPage: () => void;

  // Navigation
  navigateTo: (path: string) => void;
  showNavigationToast: (path: string) => void;

  // Frontend Tools
  frontendTools: FrontendTool[];
  executeFrontendTool: (toolName: string, args: Record<string, any>) => Promise<string>;

  // Get page context for AI
  getPageContext: () => string;
}

const CeceliaContext = createContext<CeceliaContextType | undefined>(undefined);

// ============ Frontend Tools ============

const createFrontendTools = (navigate: (path: string) => void, showToast: (path: string) => void): FrontendTool[] => [
  {
    name: 'get_current_page',
    description: 'Get information about what page the user is currently viewing',
    parameters: [],
    execute: async (_, context) => {
      if (!context.pageState) {
        return `User is at ${context.currentRoute} but page hasn't registered its state yet.`;
      }
      return context.getPageContext();
    }
  },
  {
    name: 'navigate_to',
    description: 'Navigate to a different page',
    parameters: [
      { name: 'path', type: 'string', description: 'The path to navigate to, e.g., "/okr", "/projects", "/projects/123"', required: true }
    ],
    execute: async (args) => {
      const { path } = args;
      console.log('[Cecelia] Executing navigate_to:', path);
      // Show navigation toast
      showToast(path);
      // Use the navigate function directly (passed to createFrontendTools)
      navigate(path);
      console.log('[Cecelia] Navigation executed');
      const displayName = PAGE_DISPLAY_NAMES[path] || path;
      return `🧭 正在前往「${displayName}」`;
    }
  },
  {
    name: 'expand_item',
    description: 'Expand an item on the current page (e.g., expand an OKR to show its key results)',
    parameters: [
      { name: 'id', type: 'string', description: 'The ID of the item to expand', required: true }
    ],
    execute: async (args, context) => {
      if (!context.pageActions.expandItem) {
        return 'This page does not support expanding items';
      }
      context.pageActions.expandItem(args.id);
      return `Expanded item ${args.id}`;
    }
  },
  {
    name: 'collapse_item',
    description: 'Collapse an expanded item on the current page',
    parameters: [
      { name: 'id', type: 'string', description: 'The ID of the item to collapse', required: true }
    ],
    execute: async (args, context) => {
      if (!context.pageActions.collapseItem) {
        return 'This page does not support collapsing items';
      }
      context.pageActions.collapseItem(args.id);
      return `Collapsed item ${args.id}`;
    }
  },
  {
    name: 'toggle_item',
    description: 'Toggle an item expanded/collapsed on the current page',
    parameters: [
      { name: 'id', type: 'string', description: 'The ID of the item to toggle', required: true }
    ],
    execute: async (args, context) => {
      if (!context.pageActions.toggleItem) {
        return 'This page does not support toggling items';
      }
      context.pageActions.toggleItem(args.id);
      return `Toggled item ${args.id}`;
    }
  },
  {
    name: 'refresh_page',
    description: 'Refresh the current page data',
    parameters: [],
    execute: async (_, context) => {
      if (!context.pageActions.refresh) {
        return 'This page does not support refresh';
      }
      context.pageActions.refresh();
      return 'Page refreshed';
    }
  },
  {
    name: 'set_filter',
    description: 'Set a filter on the current page',
    parameters: [
      { name: 'filterName', type: 'string', description: 'Name of the filter (e.g., "status", "priority")', required: true },
      { name: 'value', type: 'string', description: 'Filter value (e.g., "active", "P0")', required: true }
    ],
    execute: async (args, context) => {
      const setFilter = context.pageActions[`setFilter_${args.filterName}`] || context.pageActions.setFilter;
      if (!setFilter) {
        return `This page does not support ${args.filterName} filter`;
      }
      setFilter(args.filterName, args.value);
      return `Set ${args.filterName} filter to ${args.value}`;
    }
  }
];

// ============ Provider ============

export function CeceliaProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();

  // Chat state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatOpen, setChatOpen] = useState(false);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const currentStreamingIdRef = useRef<string | null>(null);

  // Page state
  const [pageState, setPageState] = useState<PageState | null>(null);
  const [pageActions, setPageActions] = useState<PageActions>({});

  // Navigation toast state
  const [navToast, setNavToast] = useState<NavigationToast>({ visible: false, destination: '', path: '' });

  // Show navigation toast
  const showNavigationToast = useCallback((path: string) => {
    const displayName = PAGE_DISPLAY_NAMES[path] || path;
    setNavToast({ visible: true, destination: displayName, path });
    // Auto-hide after 2 seconds
    setTimeout(() => {
      setNavToast(prev => ({ ...prev, visible: false }));
    }, 2000);
  }, []);

  const generateId = useCallback(() => {
    return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  }, []);

  const addMessage = useCallback((message: ChatMessage) => {
    setMessages(prev => [...prev, message]);
  }, []);

  const updateMessage = useCallback((id: string, updates: Partial<ChatMessage>) => {
    setMessages(prev => prev.map(msg =>
      msg.id === id ? { ...msg, ...updates } : msg
    ));
  }, []);

  const clearMessages = useCallback(() => {
    setMessages([]);
    currentStreamingIdRef.current = null;
  }, []);

  const toggleChat = useCallback(() => {
    setChatOpen(prev => !prev);
  }, []);

  // Page registration
  const registerPage = useCallback((state: PageState, actions: PageActions) => {
    setPageState(state);
    setPageActions(actions);
  }, []);

  const unregisterPage = useCallback(() => {
    setPageState(null);
    setPageActions({});
  }, []);

  // Navigation
  const navigateTo = useCallback((path: string) => {
    navigate(path);
  }, [navigate]);

  // Frontend tools
  const frontendTools = useMemo(() => createFrontendTools(navigate, showNavigationToast), [navigate, showNavigationToast]);

  // Execute frontend tool
  const executeFrontendTool = useCallback(async (toolName: string, args: Record<string, any>): Promise<string> => {
    console.log('[Cecelia] executeFrontendTool called:', toolName, args);
    const tool = frontendTools.find(t => t.name === toolName);
    if (!tool) {
      console.log('[Cecelia] Tool not found:', toolName);
      return `Unknown tool: ${toolName}`;
    }
    console.log('[Cecelia] Found tool, executing...');

    // We need to pass the current context to the tool
    // This is a bit tricky since we're inside the provider
    // We'll create a snapshot of the context
    const contextSnapshot: CeceliaContextType = {
      messages,
      addMessage,
      updateMessage,
      clearMessages,
      chatOpen,
      setChatOpen,
      toggleChat,
      input,
      setInput,
      sending,
      setSending,
      generateId,
      currentStreamingIdRef,
      currentRoute: location.pathname,
      pageState,
      pageActions,
      registerPage,
      unregisterPage,
      navigateTo,
      frontendTools,
      executeFrontendTool: async () => '', // Placeholder
      getPageContext: () => '', // Will be set below
    };

    // Set getPageContext
    contextSnapshot.getPageContext = () => {
      if (!pageState) {
        return `Current page: ${location.pathname}\nNo page state registered.`;
      }

      let context = `Current page: ${location.pathname}\n`;
      context += `Page type: ${pageState.pageType}\n`;
      context += `Title: ${pageState.title}\n`;

      if (pageState.summary) {
        context += `Summary: ${pageState.summary}\n`;
      }

      if (pageState.uiState && Object.keys(pageState.uiState).length > 0) {
        context += `UI State: ${JSON.stringify(pageState.uiState)}\n`;
      }

      if (pageState.data) {
        // Provide a summary of data, not the full data
        if (Array.isArray(pageState.data)) {
          context += `Data: ${pageState.data.length} items\n`;
          // Show first few items
          const preview = pageState.data.slice(0, 5).map((item: any) =>
            item.title || item.name || item.id
          ).join(', ');
          context += `Preview: ${preview}${pageState.data.length > 5 ? '...' : ''}\n`;
        } else if (typeof pageState.data === 'object') {
          context += `Data: ${JSON.stringify(pageState.data, null, 2).slice(0, 500)}...\n`;
        }
      }

      // Available actions
      const availableActions = Object.keys(pageActions).filter(k => pageActions[k]);
      if (availableActions.length > 0) {
        context += `Available actions: ${availableActions.join(', ')}\n`;
      }

      return context;
    };

    return await tool.execute(args, contextSnapshot);
  }, [frontendTools, messages, addMessage, updateMessage, clearMessages, chatOpen, setChatOpen, toggleChat, input, setInput, sending, setSending, generateId, currentStreamingIdRef, location.pathname, pageState, pageActions, registerPage, unregisterPage, navigateTo]);

  // Get page context for AI
  const getPageContext = useCallback(() => {
    if (!pageState) {
      return `Current page: ${location.pathname}\nNo page state registered.`;
    }

    let context = `Current page: ${location.pathname}\n`;
    context += `Page type: ${pageState.pageType}\n`;
    context += `Title: ${pageState.title}\n`;

    if (pageState.summary) {
      context += `Summary: ${pageState.summary}\n`;
    }

    if (pageState.uiState && Object.keys(pageState.uiState).length > 0) {
      context += `UI State: ${JSON.stringify(pageState.uiState)}\n`;
    }

    if (pageState.data) {
      if (Array.isArray(pageState.data)) {
        context += `Data: ${pageState.data.length} items\n`;
        const preview = pageState.data.slice(0, 5).map((item: any) =>
          item.title || item.name || item.id
        ).join(', ');
        context += `Preview: ${preview}${pageState.data.length > 5 ? '...' : ''}\n`;
      } else if (typeof pageState.data === 'object') {
        context += `Data: ${JSON.stringify(pageState.data, null, 2).slice(0, 500)}...\n`;
      }
    }

    const availableActions = Object.keys(pageActions).filter(k => pageActions[k]);
    if (availableActions.length > 0) {
      context += `Available actions: ${availableActions.join(', ')}\n`;
    }

    return context;
  }, [location.pathname, pageState, pageActions]);

  const value: CeceliaContextType = {
    // Chat
    messages,
    addMessage,
    updateMessage,
    clearMessages,
    chatOpen,
    setChatOpen,
    toggleChat,
    input,
    setInput,
    sending,
    setSending,
    generateId,
    currentStreamingIdRef,
    // Page awareness
    currentRoute: location.pathname,
    pageState,
    pageActions,
    registerPage,
    unregisterPage,
    // Navigation
    navigateTo,
    showNavigationToast,
    // Frontend Tools
    frontendTools,
    executeFrontendTool,
    getPageContext,
  };

  return (
    <CeceliaContext.Provider value={value}>
      {children}

      {/* Navigation Toast - Bottom right, near Cecelia button */}
      <div
        className={`fixed bottom-24 right-6 z-[100] transition-all duration-400 ease-out ${
          navToast.visible
            ? 'opacity-100 translate-x-0'
            : 'opacity-0 translate-x-8 pointer-events-none'
        }`}
      >
        <div className="relative">
          {/* Glow effect */}
          <div className="absolute inset-0 bg-gradient-to-r from-violet-500/40 via-purple-500/40 to-indigo-500/40 blur-lg rounded-2xl scale-110" />

          {/* Main toast */}
          <div className="relative flex items-center gap-3 px-5 py-3 bg-slate-900/90 backdrop-blur-xl rounded-2xl border border-violet-500/40 shadow-2xl shadow-violet-500/30">
            {/* Animated icon */}
            <div className="relative">
              <div className="absolute inset-0 bg-violet-500/60 rounded-full blur animate-pulse" />
              <div className="relative p-2 bg-gradient-to-br from-violet-500 to-purple-600 rounded-full">
                <Navigation className="w-4 h-4 text-white" />
              </div>
            </div>

            {/* Text content */}
            <div className="flex flex-col">
              <span className="text-[10px] text-slate-500 uppercase tracking-wider">Navigating</span>
              <span className="text-sm font-semibold text-white">{navToast.destination}</span>
            </div>

            {/* Progress bar animation */}
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-slate-800 rounded-b-2xl overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-violet-500 via-purple-500 to-indigo-500"
                style={{
                  animation: 'progress 2s ease-out forwards',
                }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* CSS for progress animation */}
      <style>{`
        @keyframes progress {
          0% { width: 0%; }
          100% { width: 100%; }
        }
      `}</style>
    </CeceliaContext.Provider>
  );
}

export function useCecelia() {
  const context = useContext(CeceliaContext);
  if (context === undefined) {
    throw new Error('useCecelia must be used within a CeceliaProvider');
  }
  return context;
}

// Hook for pages to register themselves
export function useCeceliaPage(
  pageType: string,
  title: string,
  getData: () => any,
  getUiState: () => Record<string, any>,
  actions: PageActions,
  getSummary?: () => string
) {
  const { registerPage, unregisterPage } = useCecelia();

  // Register on mount and when deps change
  const register = useCallback(() => {
    registerPage(
      {
        pageType,
        title,
        data: getData(),
        uiState: getUiState(),
        summary: getSummary?.(),
      },
      actions
    );
  }, [registerPage, pageType, title, getData, getUiState, actions, getSummary]);

  return { register, unregisterPage };
}
