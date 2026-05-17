/**
 * useProposals - Proposal data hook with WebSocket + polling fallback
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useWebSocket } from '../../shared/hooks/useWebSocket';

export interface ProposalComment {
  role: 'system' | 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface ProposalOption {
  id: string;
  label: string;
  description?: string;
  action?: Record<string, unknown>;
}

export interface Proposal {
  id: string;
  action_type: string;
  params: Record<string, unknown>;
  context: Record<string, unknown>;
  status: 'pending_approval' | 'approved' | 'rejected' | 'expired' | 'selected';
  source?: string;
  comments?: ProposalComment[];
  options?: ProposalOption[];
  created_at: string;
  expires_at?: string;
  reviewed_by?: string;
  reviewed_at?: string;
}

export interface UseProposalsResult {
  proposals: Proposal[];
  pendingCount: number;
  loading: boolean;
  error: string | null;
  refresh: () => void;
  approve: (id: string) => Promise<void>;
  reject: (id: string, reason?: string) => Promise<void>;
  comment: (id: string, message: string) => Promise<ProposalComment | null>;
  selectOption: (id: string, optionId: string) => Promise<void>;
  wsConnected: boolean;
}

async function fetchProposals(): Promise<Proposal[]> {
  const res = await fetch('/api/brain/pending-actions');
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  const data = await res.json();
  return data.actions || [];
}

export function useProposals(): UseProposalsResult {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const loadProposals = useCallback(async () => {
    try {
      const data = await fetchProposals();
      if (!mountedRef.current) return;
      setProposals(data);
      setError(null);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : 'Failed to load proposals');
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  // WebSocket for real-time updates
  const wsUrl = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/api/brain/ws`;

  const { connected: wsConnected } = useWebSocket(wsUrl, {
    onMessage: (e) => {
      try {
        const { event, data } = JSON.parse(e.data);
        switch (event) {
          case 'proposal:created':
            setProposals(prev => [data, ...prev]);
            break;
          case 'proposal:comment':
            setProposals(prev => prev.map(p =>
              p.id === data.id
                ? { ...p, comments: [...(p.comments || []), data.comment] }
                : p
            ));
            break;
          case 'proposal:resolved':
            setProposals(prev => prev.filter(p => p.id !== data.id));
            break;
        }
      } catch {
        // Ignore non-JSON messages
      }
    },
  });

  // Initial load
  useEffect(() => {
    loadProposals();
    return () => { mountedRef.current = false; };
  }, [loadProposals]);

  // Fallback polling when WebSocket is disconnected
  useEffect(() => {
    if (wsConnected) return;
    const id = setInterval(loadProposals, 10000);
    return () => clearInterval(id);
  }, [wsConnected, loadProposals]);

  // Actions
  const approve = useCallback(async (id: string) => {
    const res = await fetch(`/api/brain/pending-actions/${id}/approve`, { method: 'POST' });
    if (!res.ok) throw new Error(`Approve failed: ${res.status}`);
    setProposals(prev => prev.filter(p => p.id !== id));
  }, []);

  const reject = useCallback(async (id: string, reason?: string) => {
    const res = await fetch(`/api/brain/pending-actions/${id}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    });
    if (!res.ok) throw new Error(`Reject failed: ${res.status}`);
    setProposals(prev => prev.filter(p => p.id !== id));
  }, []);

  const comment = useCallback(async (id: string, message: string): Promise<ProposalComment | null> => {
    const res = await fetch(`/api/brain/pending-actions/${id}/comment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });
    if (!res.ok) throw new Error(`Comment failed: ${res.status}`);
    const data = await res.json();
    const reply: ProposalComment = data.reply || { role: 'assistant', content: data.content || '', timestamp: new Date().toISOString() };
    setProposals(prev => prev.map(p =>
      p.id === id
        ? {
            ...p,
            comments: [
              ...(p.comments || []),
              { role: 'user' as const, content: message, timestamp: new Date().toISOString() },
              reply,
            ],
          }
        : p
    ));
    return reply;
  }, []);

  const selectOption = useCallback(async (id: string, optionId: string) => {
    const res = await fetch(`/api/brain/pending-actions/${id}/select`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ option_id: optionId }),
    });
    if (!res.ok) throw new Error(`Select failed: ${res.status}`);
    setProposals(prev => prev.filter(p => p.id !== id));
  }, []);

  return {
    proposals,
    pendingCount: proposals.filter(p => p.status === 'pending_approval').length,
    loading,
    error,
    refresh: loadProposals,
    approve,
    reject,
    comment,
    selectOption,
    wsConnected,
  };
}
