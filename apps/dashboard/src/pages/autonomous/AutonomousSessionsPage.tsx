import { useState, useEffect } from 'react';

interface SessionSteps {
  step_0_worktree: string;
  step_1_spec: string;
  step_2_code: string;
  step_3_integrate: string;
  step_4_ship: string;
}

interface Session {
  branch: string;
  autonomous_mode: boolean;
  harness_mode: boolean;
  owner_session: string;
  started: string;
  steps: SessionSteps;
  task_card_path: string;
  worktree_path: string;
  elapsed_seconds: number;
}

const STEP_LABELS = [
  { key: 'step_0_worktree', label: 'Worktree' },
  { key: 'step_1_spec', label: 'Spec' },
  { key: 'step_2_code', label: 'Code' },
  { key: 'step_3_integrate', label: 'Integrate' },
  { key: 'step_4_ship', label: 'Ship' },
] as const;

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

function SessionCard({ session }: { session: Session }) {
  const steps = STEP_LABELS.map((s) => ({
    ...s,
    status: session.steps[s.key as keyof SessionSteps] || 'pending',
  }));
  const currentIdx = steps.findIndex((s) => s.status !== 'done');
  const mode = session.autonomous_mode
    ? { icon: '\u{1F916}', label: 'AUTO', cls: 'bg-blue-500/20 text-blue-400' }
    : session.harness_mode
    ? { icon: '\u{1F3D7}', label: 'HARNESS', cls: 'bg-purple-500/20 text-purple-400' }
    : { icon: '\u{1F4CB}', label: 'STANDARD', cls: 'bg-gray-500/20 text-gray-400' };

  return (
    <div className="border rounded-lg p-4 bg-white dark:bg-gray-800 shadow-sm">
      <div className="flex justify-between items-start mb-3">
        <div className="font-mono font-bold text-lg">{session.branch}</div>
        <div className={`px-2 py-1 rounded text-xs font-semibold ${mode.cls}`}>
          {mode.icon} {mode.label}
        </div>
      </div>
      <div className="flex items-center gap-2 mb-3">
        {steps.map((s, i) => {
          const isCurrent = i === currentIdx;
          const isDone = s.status === 'done';
          const color = isDone
            ? 'bg-green-500 text-white'
            : isCurrent
            ? 'bg-blue-500 text-white animate-pulse'
            : 'bg-gray-300 text-gray-600';
          return (
            <div key={s.key} className="flex-1 flex flex-col items-center">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${color}`}>
                {isDone ? '\u2713' : i + 1}
              </div>
              <div className="text-xs mt-1 text-gray-600 dark:text-gray-400">{s.label}</div>
            </div>
          );
        })}
      </div>
      <div className="text-xs text-gray-500 dark:text-gray-400 flex justify-between">
        <span>Started: {session.started || 'unknown'}</span>
        <span>Elapsed: {formatElapsed(session.elapsed_seconds)}</span>
      </div>
    </div>
  );
}

export default function AutonomousSessionsPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    const fetchSessions = async () => {
      try {
        const res = await fetch('/api/brain/autonomous/sessions');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (mounted) {
          setSessions(data.sessions || []);
          setError(null);
          setLoading(false);
        }
      } catch (e: any) {
        if (mounted) {
          setError(e.message);
          setLoading(false);
        }
      }
    };
    fetchSessions();
    const interval = setInterval(fetchSessions, 5000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Autonomous Sessions</h1>
      {loading && <div className="text-gray-500">Loading...</div>}
      {error && <div className="text-red-500 mb-4">Error: {error}</div>}
      {!loading && sessions.length === 0 && (
        <div className="text-center p-12 border-2 border-dashed rounded-lg text-gray-500">
          {'\u65E0\u6D3B\u8DC3 session'}
        </div>
      )}
      <div className="grid gap-4">
        {sessions.map((s) => (
          <SessionCard key={s.worktree_path + s.branch} session={s} />
        ))}
      </div>
      <div className="mt-4 text-xs text-gray-400">{'\u6BCF 5 \u79D2\u81EA\u52A8\u5237\u65B0'}</div>
    </div>
  );
}
