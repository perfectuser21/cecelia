import { useEffect, useState } from 'react';
import { BookOpen, ChevronDown, ChevronUp } from 'lucide-react';

interface Annotation {
  id: string;
  content: string;
  tags: string[];
  annotation_type: string;
  diary_date: string | null;
  created_at: string;
}

export default function DailyDiaryPage() {
  const [entries, setEntries] = useState<Annotation[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/brain/user-annotations?annotation_type=daily_diary&limit=30')
      .then(r => r.json())
      .then(data => setEntries(Array.isArray(data) ? data : []))
      .catch(() => setEntries([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-8 text-gray-500">加载中...</div>;

  return (
    <div className="p-6 max-w-3xl">
      <h1 className="text-2xl font-bold mb-6 flex items-center gap-2">
        <BookOpen className="w-6 h-6" /> Daily Diary
      </h1>
      {entries.length === 0 ? (
        <p className="text-gray-500">暂无日记记录（每日 Tick 自动生成）</p>
      ) : (
        <ul className="space-y-3">
          {entries.map(e => {
            const isOpen = expanded === e.id;
            const date = e.diary_date || e.created_at.slice(0, 10);
            const preview = e.content.slice(0, 100);
            return (
              <li key={e.id} className="border rounded-lg bg-white dark:bg-gray-800 overflow-hidden">
                <button className="w-full text-left p-4 flex items-center justify-between gap-2"
                  onClick={() => setExpanded(isOpen ? null : e.id)}>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-mono text-gray-500">{date}</span>
                    {!isOpen && (
                      <span className="text-sm text-gray-600 dark:text-gray-400 truncate max-w-xs">
                        {preview}{e.content.length > 100 ? '…' : ''}
                      </span>
                    )}
                  </div>
                  {isOpen ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                </button>
                {isOpen && (
                  <div className="px-4 pb-4 border-t pt-3">
                    <pre className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap font-sans">{e.content}</pre>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
