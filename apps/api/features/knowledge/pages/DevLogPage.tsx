import { useEffect, useState } from 'react';
import { GitPullRequest, Calendar, Tag } from 'lucide-react';

interface DevRecord {
  id: string;
  title: string;
  pr_number: number | null;
  pr_url: string | null;
  branch: string | null;
  summary: string;
  record_type: string;
  area: string | null;
  components_affected: string[];
  created_at: string;
}

export default function DevLogPage() {
  const [records, setRecords] = useState<DevRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/brain/dev-records?limit=50')
      .then(r => r.json())
      .then(data => setRecords(Array.isArray(data) ? data : []))
      .catch(() => setRecords([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-8 text-gray-500">加载中...</div>;

  return (
    <div className="p-6 max-w-4xl">
      <h1 className="text-2xl font-bold mb-6 flex items-center gap-2">
        <GitPullRequest className="w-6 h-6" /> Dev Log
      </h1>
      {records.length === 0 ? (
        <p className="text-gray-500">暂无开发记录</p>
      ) : (
        <ul className="space-y-4">
          {records.map(r => (
            <li key={r.id} className="border rounded-lg p-4 bg-white dark:bg-gray-800">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    {r.pr_number && (
                      <a href={r.pr_url || '#'} target="_blank" rel="noreferrer"
                         className="text-xs bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded font-mono">
                        #{r.pr_number}
                      </a>
                    )}
                    <span className="text-xs text-gray-400">{r.record_type}</span>
                  </div>
                  <p className="font-medium text-gray-900 dark:text-white">{r.title}</p>
                  {r.summary && (
                    <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 line-clamp-2">{r.summary}</p>
                  )}
                  {r.components_affected.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {r.components_affected.slice(0, 5).map(c => (
                        <span key={c} className="text-xs bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded flex items-center gap-1">
                          <Tag className="w-3 h-3" />{c}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <span className="text-xs text-gray-400 whitespace-nowrap flex items-center gap-1">
                  <Calendar className="w-3 h-3" />
                  {new Date(r.created_at).toLocaleDateString('zh-CN')}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
