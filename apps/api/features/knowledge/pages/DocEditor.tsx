/**
 * DocEditor — 文档+聊天分栏界面（Notion AI 风格）
 *
 * 左：markdown 文档预览/编辑
 * 右：Claude 聊天窗口 + 模型选择
 *
 * 路由：/docs/:id
 */

import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Edit3, Eye, Send, ChevronDown, ArrowLeft, Save, Loader2 } from 'lucide-react';

// ── 类型 ────────────────────────────────────────────────

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

interface DesignDoc {
  id: string;
  title: string;
  content: string;
  type: string;
  updated_at: string;
}

// ── 模型选项 ─────────────────────────────────────────────

const MODEL_OPTIONS = [
  { value: 'haiku', label: 'Haiku（快速）' },
  { value: 'sonnet', label: 'Sonnet（均衡）' },
  { value: 'opus', label: 'Opus（精准）' },
];

// ── Markdown 简单渲染 ────────────────────────────────────

function renderMarkdown(text: string): string {
  return text
    .replace(/^### (.+)$/gm, '<h3 class="text-base font-semibold mt-4 mb-1 text-gray-800 dark:text-gray-200">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="text-lg font-bold mt-5 mb-2 text-gray-900 dark:text-gray-100">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 class="text-xl font-bold mt-6 mb-3 text-gray-900 dark:text-gray-100">$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong class="font-semibold">$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code class="bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded text-sm font-mono">$1</code>')
    .replace(/^- (.+)$/gm, '<li class="ml-4 list-disc text-gray-700 dark:text-gray-300">$1</li>')
    .replace(/^(\d+)\. (.+)$/gm, '<li class="ml-4 list-decimal text-gray-700 dark:text-gray-300">$2</li>')
    .replace(/\n\n/g, '</p><p class="mb-3">')
    .replace(/\n/g, '<br/>');
}

// ── 主组件 ───────────────────────────────────────────────

export default function DocEditor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [doc, setDoc] = useState<DesignDoc | null>(null);
  const [docContent, setDocContent] = useState('');
  const [editMode, setEditMode] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [model, setModel] = useState('haiku');
  const [showModelMenu, setShowModelMenu] = useState(false);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 加载文档
  useEffect(() => {
    if (!id) return;
    setLoading(true);
    fetch(`/api/brain/design-docs/${id}`)
      .then(r => r.json())
      .then(data => {
        if (data.success && data.data) {
          setDoc(data.data);
          setDocContent(data.data.content || '');
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  // 自动滚动聊天区到底部
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // 保存文档
  async function saveDoc() {
    if (!id) return;
    setSaving(true);
    try {
      await fetch(`/api/brain/design-docs/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: docContent }),
      });
    } finally {
      setSaving(false);
      setEditMode(false);
    }
  }

  // 发送聊天消息
  async function handleSend() {
    const text = input.trim();
    if (!text || sending) return;

    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: text };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setSending(true);

    try {
      const r = await fetch('/api/brain/doc-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          messages: messages.slice(-10).map(m => ({ role: m.role, content: m.content })),
          docContent,
          docId: id,
          model,
        }),
      });
      const data = await r.json();

      if (data.success) {
        const assistantMsg: Message = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: data.reply,
        };
        setMessages(prev => [...prev, assistantMsg]);

        // 如果 Claude 更新了文档，立即反映在左侧
        if (data.docContent) {
          setDocContent(data.docContent);
        }
      } else {
        setMessages(prev => [...prev, {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: `错误：${data.error || '请求失败'}`,
        }]);
      }
    } catch {
      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: '发生错误，请重试',
      }]);
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
      </div>
    );
  }

  if (!doc && !loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <p className="text-gray-500 dark:text-gray-400">文档不存在</p>
        <button
          onClick={() => navigate('/docs/list')}
          className="text-blue-500 hover:underline flex items-center gap-1 text-sm"
        >
          <ArrowLeft size={14} /> 返回文档列表
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full overflow-hidden" data-testid="doc-editor">
      {/* ── 左侧：文档区 ── */}
      <div className="flex-1 flex flex-col border-r border-gray-200 dark:border-gray-700 overflow-hidden">
        {/* 文档标题栏 */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
          <button
            onClick={() => navigate('/docs/list')}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            <ArrowLeft size={16} />
          </button>
          <h1 className="flex-1 text-base font-semibold text-gray-800 dark:text-gray-200 truncate">
            {doc?.title || '无标题文档'}
          </h1>
          <div className="flex items-center gap-1">
            {editMode ? (
              <>
                <button
                  onClick={saveDoc}
                  disabled={saving}
                  className="flex items-center gap-1 px-2 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
                >
                  {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                  保存
                </button>
                <button
                  onClick={() => { setEditMode(false); setDocContent(doc?.content || ''); }}
                  className="px-2 py-1 text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400"
                >
                  取消
                </button>
              </>
            ) : (
              <button
                onClick={() => setEditMode(true)}
                className="flex items-center gap-1 px-2 py-1 text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                <Edit3 size={12} /> 编辑
              </button>
            )}
            <button
              onClick={() => setEditMode(false)}
              className={`px-2 py-1 text-xs rounded ${!editMode ? 'text-blue-600 bg-blue-50 dark:bg-blue-900/30' : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800'}`}
            >
              <Eye size={12} />
            </button>
          </div>
        </div>

        {/* 文档内容区 */}
        <div className="flex-1 overflow-auto p-6 bg-white dark:bg-gray-900" data-testid="doc-content">
          {editMode ? (
            <textarea
              ref={textareaRef}
              className="w-full h-full resize-none font-mono text-sm text-gray-800 dark:text-gray-200 bg-transparent outline-none leading-relaxed"
              value={docContent}
              onChange={e => setDocContent(e.target.value)}
              placeholder="开始输入文档内容（Markdown 格式）..."
            />
          ) : (
            <div
              className="prose prose-gray dark:prose-invert max-w-none text-gray-800 dark:text-gray-200 leading-relaxed"
              dangerouslySetInnerHTML={{ __html: docContent ? `<p class="mb-3">${renderMarkdown(docContent)}</p>` : '<p class="text-gray-400 dark:text-gray-600">空文档，点击右上角编辑或通过右侧对话让 AI 生成内容</p>' }}
            />
          )}
        </div>
      </div>

      {/* ── 右侧：聊天区 ── */}
      <div className="w-[400px] flex flex-col bg-gray-50 dark:bg-gray-900 overflow-hidden" data-testid="chat-panel">
        {/* 聊天标题栏 + 模型选择 */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
          <span className="flex-1 text-sm font-medium text-gray-700 dark:text-gray-300">AI 助手</span>
          {/* 模型选择器 */}
          <div className="relative" data-testid="model-selector">
            <button
              onClick={() => setShowModelMenu(!showModelMenu)}
              className="flex items-center gap-1 px-2 py-1 text-xs text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 rounded hover:bg-gray-200 dark:hover:bg-gray-600"
            >
              {MODEL_OPTIONS.find(m => m.value === model)?.label || 'Haiku'}
              <ChevronDown size={10} />
            </button>
            {showModelMenu && (
              <div className="absolute right-0 top-full mt-1 w-36 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded shadow-lg z-10">
                {MODEL_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => { setModel(opt.value); setShowModelMenu(false); }}
                    className={`w-full text-left px-3 py-2 text-xs hover:bg-gray-50 dark:hover:bg-gray-700 ${model === opt.value ? 'text-blue-600 font-medium' : 'text-gray-700 dark:text-gray-300'}`}
                    data-testid={`model-option-${opt.value}`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 聊天历史 */}
        <div className="flex-1 overflow-auto p-4 space-y-3" data-testid="chat-messages">
          {messages.length === 0 && (
            <div className="text-center text-xs text-gray-400 dark:text-gray-600 mt-8">
              <p>向 AI 提问或请求修改文档</p>
              <p className="mt-1">AI 可直接更新左侧文档内容</p>
            </div>
          )}
          {messages.map(msg => (
            <div
              key={msg.id}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[85%] px-3 py-2 rounded-lg text-sm leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-blue-500 text-white'
                    : 'bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 border border-gray-200 dark:border-gray-700'
                }`}
              >
                {msg.content}
              </div>
            </div>
          ))}
          {sending && (
            <div className="flex justify-start">
              <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 px-3 py-2 rounded-lg">
                <Loader2 size={14} className="animate-spin text-gray-400" />
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* 输入区 */}
        <div className="p-3 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
          <div className="flex gap-2 items-end">
            <textarea
              className="flex-1 resize-none text-sm border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-400 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200 placeholder-gray-400"
              placeholder="输入消息（Shift+Enter 换行）"
              rows={2}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              data-testid="chat-input"
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || sending}
              className="p-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-40 shrink-0"
              data-testid="chat-send"
            >
              <Send size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
