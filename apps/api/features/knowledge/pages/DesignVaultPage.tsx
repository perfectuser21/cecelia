import { useEffect, useState } from 'react';
import { Layers, FileText } from 'lucide-react';

interface DesignDoc {
  id: string;
  title: string;
  doc_type: string;
  tags: string[];
  status: string;
  created_by: string;
  content_preview: string;
  updated_at: string;
}

const DOC_TYPE_COLORS: Record<string, string> = {
  architecture: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  design: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
  decision: 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300',
  spec: 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300',
  guide: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
};

export default function DesignVaultPage() {
  const [docs, setDocs] = useState<DesignDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    const params = filter !== 'all' ? `?doc_type=${filter}&status=active` : '?status=active';
    fetch(`/api/brain/design-docs${params}`)
      .then(r => r.json())
      .then(data => setDocs(Array.isArray(data) ? data : []))
      .catch(() => setDocs([]))
      .finally(() => setLoading(false));
  }, [filter]);

  return (
    <div className="p-6 max-w-4xl">
      <h1 className="text-2xl font-bold mb-4 flex items-center gap-2">
        <Layers className="w-6 h-6" /> Design Vault
      </h1>
      <div className="flex gap-2 mb-6 flex-wrap">
        {['all', 'architecture', 'design', 'decision', 'spec', 'guide'].map(t => (
          <button key={t} onClick={() => setFilter(t)}
            className={`px-3 py-1 rounded text-sm ${filter === t ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'}`}>
            {t}
          </button>
        ))}
      </div>
      {loading ? (
        <div className="text-gray-500">加载中...</div>
      ) : docs.length === 0 ? (
        <p className="text-gray-500">暂无设计文档</p>
      ) : (
        <ul className="space-y-4">
          {docs.map(d => (
            <li key={d.id} className="border rounded-lg p-4 bg-white dark:bg-gray-800">
              <div className="flex items-start gap-3">
                <FileText className="w-5 h-5 text-gray-400 mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className={`text-xs px-2 py-0.5 rounded ${DOC_TYPE_COLORS[d.doc_type] || DOC_TYPE_COLORS.guide}`}>
                      {d.doc_type}
                    </span>
                    {d.tags.map(t => (
                      <span key={t} className="text-xs bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded">{t}</span>
                    ))}
                  </div>
                  <p className="font-medium text-gray-900 dark:text-white">{d.title}</p>
                  {d.content_preview && (
                    <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 line-clamp-2">{d.content_preview}</p>
                  )}
                  <p className="text-xs text-gray-400 mt-2">
                    {new Date(d.updated_at).toLocaleDateString('zh-CN')} · {d.created_by}
                  </p>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
