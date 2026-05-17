// Route: /knowledge/doc-chat/:id — 文档+聊天分栏界面（Notion AI 风格）
import { useState, useRef, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Send, RefreshCw, Pencil, Check, X, Sparkles, ChevronDown } from 'lucide-react';
import { useApi } from '../../shared/hooks/useApi';

interface DesignDoc {
  id: string;
  title: string;
  content: string;
  type: string;
  status: string;
  updated_at: string;
  chat_history?: ChatMessage[];
}

interface DesignDocListItem {
  id: string;
  title: string;
  type: string;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  ts?: number;
}

const MODEL_OPTIONS = [
  { value: 'claude-haiku-4-5-20251001', label: 'Haiku' },
  { value: 'claude-sonnet-4-6', label: 'Sonnet' },
  { value: 'claude-opus-4-6', label: 'Opus' },
];

function renderMarkdown(text: string): string {
  return text
    .replace(/^### (.+)$/gm, '<h3 style="font-size:0.9rem;font-weight:600;margin:0.75rem 0 0.2rem">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 style="font-size:1rem;font-weight:700;margin:1rem 0 0.4rem">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 style="font-size:1.15rem;font-weight:700;margin:1.25rem 0 0.4rem">$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^- (.+)$/gm, '<li style="margin-left:1.25rem;list-style-type:disc">$1</li>')
    .replace(/^(\d+)\. (.+)$/gm, '<li style="margin-left:1.25rem;list-style-type:decimal">$2</li>')
    .replace(/`(.+?)`/g, '<code style="background:#f3f4f6;padding:0.1em 0.3em;border-radius:3px;font-size:0.85em">$1</code>')
    .replace(/\n\n/g, '<br/><br/>')
    .replace(/\n/g, '<br/>');
}

/** 文件选择器：下拉列出所有 design_docs */
function FileSelector({ currentId, onSelect }: { currentId: string; onSelect: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const { data } = useApi<{ success: boolean; data: DesignDocListItem[] }>(
    '/api/brain/design-docs?limit=100',
    { staleTime: 60_000 }
  );
  const docs = data?.data || [];

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1 text-xs px-2 py-1 border border-gray-200 rounded hover:border-gray-400 text-gray-600"
      >
        切换文件 <ChevronDown size={10} />
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 w-72 bg-white border border-gray-200 rounded-lg shadow-lg z-50 max-h-64 overflow-y-auto">
          {docs.map(d => (
            <button
              key={d.id}
              onClick={() => { onSelect(d.id); setOpen(false); }}
              className={`w-full text-left px-3 py-2 text-xs hover:bg-gray-50 border-b border-gray-100 last:border-0 ${
                d.id === currentId ? 'bg-blue-50 text-blue-700' : 'text-gray-700'
              }`}
            >
              <span className="font-medium truncate block">{d.title}</span>
              <span className="text-gray-400">{d.type}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function DocChatPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [model, setModel] = useState('claude-haiku-4-5-20251001');
  const [sending, setSending] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeResult, setAnalyzeResult] = useState<string | null>(null);
  const [docContent, setDocContent] = useState<string | null>(null);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editText, setEditText] = useState('');
  const [saving, setSaving] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { data, loading } = useApi<{ success: boolean; data: DesignDoc }>(
    `/api/brain/design-docs/${id}`,
    { staleTime: 0 }
  );
  const doc = data?.data;

  // 初始化：加载文档内容 + 持久化的对话历史
  useEffect(() => {
    if (!doc || historyLoaded) return;
    setDocContent(doc.content || '');
    if (Array.isArray(doc.chat_history) && doc.chat_history.length > 0) {
      setMessages(doc.chat_history);
    }
    setHistoryLoaded(true);
  }, [doc, historyLoaded]);

  // 切换文档时重置状态
  useEffect(() => {
    setDocContent(null);
    setMessages([]);
    setHistoryLoaded(false);
    setEditMode(false);
    setAnalyzeResult(null);
  }, [id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  /** 保存对话历史到 Brain */
  const saveHistory = useCallback(async (newMessages: ChatMessage[]) => {
    if (!id) return;
    const toSave = newMessages.slice(-100); // 最多 100 条
    await fetch(`/api/brain/design-docs/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_history: toSave }),
    }).catch(() => {});
  }, [id]);

  function startEdit() {
    setEditText(docContent || '');
    setEditMode(true);
  }

  function cancelEdit() {
    setEditMode(false);
    setEditText('');
  }

  async function saveEdit() {
    if (!id || saving) return;
    setSaving(true);
    try {
      const resp = await fetch(`/api/brain/design-docs/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: editText }),
      });
      const result = await resp.json();
      if (result.success) {
        setDocContent(editText);
        setEditMode(false);
        setEditText('');
      }
    } finally {
      setSaving(false);
    }
  }

  async function sendMessage() {
    if (!input.trim() || sending || !id) return;

    const userMsg: ChatMessage = { role: 'user', content: input.trim(), ts: Date.now() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setSending(true);

    try {
      const resp = await fetch(`/api/brain/design-docs/${id}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMsg.content, history: messages, model }),
      });
      const result = await resp.json();
      if (!result.success) throw new Error(result.error || '请求失败');

      const assistantMsg: ChatMessage = { role: 'assistant', content: result.reply, ts: Date.now() };
      const finalMessages = [...newMessages, assistantMsg];
      setMessages(finalMessages);
      if (result.updated_content) setDocContent(result.updated_content);

      // 异步保存历史
      await saveHistory(finalMessages);
    } catch (err: any) {
      const errMsg: ChatMessage = { role: 'assistant', content: `⚠️ ${err.message}`, ts: Date.now() };
      const finalMessages = [...newMessages, errMsg];
      setMessages(finalMessages);
      await saveHistory(finalMessages);
    } finally {
      setSending(false);
    }
  }

  async function runAnalyze() {
    if (!id || analyzing) return;
    setAnalyzing(true);
    setAnalyzeResult(null);
    try {
      const resp = await fetch(`/api/brain/design-docs/${id}/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'claude-sonnet-4-6' }),
      });
      const result = await resp.json();
      if (result.success) {
        setAnalyzeResult(result.created === 0
          ? '没有新内容可捕获'
          : `已创建 ${result.created} 条 Capture`
        );
      } else {
        setAnalyzeResult(`失败：${result.error}`);
      }
    } catch (err: any) {
      setAnalyzeResult(`失败：${err.message}`);
    } finally {
      setAnalyzing(false);
      setTimeout(() => setAnalyzeResult(null), 4000);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  if (loading) {
    return <div className="flex h-full items-center justify-center text-gray-400 text-sm">加载中...</div>;
  }
  if (!doc) {
    return <div className="flex h-full items-center justify-center text-gray-400 text-sm">文档不存在</div>;
  }

  return (
    <div className="flex h-full" style={{ fontFamily: 'system-ui, sans-serif' }}>
      {/* 左栏：文档内容 */}
      <div className="flex-1 flex flex-col border-r border-gray-200 min-w-0">
        {/* 标题栏 */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-200 bg-white flex-shrink-0">
          <button onClick={() => navigate('/knowledge/designs')} className="text-gray-400 hover:text-gray-600">
            <ArrowLeft size={15} />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-sm font-semibold text-gray-900 truncate">{doc.title}</h1>
          </div>
          {!editMode && docContent !== doc.content && (
            <span className="text-xs text-green-600 flex items-center gap-1">
              <RefreshCw size={10} />已更新
            </span>
          )}
          <FileSelector currentId={id!} onSelect={newId => navigate(`/knowledge/doc-chat/${newId}`)} />
          {editMode ? (
            <div className="flex items-center gap-1">
              <button onClick={saveEdit} disabled={saving}
                className="flex items-center gap-1 text-xs px-2 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50">
                <Check size={11} />{saving ? '保存中...' : '保存'}
              </button>
              <button onClick={cancelEdit}
                className="flex items-center gap-1 text-xs px-2 py-1 border border-gray-200 rounded text-gray-600 hover:border-gray-400">
                <X size={11} />取消
              </button>
            </div>
          ) : (
            <button onClick={startEdit}
              className="flex items-center gap-1 text-xs px-2 py-1 border border-gray-200 rounded text-gray-600 hover:border-gray-400">
              <Pencil size={11} />编辑
            </button>
          )}
        </div>

        {/* 文档正文 */}
        <div className="flex-1 overflow-y-auto px-8 py-6">
          {editMode ? (
            <textarea
              value={editText}
              onChange={e => setEditText(e.target.value)}
              className="w-full h-full min-h-[400px] text-sm text-gray-800 font-mono leading-relaxed border border-blue-200 rounded-lg px-4 py-3 focus:outline-none focus:border-blue-400 resize-none bg-blue-50/30"
              placeholder="输入 Markdown 内容..."
            />
          ) : docContent ? (
            <div className="text-sm text-gray-700 leading-relaxed max-w-2xl"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(docContent) }} />
          ) : (
            <p className="text-sm text-gray-400 italic">（文档为空）</p>
          )}
        </div>
      </div>

      {/* 右栏：聊天 */}
      <div className="w-96 flex flex-col bg-gray-50 flex-shrink-0">
        {/* 聊天头部 */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-200 bg-white flex-shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-700">Claude</span>
            <select value={model} onChange={e => setModel(e.target.value)}
              className="text-xs border border-gray-200 rounded px-1.5 py-0.5 bg-white focus:outline-none">
              {MODEL_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            {analyzeResult && (
              <span className="text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded">{analyzeResult}</span>
            )}
            <button
              onClick={runAnalyze}
              disabled={analyzing}
              className="flex items-center gap-1 text-xs px-2 py-1 bg-purple-500 text-white rounded hover:bg-purple-600 disabled:opacity-50"
              title="分析对话和文档，提取新的 Captures"
            >
              <Sparkles size={11} />
              {analyzing ? '分析中...' : 'Analyze'}
            </button>
          </div>
        </div>

        {/* 消息列表 */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          {messages.length === 0 && (
            <div className="text-center py-8 text-gray-400 text-xs">
              <p>和 Claude 讨论这份文档</p>
              <p className="mt-1">点 Analyze 可将讨论内容转为 Captures</p>
            </div>
          )}
          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                msg.role === 'user'
                  ? 'bg-blue-500 text-white rounded-br-sm'
                  : 'bg-white text-gray-800 border border-gray-200 rounded-bl-sm'
              }`}>
                <p style={{ whiteSpace: 'pre-wrap', lineHeight: '1.5' }}>{msg.content}</p>
              </div>
            </div>
          ))}
          {sending && (
            <div className="flex justify-start">
              <div className="bg-white border border-gray-200 rounded-2xl rounded-bl-sm px-3 py-2">
                <div className="flex gap-1 items-center h-4">
                  <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* 输入框 */}
        <div className="px-4 py-3 border-t border-gray-200 bg-white flex-shrink-0">
          <div className="flex gap-2 items-end">
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="输入消息（Enter 发送，Shift+Enter 换行）"
              rows={2}
              disabled={sending}
              className="flex-1 text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:border-blue-400 resize-none disabled:opacity-60"
              style={{ maxHeight: '120px' }}
            />
            <button onClick={sendMessage} disabled={!input.trim() || sending}
              className="flex-shrink-0 w-8 h-8 bg-blue-500 text-white rounded-full flex items-center justify-center hover:bg-blue-600 disabled:opacity-40">
              <Send size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
