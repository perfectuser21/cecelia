import { useState, useEffect } from 'react';
import { Clock, AlertCircle } from 'lucide-react';

interface Task {
  taskId: string;
  source: string;
  intent: string;
  priority: string;
  createdAt: string;
  age: number;
}

export default function TaskQueuePanel() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchQueue = async () => {
      try {
        const res = await fetch('/api/quality/queue');
        if (res.ok) {
          setTasks(await res.json());
        }
      } catch (err) {
        console.error('Failed to fetch queue:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchQueue();
    const interval = setInterval(fetchQueue, 5000);
    return () => clearInterval(interval);
  }, []);

  const formatAge = (seconds: number) => {
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    return `${Math.floor(seconds / 3600)}h ago`;
  };

  const priorityColors = {
    P0: 'bg-red-900/30 border-red-700 text-red-300',
    P1: 'bg-yellow-900/30 border-yellow-700 text-yellow-300',
    P2: 'bg-blue-900/30 border-blue-700 text-blue-300',
  };

  if (loading) {
    return (
      <div className="bg-slate-800/50 rounded-lg border border-slate-700 p-6">
        <p className="text-slate-400">Loading queue...</p>
      </div>
    );
  }

  return (
    <div className="bg-slate-800/50 rounded-lg border border-slate-700 overflow-hidden">
      <div className="p-6 border-b border-slate-700 flex items-center justify-between">
        <h2 className="text-xl font-semibold text-white flex items-center gap-2">
          Task Queue
          <span className="text-sm text-slate-400">({tasks.length} pending)</span>
        </h2>
      </div>

      {tasks.length === 0 ? (
        <div className="p-8 text-center text-slate-400">
          No pending tasks
        </div>
      ) : (
        <div className="divide-y divide-slate-700/50">
          {tasks.map(task => (
            <div key={task.taskId} className="p-4 hover:bg-slate-700/30 transition">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <span className={`px-2 py-1 text-xs rounded border ${
                    priorityColors[task.priority as keyof typeof priorityColors] || priorityColors.P2
                  }`}>
                    {task.priority}
                  </span>
                  <span className="px-2 py-1 text-xs bg-blue-900/50 text-blue-300 rounded">
                    {task.intent}
                  </span>
                  <span className="text-sm text-slate-400">{task.source}</span>
                </div>
                <div className="flex items-center gap-2 text-sm text-slate-400">
                  <Clock className="w-4 h-4" />
                  {formatAge(task.age)}
                </div>
              </div>
              <div className="mt-2 text-xs text-slate-500 font-mono">
                {task.taskId.slice(0, 16)}...
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
