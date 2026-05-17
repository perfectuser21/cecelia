/**
 * useBriefing — Fetch briefing data from Brain on mount
 */

import { useState, useEffect } from 'react';

export interface BriefingEvent {
  time: string;
  text: string;
}

export interface PendingDecision {
  desire_id: string;
  summary: string;
  suggestion: string;
  actions: string[];
}

export interface BriefingData {
  greeting: string;
  since_last_visit: {
    completed: number;
    failed: number;
    queued: number;
    events: BriefingEvent[];
  };
  pending_decisions: PendingDecision[];
  today_focus: {
    title: string;
    progress: number;
    remaining_initiatives: number;
  } | null;
  token_cost_usd: number;
  last_visit: string | null;
}

export function useBriefing() {
  const [data, setData] = useState<BriefingData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function fetchBriefing() {
      try {
        const res = await fetch('/api/brain/briefing');
        if (!res.ok) throw new Error('briefing fetch failed');
        const json = await res.json();
        if (!cancelled) setData(json);
      } catch {
        // Briefing is non-critical, fail silently
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchBriefing();
    return () => { cancelled = true; };
  }, []);

  return { data, loading };
}
