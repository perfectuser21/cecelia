/**
 * ChatDrawer — Collapsible bottom chat drawer
 *
 * Default: collapsed, showing only input bar.
 * Click expand to show chat history.
 * Preserves all chat features: text, voice, frontend commands.
 */

import { useRef, useEffect, useCallback, useState } from 'react';
import { Brain, Send, Phone, PhoneOff, Mic, Volume2, ChevronUp, ChevronDown } from 'lucide-react';
import { useCecelia } from '@/contexts/CeceliaContext';
import { useRealtimeVoice } from '@features/core/shared/hooks/useRealtimeVoice';

// ── Route aliases ────────────────────────────────────────

const ROUTE_ALIASES: Record<string, string> = {
  'okr': '/okr', '目标': '/okr',
  'projects': '/projects', '项目': '/projects',
  'tasks': '/work/tasks', '任务': '/work/tasks',
  'work': '/work', '工作': '/work',
};

// ── Main Component ───────────────────────────────────────

export function ChatDrawer() {
  const {
    messages, addMessage, input, setInput, sending, setSending, generateId,
    currentRoute, frontendTools, executeFrontendTool, getPageContext,
  } = useCecelia();

  const feedRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [thinkingPhase, setThinkingPhase] = useState(0);

  // Auto-scroll when expanded
  useEffect(() => {
    if (expanded) {
      feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: 'smooth' });
    }
  }, [messages, expanded]);

  // Thinking animation
  useEffect(() => {
    if (!sending) { setThinkingPhase(0); return; }
    const t = setInterval(() => setThinkingPhase(p => (p + 1) % 3), 1500);
    return () => clearInterval(t);
  }, [sending]);

  // Auto-expand when sending
  useEffect(() => {
    if (sending) setExpanded(true);
  }, [sending]);

  // ── Chat send ──────────────────────────────────────────

  const handleSend = useCallback(async (overrideText?: string) => {
    const text = overrideText ?? input.trim();
    if (!text || sending) return;
    if (!overrideText) setInput('');
    setSending(true);
    setExpanded(true);
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

  // ── Voice ──────────────────────────────────────────────

  const realtime = useRealtimeVoice({
    onUserSpeech: useCallback((text: string) => { if (text.trim()) handleSend(text.trim()); }, [handleSend]),
  });

  // ── Render ─────────────────────────────────────────────

  return (
    <div style={{
      flexShrink: 0,
      borderTop: '1px solid rgba(255,255,255,0.06)',
      background: 'rgba(255,255,255,0.015)',
      display: 'flex', flexDirection: 'column',
      maxHeight: expanded ? '50vh' : undefined,
      transition: 'max-height 0.3s ease',
    }}>
      {/* Expanded chat history */}
      {expanded && (
        <div ref={feedRef} style={{
          flex: 1, overflowY: 'auto', padding: '12px 16px',
          minHeight: 120, maxHeight: '40vh',
        }}>
          <div style={{ maxWidth: 680, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {messages.length === 0 && !sending && (
              <div style={{ padding: '12px 0', textAlign: 'center', color: 'rgba(255,255,255,0.1)', fontSize: 11 }}>
                暂无对话
              </div>
            )}

            {messages.map(msg => <ChatBubble key={msg.id} msg={msg} />)}

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
        </div>
      )}

      {/* Input bar */}
      <div style={{
        padding: '8px 16px',
        display: 'flex', alignItems: 'center',
        borderTop: expanded ? '1px solid rgba(255,255,255,0.04)' : undefined,
      }}>
        <div style={{ maxWidth: 680, margin: '0 auto', width: '100%', display: 'flex', gap: 6, alignItems: 'center' }}>
          {/* Voice button */}
          <button
            onClick={realtime.isConnected ? realtime.disconnect : realtime.connect}
            style={{
              padding: 6, borderRadius: 6, border: 'none', cursor: 'pointer', flexShrink: 0,
              background: realtime.isConnected ? 'rgba(239,68,68,0.55)' : 'rgba(255,255,255,0.04)',
              color: realtime.isConnected ? '#fff' : 'rgba(255,255,255,0.25)',
            }}
          >
            {realtime.isConnected ? <PhoneOff size={12} /> : <Phone size={12} />}
          </button>

          {/* Voice indicators */}
          {realtime.isConnected && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
              <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#10b981', animation: 'pulse 1s infinite' }} />
              {realtime.isRecording && <Mic size={10} style={{ color: '#10b981' }} />}
              {realtime.isPlaying && <Volume2 size={10} style={{ color: '#10b981' }} />}
            </div>
          )}

          {/* Input */}
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
            onFocus={() => { if (messages.length > 0) setExpanded(true); }}
            placeholder="跟 Cecelia 说..."
            disabled={realtime.isConnected || sending}
            style={{
              flex: 1, padding: '7px 12px', borderRadius: 8,
              background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)',
              color: '#e2e8f0', fontSize: 12, outline: 'none',
              opacity: (realtime.isConnected || sending) ? 0.4 : 1,
            }}
          />

          {/* Send */}
          <button
            onClick={() => handleSend()}
            disabled={!input.trim() || sending || realtime.isConnected}
            style={{
              padding: 6, borderRadius: 6, border: 'none', cursor: 'pointer', flexShrink: 0,
              background: input.trim() && !sending && !realtime.isConnected ? 'rgba(110,40,220,0.8)' : 'rgba(255,255,255,0.04)',
              color: input.trim() && !sending && !realtime.isConnected ? '#fff' : 'rgba(255,255,255,0.2)',
            }}
          >
            <Send size={12} />
          </button>

          {/* Expand/collapse toggle */}
          {messages.length > 0 && (
            <button
              onClick={() => setExpanded(!expanded)}
              style={{
                padding: 6, borderRadius: 6, border: 'none', cursor: 'pointer', flexShrink: 0,
                background: 'rgba(255,255,255,0.04)',
                color: 'rgba(255,255,255,0.25)',
              }}
            >
              {expanded ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
              {!expanded && messages.length > 0 && (
                <span style={{
                  position: 'absolute', top: -4, right: -4,
                  width: 14, height: 14, borderRadius: '50%',
                  background: '#a78bfa', color: '#fff',
                  fontSize: 8, fontWeight: 700,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {messages.length}
                </span>
              )}
            </button>
          )}
        </div>
      </div>

      {realtime.error && (
        <p style={{ fontSize: 9, color: '#f87171', textAlign: 'center', margin: '0 0 6px' }}>{realtime.error}</p>
      )}
    </div>
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
        maxWidth: '75%', borderRadius: isUser ? '12px 12px 4px 12px' : '12px 12px 12px 4px',
        fontSize: 12.5, lineHeight: 1.6, padding: '8px 12px', wordBreak: 'break-word',
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
