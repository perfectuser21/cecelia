import { useState } from 'react';
import { BookOpen, Plus } from 'lucide-react';
import { useApi } from '../../shared/hooks/useApi';

interface DiaryEntry {
  id: string;
  title: string;
  content: string;
  diary_date: string;
  author: string;
  created_at: string;
}

export default function DailyDiary() {
  const { data, loading } = useApi<{ success: boolean; data: DiaryEntry[] }>(
    '/api/brain/design-docs?type=diary&limit=30',
    { staleTime: 60_000 }
  );

  const entries = data?.data || [];
  const [selected, setSelected] = useState<DiaryEntry | null>(entries[0] || null);

  // 当数据加载完成且没有选中项时，自动选中第一条
  const displaySelected = selected || entries[0] || null;

  return (
    <div className="flex h-full">
      {/* 左侧日期列表 */}
      <div className="w-64 flex-shrink-0 border-r border-gray-200 p-4 overflow-y-auto">
        <div className="flex items-center gap-2 mb-4">
          <BookOpen size={18} className="text-teal-600" />
          <h1 className="text-base font-semibold text-gray-900">每日日报</h1>
        </div>

        {loading && <p className="text-sm text-gray-400 text-center py-4">加载中...</p>}

        {!loading && entries.length === 0 && (
          <div className="text-center py-8 text-gray-400">
            <BookOpen size={32} className="mx-auto mb-2 opacity-30" />
            <p className="text-xs">暂无日报</p>
            <p className="text-xs mt-1">每日 23:00 自动生成</p>
          </div>
        )}

        <div className="space-y-1">
          {entries.map(entry => (
            <button
              key={entry.id}
              onClick={() => setSelected(entry)}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                displaySelected?.id === entry.id
                  ? 'bg-teal-50 text-teal-700 font-medium'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              {entry.diary_date || new Date(entry.created_at).toLocaleDateString('zh-CN')}
            </button>
          ))}
        </div>
      </div>

      {/* 右侧日报内容 */}
      <div className="flex-1 p-6 overflow-y-auto">
        {!displaySelected ? (
          <div className="text-center py-16 text-gray-400">
            <BookOpen size={48} className="mx-auto mb-3 opacity-20" />
            <p>选择左侧日期查看日报</p>
          </div>
        ) : (
          <div>
            <div className="mb-4">
              <h2 className="text-xl font-semibold text-gray-900">{displaySelected.title}</h2>
              <p className="text-xs text-gray-400 mt-1">
                {displaySelected.author} · {new Date(displaySelected.created_at).toLocaleString('zh-CN')}
              </p>
            </div>
            <pre className="text-sm text-gray-700 whitespace-pre-wrap font-sans leading-relaxed">
              {displaySelected.content}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
