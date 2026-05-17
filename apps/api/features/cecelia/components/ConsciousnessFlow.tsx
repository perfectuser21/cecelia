/**
 * ConsciousnessFlow — The consciousness stream (chat + event cards mixed)
 *
 * Not just a chat window — it's Cecelia's stream of consciousness.
 * User messages, AI replies, briefing cards, and real-time events
 * all flow through this unified timeline.
 */

import { useRef, useEffect, useCallback, useState } from 'react';
import {
  Brain, Send, Phone, PhoneOff, Mic, Volume2,
  AlertTriangle, CheckCircle, Zap, MessageSquare, Loader2, ChevronUp,
} from 'lucide-react';
import { useCecelia } from '@/contexts/CeceliaContext';
import { useRealtimeVoice } from '@features/core/shared/hooks/useRealtimeVoice';
import { BriefingCard } from './cards/BriefingCard';
import { EventCard, type EventType } from './cards/EventCard';
import type { BriefingData } from '../hooks/useBriefing';

// ── Types ────────────────────────────────────────────────

interface FlowEvent {
  id: string;
  type: EventType;
  text: string;
  time: string;
  timestamp: number;
}

interface Desire {
  id: string;
  type: string;
  content: string;
  urgency: number;
  proposed_action?: string;
}

interface Task {
  id: string;
  title: string;
  task_type: string;
  priority: string;
}

interface ConsciousnessFlowProps {
  briefing: BriefingData | null;
  briefingLoading: boolean;
  events: FlowEvent[];
  desires: Desire[];
  queuedTasks: Task[];
  onAcknowledgeDesire: (ids: string[]) => void;
  onDispatchTask: (id: string) => void;
  loadingActions: Set<string>;
}

// ── Route aliases ────────────────────────────────────────

const ROUTE_ALIASES: Record<string, string> = {
  'okr': '/okr', '目标': '/okr',
  'projects': '/projects', '项目': '/projects',
  'tasks': '/work/tasks', '任务': '/work/tasks',
  'work': '/work', '工作': '/work',
};

const PRIORITY_COLOR: Record<string, string> = {
  P0: '#ef4444', P1: '#f59e0b', P2: '#3b82f6', P3: '#6b7280',
};

// ── Main Component ───────────────────────────────────────

export function ConsciousnessFlow({
  briefing,
  briefingLoading,
  events,
  desires,
  queuedTasks,
  onAcknowledgeDesire,
  onDispatchTask,
  loadingActions,
}: ConsciousnessFlowProps) {
  const {
    messages, addMessage, input, setInput, sending, setSending, generateId,
    currentRoute, frontendTools, executeFrontendTool, getPageContext,
  } = useCecelia();

  const feedRef = useRef<HTMLDivElement>(null);
  const [thinkingPhase, setThinkingPhase] = useState(0);
  const [showAllChat, setShowAllChat] = useState(false);

  // Auto-scroll
  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, events]);

  // Thinking animation
  useEffect(() => {
    if (!sending) { setThinkingPhase(0); return; }
    const t = setInterval(() => setThinkingPhase(p => (p + 1) % 3), 1500);
    return () => clearInterval(t);
  }, [sending]);

  // ── Chat send ──────────────────────────────────────────

  const handleSend = useCallback(async (overrideText?: string) => {
    const text = overrideText ?? input.trim();
    if (!text || sending) return;
    if (!overrideText) setInput('');
    setSending(true);
    addMessage({ id: generateId(), role: 'user', content: text });

    try {
      // Frontend navigation commands
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

      // Send to Brain
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

  // ── Render helpers ─────────────────────────────────────

  const askAboutDesire = useCallback((d: Desire) => {
    const summary = d.content.replace(/^#+\s*/gm, '').replace(/\*\*/g, '').trim();
    const first = summary.split('\n').find(l => l.trim().length > 10) || summary;
    const short = first.length > 80 ? first.slice(0, 80) + '...' : first;
    handleSend(`\u8fd9\u4ef6\u4e8b\u9700\u8981\u5904\u7406\uff0c\u8bf7\u5206\u6790\uff1a\u300c${short}\u300d`);
  }, [handleSend]);

  const askAboutTask = useCallback((task: Task) => {
    handleSend(`\u5173\u4e8e\u4efb\u52a1\u300c${task.title}\u300d\uff08${task.priority}/${task.task_type}\uff09\uff0c\u8bf7\u89e3\u91ca`);
  }, [handleSend]);

  const VISIBLE_COUNT = 6;
  const visibleMessages = showAllChat ? messages : messages.slice(-VISIBLE_COUNT);
  const hasHidden = messages.length > VISIBLE_COUNT && !showAllChat;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minWidth: 0 }}>
      {/* Feed area */}
      <div ref={feedRef} style={{ flex: 1, overflowY: 'auto', padding: '16px 16px 100px' }}>
        <div style={{ maxWidth: 680, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 10 }}>

          {/* Briefing card */}
          {briefing && <BriefingCard data={briefing} />}
          {briefingLoading && (
            <div style={{ padding: 20, textAlign: 'center' }}>
              <Loader2 size={16} style={{ color: '#a78bfa', animation: 'spin 1s linear infinite' }} />
            </div>
          )}

          {/* Decision desires (urgent) */}
          {desires.filter(d => d.urgency >= 7 || ['warn', 'question', 'propose'].includes(d.type)).map(d => {
            const summary = d.content.replace(/^#+\s*/gm, '').replace(/\*\*/g, '').trim();
            const firstLine = summary.split('\n').find(l => l.trim().length > 10) || summary;
            const display = firstLine.length > 140 ? firstLine.slice(0, 140) + '...' : firstLine;
            return (
              <div key={d.id} style={{
                background: 'rgba(239,68,68,0.04)',
                border: '1px solid rgba(239,68,68,0.12)',
                borderLeft: '3px solid #ef4444',
                borderRadius: 10, padding: '14px 18px',
              }}>
                <p style={{ margin: 0, fontSize: 13, color: 'rgba(255,255,255,0.7)', lineHeight: 1.6 }}>{display}</p>
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <button onClick={() => askAboutDesire(d)} style={btnStyle('rgba(239,68,68,0.12)', '#f87171')}>
                    <AlertTriangle size={11} />处理
                  </button>
                  <button onClick={() => onAcknowledgeDesire([d.id])} disabled={loadingActions.has(d.id)} style={btnStyle('rgba(255,255,255,0.06)', 'rgba(255,255,255,0.4)')}>
                    {loadingActions.has(d.id) ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> : <CheckCircle size={11} />}了解
                  </button>
                </div>
              </div>
            );
          })}

          {/* Queued tasks */}
          {queuedTasks.length > 0 && (
            <div>
              <span style={{ fontSize: 10, fontWeight: 700, color: 'rgba(245,158,11,0.5)', letterSpacing: '0.08em', marginBottom: 6, display: 'block' }}>
                等待确认 ({queuedTasks.length})
              </span>
              {queuedTasks.slice(0, 4).map(t => (
                <div key={t.id} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 14px', marginBottom: 4,
                  background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: 8,
                }}>
                  <span style={{
                    fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3,
                    background: `${PRIORITY_COLOR[t.priority] ?? '#6b7280'}15`,
                    color: PRIORITY_COLOR[t.priority] ?? '#6b7280',
                  }}>{t.priority}</span>
                  <span style={{ flex: 1, fontSize: 12.5, color: '#cbd5e1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {t.title}
                  </span>
                  <button onClick={() => onDispatchTask(t.id)} disabled={loadingActions.has(t.id)} style={btnStyle('rgba(34,197,94,0.1)', '#4ade80')}>
                    {loadingActions.has(t.id) ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> : <Zap size={11} />}
                  </button>
                  <button onClick={() => askAboutTask(t)} style={btnStyle('rgba(255,255,255,0.04)', 'rgba(255,255,255,0.3)')}>
                    <MessageSquare size={10} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Real-time events */}
          {events.map(ev => (
            <EventCard key={ev.id} type={ev.type} text={ev.text} time={ev.time} />
          ))}

          {/* Chat messages */}
          {messages.length > 0 && (
            <>
              {hasHidden && (
                <button
                  onClick={() => setShowAllChat(true)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0', color: 'rgba(167,139,250,0.4)', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}
                >
                  <ChevronUp size={12} />显示更多 ({messages.length - VISIBLE_COUNT} 条)
                </button>
              )}
              {visibleMessages.map(msg => (
                <ChatBubble key={msg.id} msg={msg} />
              ))}
            </>
          )}

          {/* Thinking */}
          {sending && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 24, height: 24, borderRadius: 7, flexShrink: 0, background: 'rgba(167,139,250,0.08)', border: '1px solid rgba(167,139,250,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Brain size={11} style={{ color: 'rgba(167,139,250,0.5)' }} />
              </div>
              <div style={{ padding: '7px 12px', background: 'rgba(255,255,255,0.03)', borderRadius: '12px 12px 12px 4px', border: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ display: 'flex', gap: 3 }}>
                  {[0, 1, 2].map(i => <div key={i} style={{ width: 4, height: 4, borderRadius: '50%', background: i === thinkingPhase ? '#a78bfa' : 'rgba(167,139,250,0.15)', transition: 'background 0.4s' }} />)}
                </div>
                <span style={{ fontSize: 10, color: 'rgba(167,139,250,0.4)' }}>{['感知中', '思考中', '深思中'][thinkingPhase]}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Input area */}
      <div style={{
        flexShrink: 0,
        borderTop: '1px solid rgba(255,255,255,0.06)',
        background: 'rgba(255,255,255,0.01)',
        padding: '10px 16px',
      }}>
        <div style={{ maxWidth: 680, margin: '0 auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            onClick={realtime.isConnected ? realtime.disconnect : realtime.connect}
            style={{
              padding: 7, borderRadius: 7, border: 'none', cursor: 'pointer', flexShrink: 0,
              background: realtime.isConnected ? 'rgba(239,68,68,0.55)' : 'rgba(255,255,255,0.04)',
              color: realtime.isConnected ? '#fff' : 'rgba(255,255,255,0.3)',
            }}
          >
            {realtime.isConnected ? <PhoneOff size={13} /> : <Phone size={13} />}
          </button>
          {realtime.isConnected && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
              <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#10b981', animation: 'pulse 1s infinite' }} />
              {realtime.isRecording && <Mic size={10} style={{ color: '#10b981' }} />}
              {realtime.isPlaying && <Volume2 size={10} style={{ color: '#10b981' }} />}
            </div>
          )}
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
            placeholder="跟 Cecelia 说..."
            disabled={realtime.isConnected || sending}
            style={{
              flex: 1, padding: '9px 14px', borderRadius: 9,
              background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)',
              color: '#e2e8f0', fontSize: 13, outline: 'none',
              opacity: (realtime.isConnected || sending) ? 0.4 : 1,
            }}
          />
          <button
            onClick={() => handleSend()}
            disabled={!input.trim() || sending || realtime.isConnected}
            style={{
              padding: 7, borderRadius: 7, border: 'none', cursor: 'pointer', flexShrink: 0,
              background: input.trim() && !sending && !realtime.isConnected ? 'rgba(110,40,220,0.8)' : 'rgba(255,255,255,0.04)',
              color: input.trim() && !sending && !realtime.isConnected ? '#fff' : 'rgba(255,255,255,0.2)',
            }}
          >
            <Send size={13} />
          </button>
        </div>
        {realtime.error && <p style={{ fontSize: 10, color: '#f87171', textAlign: 'center', margin: '4px 0 0' }}>{realtime.error}</p>}
      </div>
    </div>
  );
}

// ── Chat Bubble ──────────────────────────────────────────

function ChatBubble({ msg }: { msg: { id: string; role: string; content: string; toolCall?: { name: string } } }) {
  const isUser = msg.role === 'user';
  return (
    <div style={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start', alignItems: 'flex-end', gap: 8 }}>
      {!isUser && (
        <div style={{
          width: 24, height: 24, borderRadius: 7, flexShrink: 0,
          background: 'rgba(167,139,250,0.08)', border: '1px solid rgba(167,139,250,0.12)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Brain size={11} style={{ color: 'rgba(167,139,250,0.6)' }} />
        </div>
      )}
      <div style={{
        maxWidth: '75%', borderRadius: isUser ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
        fontSize: 13.5, lineHeight: 1.65, padding: '10px 14px', wordBreak: 'break-word',
        ...(isUser
          ? { background: 'linear-gradient(135deg,#7c3aed,#6d28d9)', color: '#fff' }
          : { background: 'rgba(255,255,255,0.03)', color: '#c4ccdc', border: '1px solid rgba(255,255,255,0.06)' }
        ),
      }}>
        {msg.toolCall && <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginBottom: 4 }}>{'\u2192'} {msg.toolCall.name}</div>}
        <span style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</span>
      </div>
    </div>
  );
}

function btnStyle(bg: string, color: string): React.CSSProperties {
  return {
    padding: '5px 10px', borderRadius: 6, border: 'none', cursor: 'pointer',
    background: bg, color, fontSize: 11, fontWeight: 500,
    display: 'flex', alignItems: 'center', gap: 3, transition: 'all 0.15s',
  };
}
