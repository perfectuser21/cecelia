import { useEffect, useState } from 'react';
import { Puzzle, Bot, AlertCircle, Loader2, Tag } from 'lucide-react';
import { fetchSkillsRegistry, type SkillItem } from '../api/staffApi';

function SkillCard({ item }: { item: SkillItem }) {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between mb-2">
        <div className="font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-1.5">
          {item.type === 'agent' ? (
            <Bot size={15} className="text-purple-400" />
          ) : (
            <Puzzle size={15} className="text-blue-400" />
          )}
          {item.name || item.id}
        </div>
        <span className="text-xs text-gray-400 font-mono">v{item.version}</span>
      </div>
      {item.description && (
        <p className="text-sm text-gray-500 dark:text-gray-400 line-clamp-2">{item.description}</p>
      )}
      <div className="mt-3">
        <span className="text-xs font-mono text-gray-400">{item.id}</span>
      </div>
    </div>
  );
}

export default function SkillsRegistryPage() {
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [agents, setAgents] = useState<SkillItem[]>([]);
  const [tab, setTab] = useState<'skills' | 'agents'>('skills');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchSkillsRegistry()
      .then(data => {
        setSkills(data.skills);
        setAgents(data.agents);
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

  const items = tab === 'skills' ? skills : agents;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Tag size={24} /> 技能库
        </h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">
          {skills.length} 个 Skills · {agents.length} 个 Agents
        </p>
      </div>

      <div className="flex gap-2 border-b border-gray-200 dark:border-gray-700">
        {(['skills', 'agents'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t
                ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            {t === 'skills' ? `Skills (${skills.length})` : `Agents (${agents.length})`}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {items.map(item => (
          <SkillCard key={item.id} item={item} />
        ))}
      </div>
    </div>
  );
}
