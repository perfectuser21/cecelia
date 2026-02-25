/**
 * CommandPalette — Cmd+K 居中命令面板
 *
 * 替代底部 ChatDrawer，采用 Linear/Raycast 风格。
 * 按需弹出，关闭时零占用。
 * 保留全部聊天功能：文本、语音、前端命令路由。
 */

import { useRef, useEffect, useCallback, useState } from 'react';
import { Brain, Send, X, Sparkles } from 'lucide-react';
import { useCecelia } from '@/contexts/CeceliaContext';

// ── Route aliases ────────────────────────────────────────

const ROUTE_ALIASES: Record<string, string> = {
  'okr': '/okr', '目标': '/okr',
  'projects': '/projects', '项目': '/projects',
  'tasks': '/work/tasks', '任务': '/work/tasks',
  'work': '/work', '工作': '/work',
};

// ── Props ────────────────────────────────────────────────

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

// ── Main Component ───────────────────────────────────────

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const {
    messages, addMessage, input, setInput, sending, setSending, generateId,
    currentRoute, frontendTools, executeFrontendTool, getPageContext,
  } = useCecelia();

  const inputRef = useRef<HTMLInputElement>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const [thinkingPhase, setThinkingPhase] = useState(0);

  // Auto-focus input when opened
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (open && feedRef.current) {
      feedRef.current.scrollTo({ top: feedRef.current.scrollHeight, behavior: 'smooth' });
    }
  }, [messages, open]);

  // Thinking animation
  useEffect(() => {
    if (!sending) { setThinkingPhase(0); return; }
    const t = setInterval(() => setThinkingPhase(p => (p + 1) % 3), 1500);
    return () => clearInterval(t);
  }, [sending]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // ── Chat send ──────────────────────────────────────────

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput('');
    setSending(true);
    addMessage({ id: generateId(), role: 'user', content: text });

    try {
      const lower = text.toLowerCase();
      if (/打开|去|进入|切换|navigate|open|go/i.test(lower)) {
        for (const [alias, route] of Object.entries(ROUTE_ALIASES).sort((a, b) => b[0].length - a[0].length)) {
          if (lower.includes(alias)) {
            const result = await executeFrontendTool('navigate', { path: route });
            addMessage({ id: generateId(), role: 'assistant', content: result, toolCall: { name: 'navigate', result } });
            return;
          }
        }
      }

      const r = await fetch('/api/orchestrator/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          messages: messages.slice(-10).map(m => ({ role: m.role, content: m.content })),
          context: {
            currentRoute,
            pageContext: getPageContext(),
            availableTools: frontendTools.map(t => ({ name: t.name, description: t.description, parameters: t.parameters })),
          },
        }),
      });
      const data = await r.json();
      if (data.reply) addMessage({ id: generateId(), role: 'assistant', content: data.reply });
      else if (data.error) addMessage({ id: generateId(), role: 'assistant', content: `\u26a0\ufe0f ${data.error}` });
    } catch {
      addMessage({ id: generateId(), role: 'assistant', content: '\u53d1\u751f\u9519\u8bef\uff0c\u8bf7\u91cd\u8bd5' });
    } finally {
      setSending(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, sending, messages, currentRoute, frontendTools]);

  if (!open) return null;

  // ── Render ─────────────────────────────────────────────

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 10000,
          background: 'rgba(0,0,0,0.5)',
          backdropFilter: 'blur(4px)',
        }}
      />

      {/* Panel */}
      <div style={{
        position: 'fixed', zIndex: 10001,
        top: '15vh', left: '50%', transform: 'translateX(-50%)',
        width: 560, maxWidth: 'calc(100vw - 32px)',
        maxHeight: 420, display: 'flex', flexDirection: 'column',
        background: 'rgba(15,15,25,0.97)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 16,
        boxShadow: '0 24px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04)',
        overflow: 'hidden',
      }}>
        {/* Input bar */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '14px 16px',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
        }}>
          <Sparkles size={14} style={{ color: '#a78bfa', flexShrink: 0 }} />
          <input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
            placeholder="问 Cecelia 点什么..."
            disabled={sending}
            style={{
              flex: 1, padding: 0, border: 'none', outline: 'none',
              background: 'transparent', color: '#e2e8f0', fontSize: 14,
              opacity: sending ? 0.5 : 1,
            }}
          />
          {input.trim() && !sending && (
            <button
              onClick={handleSend}
              style={{
                padding: 5, borderRadius: 6, border: 'none', cursor: 'pointer',
                background: 'rgba(110,40,220,0.8)', color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              <Send size={12} />
            </button>
          )}
          <button
            onClick={onClose}
            style={{
              padding: 4, borderRadius: 6, border: 'none', cursor: 'pointer',
              background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.3)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <X size={12} />
          </button>
        </div>

        {/* Messages area */}
        {(messages.length > 0 || sending) && (
          <div ref={feedRef} style={{
            flex: 1, overflowY: 'auto', padding: '12px 16px',
            display: 'flex', flexDirection: 'column', gap: 8,
          }}>
            {messages.map(msg => (
              <ChatBubble key={msg.id} msg={msg} />
            ))}

            {/* Thinking */}
            {sending && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{
                  width: 22, height: 22, borderRadius: 6, flexShrink: 0,
                  background: 'rgba(167,139,250,0.08)', border: '1px solid rgba(167,139,250,0.12)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Brain size={10} style={{ color: 'rgba(167,139,250,0.5)' }} />
                </div>
                <div style={{
                  padding: '6px 10px', background: 'rgba(255,255,255,0.03)',
                  borderRadius: '10px 10px 10px 4px', border: '1px solid rgba(255,255,255,0.06)',
                  display: 'flex', alignItems: 'center', gap: 5,
                }}>
                  <div style={{ display: 'flex', gap: 3 }}>
                    {[0, 1, 2].map(i => (
                      <div key={i} style={{
                        width: 3, height: 3, borderRadius: '50%',
                        background: i === thinkingPhase ? '#a78bfa' : 'rgba(167,139,250,0.15)',
                        transition: 'background 0.4s',
                      }} />
                    ))}
                  </div>
                  <span style={{ fontSize: 9, color: 'rgba(167,139,250,0.4)' }}>
                    {['感知中', '思考中', '深思中'][thinkingPhase]}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Empty state */}
        {messages.length === 0 && !sending && (
          <div style={{
            padding: '20px 16px', textAlign: 'center',
            color: 'rgba(255,255,255,0.12)', fontSize: 12,
          }}>
            <div style={{ marginBottom: 6 }}>
              <kbd style={{
                padding: '2px 6px', borderRadius: 4, fontSize: 10,
                background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)',
                color: 'rgba(255,255,255,0.3)',
              }}>⌘K</kbd>
              {' '}随时唤起
            </div>
            <span>输入问题、命令或导航指令</span>
          </div>
        )}

        {/* Footer hint */}
        <div style={{
          padding: '6px 16px',
          borderTop: '1px solid rgba(255,255,255,0.04)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.15)' }}>
            Enter 发送 · Esc 关闭
          </span>
          <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.1)' }}>
            Cecelia
          </span>
        </div>
      </div>
    </>
  );
}

// ── Chat Bubble ──────────────────────────────────────────

function ChatBubble({ msg }: { msg: { id: string; role: string; content: string; toolCall?: { name: string } } }) {
  const isUser = msg.role === 'user';
  return (
    <div style={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start', alignItems: 'flex-end', gap: 6 }}>
      {!isUser && (
        <div style={{
          width: 22, height: 22, borderRadius: 6, flexShrink: 0,
          background: 'rgba(167,139,250,0.08)', border: '1px solid rgba(167,139,250,0.12)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Brain size={10} style={{ color: 'rgba(167,139,250,0.6)' }} />
        </div>
      )}
      <div style={{
        maxWidth: '80%', borderRadius: isUser ? '12px 12px 4px 12px' : '12px 12px 12px 4px',
        fontSize: 13, lineHeight: 1.6, padding: '8px 12px', wordBreak: 'break-word',
        ...(isUser
          ? { background: 'linear-gradient(135deg,#7c3aed,#6d28d9)', color: '#fff' }
          : { background: 'rgba(255,255,255,0.03)', color: '#c4ccdc', border: '1px solid rgba(255,255,255,0.06)' }
        ),
      }}>
        {msg.toolCall && <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', marginBottom: 3 }}>{'\u2192'} {msg.toolCall.name}</div>}
        <span style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</span>
      </div>
    </div>
  );
}
