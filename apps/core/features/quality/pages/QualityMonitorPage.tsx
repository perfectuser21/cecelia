import { useState, useEffect } from 'react';
import { Activity, CheckCircle, XCircle, AlertTriangle } from 'lucide-react';
import RunDetailPanel from '../components/RunDetailPanel';
import TaskQueuePanel from '../components/TaskQueuePanel';
import WorkerStatusCard from '../components/WorkerStatusCard';
import QueueCard from '../components/QueueCard';

export default function QualityMonitorPage() {
  const [state, setState] = useState<any>(null);
  const [runs, setRuns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [stateRes, runsRes] = await Promise.all([
          fetch('/api/quality/state'),
          fetch('/api/quality/runs?limit=10')
        ]);
        setState(await stateRes.json());
        setRuns(await runsRes.json());
      } catch (err) {
        console.error('Failed to fetch:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
        <p className="text-slate-400">Loading...</p>
      </div>
    );
  }

  const healthColors = {
    green: 'bg-emerald-500',
    yellow: 'bg-yellow-500',
    red: 'bg-red-500'
  };

  const healthIcons = {
    green: CheckCircle,
    yellow: AlertTriangle,
    red: XCircle
  };

  const health = state?.derivedHealth || 'green';
  const HealthIcon = healthIcons[health as keyof typeof healthIcons];

  return (
    <div className="min-h-screen -m-8 -mt-8 p-8 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-3xl font-bold text-white flex items-center gap-3 mb-8">
          <Activity className="w-8 h-8 text-slate-400" />
          Cecelia Quality Monitor
        </h1>

        <div className="grid grid-cols-5 gap-6 mb-8">
          <div className={`${healthColors[health]} rounded-lg p-6 text-white`}>
            <HealthIcon className="w-8 h-8 mb-2" />
            <p className="text-sm opacity-90">System Health</p>
            <p className="text-2xl font-bold mt-1">{health}</p>
          </div>

          <WorkerStatusCard />
          <QueueCard />

          <div className="bg-emerald-900/30 border border-emerald-700 rounded-lg p-6 text-white">
            <p className="text-sm text-emerald-400">Succeeded</p>
            <p className="text-3xl font-bold mt-2 text-emerald-400">{state?.stats?.succeeded || 0}</p>
          </div>

          <div className="bg-red-900/30 border border-red-700 rounded-lg p-6 text-white">
            <p className="text-sm text-red-400">Failed</p>
            <p className="text-3xl font-bold mt-2 text-red-400">{state?.stats?.failed || 0}</p>
          </div>
        </div>

        <TaskQueuePanel />

        <div className="bg-slate-800/50 rounded-lg border border-slate-700 overflow-hidden mt-8">
          <div className="p-6 border-b border-slate-700">
            <h2 className="text-xl font-semibold text-white">Recent Runs</h2>
          </div>

          <table className="w-full">
            <thead className="bg-slate-900/50">
              <tr>
                <th className="px-6 py-3 text-left text-xs text-slate-400 uppercase">Run ID</th>
                <th className="px-6 py-3 text-left text-xs text-slate-400 uppercase">Intent</th>
                <th className="px-6 py-3 text-left text-xs text-slate-400 uppercase">Status</th>
                <th className="px-6 py-3 text-left text-xs text-slate-400 uppercase">Duration</th>
                <th className="px-6 py-3 text-left text-xs text-slate-400 uppercase">Completed</th>
                <th className="px-6 py-3 text-left text-xs text-slate-400 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/50">
              {runs.map(run => (
                <tr key={run.runId} className="hover:bg-slate-700/30">
                  <td className="px-6 py-4 text-sm font-mono text-slate-300">
                    {run.runId.slice(0, 8)}...
                  </td>
                  <td className="px-6 py-4">
                    <span className="px-2 py-1 text-xs bg-blue-900/50 text-blue-300 rounded">
                      {run.intent}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-1 text-xs rounded ${
                      run.status === 'completed'
                        ? 'bg-emerald-900/50 text-emerald-300'
                        : 'bg-red-900/50 text-red-300'
                    }`}>
                      {run.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-300">{run.duration}s</td>
                  <td className="px-6 py-4 text-sm text-slate-400">
                    {new Date(run.completedAt).toLocaleString()}
                  </td>
                  <td className="px-6 py-4">
                    <button
                      onClick={() => setSelectedRunId(run.runId)}
                      className="text-blue-400 hover:text-blue-300 text-sm"
                    >
                      View Details
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <RunDetailPanel runId={selectedRunId} onClose={() => setSelectedRunId(null)} />
    </div>
  );
}
