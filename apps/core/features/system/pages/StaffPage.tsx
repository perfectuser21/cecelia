import { useEffect, useState } from 'react';
import { Bot, Users, AlertCircle, Loader2 } from 'lucide-react';
import { fetchStaff, type Team } from '../api/staffApi';

function ModelBadge({ provider, name }: { provider: string | null; name: string | null }) {
  if (!provider || !name) {
    return (
      <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500">
        未配置
      </span>
    );
  }

  const providerColors: Record<string, string> = {
    anthropic: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400',
    minimax: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400',
    openai: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400',
  };

  const shortName = name
    .replace('claude-', '')
    .replace('-20250514', '')
    .replace('MiniMax-', '');

  return (
    <span
      className={`text-xs px-2 py-0.5 rounded-full font-medium ${
        providerColors[provider] || 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
      }`}
    >
      {shortName}
    </span>
  );
}

export default function StaffPage() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [totalWorkers, setTotalWorkers] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchStaff()
      .then(data => {
        setTeams(data.teams);
        setTotalWorkers(data.total_workers);
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="animate-spin text-gray-400" size={32} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 text-red-500 p-8">
        <AlertCircle size={20} />
        <span>{error}</span>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Users size={24} /> 员工配置
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">共 {totalWorkers} 名员工</p>
        </div>
      </div>

      {teams.map(team => (
        <div key={team.id}>
          <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2">
            <span>{team.name}</span>
            <span className="text-xs normal-case bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded-full">
              {team.workers.length} 人
            </span>
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {team.workers.map(worker => (
              <div
                key={worker.id}
                className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4 hover:shadow-md transition-shadow"
              >
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="font-semibold text-gray-900 dark:text-gray-100">
                      {worker.name}
                      {worker.alias && (
                        <span className="ml-2 text-sm text-gray-400">({worker.alias})</span>
                      )}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {worker.role}
                    </div>
                  </div>
                  <Bot size={18} className="text-gray-400 mt-0.5 shrink-0" />
                </div>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-3 line-clamp-2">
                  {worker.description}
                </p>
                <div className="flex items-center justify-between">
                  <ModelBadge provider={worker.model.provider} name={worker.model.name} />
                  {worker.skill && (
                    <span className="text-xs text-gray-400 font-mono">{worker.skill}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
