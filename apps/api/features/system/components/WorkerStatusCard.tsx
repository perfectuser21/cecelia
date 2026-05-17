import { useState, useEffect } from 'react';
import { Activity, CheckCircle, AlertTriangle } from 'lucide-react';

interface WorkerState {
  status: 'idle' | 'running';
  currentTask: {
    taskId: string;
    intent: string;
    startedAt: string;
  } | null;
  uptime: number;
  lastCrash: string | null;
}

export default function WorkerStatusCard() {
  const [worker, setWorker] = useState<WorkerState | null>(null);

  useEffect(() => {
    const fetchWorker = async () => {
      try {
        const res = await fetch('/api/quality/worker');
        if (res.ok) {
          setWorker(await res.json());
        }
      } catch (err) {
        console.error('Failed to fetch worker:', err);
      }
    };

    fetchWorker();
    const interval = setInterval(fetchWorker, 5000);
    return () => clearInterval(interval);
  }, []);

  const isIdle = worker?.status === 'idle';

  return (
    <div className={`${
      isIdle ? 'bg-slate-800' : 'bg-blue-900/30 border border-blue-700'
    } rounded-lg p-6 text-white`}>
      {isIdle ? (
        <CheckCircle className="w-8 h-8 mb-2 text-slate-400" />
      ) : (
        <Activity className="w-8 h-8 mb-2 text-blue-400 animate-pulse" />
      )}
      <p className="text-sm opacity-90">Worker Status</p>
      <p className="text-2xl font-bold mt-1">{worker?.status || 'unknown'}</p>
      {worker?.currentTask && (
        <p className="text-xs mt-2 text-blue-300">{worker.currentTask.intent}</p>
      )}
    </div>
  );
}
