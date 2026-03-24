import { useEffect, useState } from 'react';
import { Scale, Clock } from 'lucide-react';

interface Decision {
  id: string;
  summary: string;
  rationale: string | null;
  decision_type: string | null;
  impact: string | null;
  created_at: string;
}

export default function DecisionRegistryPage() {
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/brain/decisions?limit=50')
      .then(r => r.json())
      .then(data => setDecisions(Array.isArray(data) ? data : []))
      .catch(() => setDecisions([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-8 text-gray-500">加载中...</div>;

  return (
    <div className="p-6 max-w-4xl">
      <h1 className="text-2xl font-bold mb-6 flex items-center gap-2">
        <Scale className="w-6 h-6" /> Decision Registry
      </h1>
      {decisions.length === 0 ? (
        <p className="text-gray-500">暂无决策记录</p>
      ) : (
        <ul className="space-y-4">
          {decisions.map(d => (
            <li key={d.id} className="border rounded-lg p-4 bg-white dark:bg-gray-800">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1">
                  {d.decision_type && (
                    <span className="text-xs bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300 px-2 py-0.5 rounded mb-1 inline-block">
                      {d.decision_type}
                    </span>
                  )}
                  <p className="font-medium text-gray-900 dark:text-white">{d.summary}</p>
                  {d.rationale && (
                    <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 line-clamp-2">{d.rationale}</p>
                  )}
                  {d.impact && (
                    <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">影响：{d.impact}</p>
                  )}
                </div>
                <span className="text-xs text-gray-400 whitespace-nowrap flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {new Date(d.created_at).toLocaleDateString('zh-CN')}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
