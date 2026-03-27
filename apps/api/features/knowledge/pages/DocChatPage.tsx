// Route: /knowledge/doc-chat/:id — 文档+聊天分栏界面（Notion AI 风格）
import { useState, useRef, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Send, RefreshCw } from 'lucide-react';
import { useApi } from '../../shared/hooks/useApi';

interface DesignDoc {
  id: string;
  title: string;
  content: string;
  type: string;
  status: string;
  updated_at: string;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

const MODEL_OPTIONS = [
  { value: 'claude-haiku-4-5-20251001', label: 'Haiku（快）' },
  { value: 'claude-sonnet-4-6', label: 'Sonnet（均衡）' },
  { value: 'claude-opus-4-6', label: 'Opus（强）' },
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

export default function DocChatPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [model, setModel] = useState('claude-haiku-4-5-20251001');
  const [sending, setSending] = useState(false);
  const [docContent, setDocContent] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { data, loading } = useApi<{ success: boolean; data: DesignDoc }>(
    `/api/brain/design-docs/${id}`,
    { staleTime: 0 }
  );

  const doc = data?.data;

  // 初始化文档内容
  useEffect(() => {
    if (doc && docContent === null) {
      setDocContent(doc.content || '');
    }
  }, [doc, docContent]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function sendMessage() {
    if (!input.trim() || sending || !id) return;

    const userMsg: ChatMessage = { role: 'user', content: input.trim() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setSending(true);

    try {
      const resp = await fetch(`/api/brain/design-docs/${id}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMsg.content,
          history: messages,
          model,
        }),
      });

      const result = await resp.json();
      if (!result.success) throw new Error(result.error || '请求失败');

      const assistantMsg: ChatMessage = { role: 'assistant', content: result.reply };
      setMessages(prev => [...prev, assistantMsg]);

      if (result.updated_content) {
        setDocContent(result.updated_content);
      }
    } catch (err: any) {
      const errMsg: ChatMessage = {
        role: 'assistant',
        content: `⚠️ 错误：${err.message}`,
      };
      setMessages(prev => [...prev, errMsg]);
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-gray-400 text-sm">
        加载中...
      </div>
    );
  }

  if (!doc) {
    return (
      <div className="flex h-full items-center justify-center text-gray-400 text-sm">
        文档不存在
      </div>
    );
  }

  return (
    <div className="flex h-full" style={{ fontFamily: 'system-ui, sans-serif' }}>
      {/* 左栏：文档内容 */}
      <div className="flex-1 flex flex-col border-r border-gray-200 min-w-0">
        {/* 文档标题栏 */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-gray-200 bg-white flex-shrink-0">
          <button
            onClick={() => navigate('/knowledge/designs')}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <ArrowLeft size={16} />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-sm font-semibold text-gray-900 truncate">{doc.title}</h1>
            <p className="text-xs text-gray-400">
              {doc.type} · 更新于 {new Date(doc.updated_at).toLocaleDateString('zh-CN')}
            </p>
          </div>
          {docContent !== doc.content && (
            <span className="text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded flex items-center gap-1">
              <RefreshCw size={10} />
              已更新
            </span>
          )}
        </div>

        {/* 文档正文 */}
        <div className="flex-1 overflow-y-auto px-8 py-6">
          {docContent ? (
            <div
              className="text-sm text-gray-700 leading-relaxed max-w-2xl"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(docContent) }}
            />
          ) : (
            <p className="text-sm text-gray-400 italic">（文档为空）</p>
          )}
        </div>
      </div>

      {/* 右栏：聊天 */}
      <div className="w-96 flex flex-col bg-gray-50 flex-shrink-0">
        {/* 聊天头部 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-white flex-shrink-0">
          <span className="text-sm font-medium text-gray-700">与 Claude 讨论</span>
          <select
            value={model}
            onChange={e => setModel(e.target.value)}
            className="text-xs border border-gray-200 rounded px-2 py-1 bg-white focus:outline-none focus:border-blue-400"
          >
            {MODEL_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        {/* 消息列表 */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          {messages.length === 0 && (
            <div className="text-center py-8 text-gray-400 text-xs">
              <p>和 Claude 讨论这份文档</p>
              <p className="mt-1">Claude 可以帮你修改文档内容</p>
            </div>
          )}
          {messages.map((msg, i) => (
            <div
              key={i}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                  msg.role === 'user'
                    ? 'bg-blue-500 text-white rounded-br-sm'
                    : 'bg-white text-gray-800 border border-gray-200 rounded-bl-sm'
                }`}
              >
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
            <button
              onClick={sendMessage}
              disabled={!input.trim() || sending}
              className="flex-shrink-0 w-8 h-8 bg-blue-500 text-white rounded-full flex items-center justify-center hover:bg-blue-600 disabled:opacity-40 transition-colors"
            >
              <Send size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
