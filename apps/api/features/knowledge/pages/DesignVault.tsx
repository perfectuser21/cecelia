import { useState } from 'react';
import { FolderOpen, FileText, Plus, ChevronRight } from 'lucide-react';
import { useApi } from '../../shared/hooks/useApi';

interface DesignDoc {
  id: string;
  type: string;
  title: string;
  status: string;
  area?: string;
  tags?: string[];
  author: string;
  created_at: string;
  updated_at: string;
  content?: string;
}

const TYPE_LABELS: Record<string, string> = {
  research: '调研', architecture: '架构', proposal: '提案', analysis: '分析'
};
const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600',
  adopted: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-600',
  shelved: 'bg-yellow-100 text-yellow-700',
};
const STATUS_LABELS: Record<string, string> = {
  draft: '草稿', adopted: '已采纳', rejected: '已否决', shelved: '搁置'
};

function AnnotationBox({ entityId }: { entityId: string }) {
  const { data, refresh } = useApi<{ success: boolean; data: Array<{ id: string; content: string }> }>(
    `/api/brain/user-annotations?entity_type=design_doc&entity_id=${entityId}`,
    { staleTime: 15_000 }
  );
  const [text, setText] = useState('');

  async function add() {
    if (!text.trim()) return;
    await fetch('/api/brain/user-annotations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entity_type: 'design_doc', entity_id: entityId, content: text }),
    });
    setText('');
    refresh();
  }

  return (
    <div className="mt-3 pt-3 border-t border-gray-100">
      <p className="text-xs text-gray-400 mb-1">批注</p>
      {(data?.data || []).map(a => (
        <p key={a.id} className="text-xs bg-yellow-50 rounded px-2 py-1 mb-1 text-gray-700">{a.content}</p>
      ))}
      <div className="flex gap-1 mt-1">
        <input
          className="flex-1 text-xs border border-gray-200 rounded px-2 py-0.5 focus:outline-none"
          placeholder="添加批注..."
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && add()}
        />
        <button onClick={add} disabled={!text.trim()}
          className="text-xs px-2 py-0.5 bg-blue-500 text-white rounded disabled:opacity-40">
          <Plus size={10} />
        </button>
      </div>
    </div>
  );
}

function DetailPanel({ doc, onStatusChange, onClose }: {
  doc: DesignDoc;
  onStatusChange: (id: string, status: string) => void;
  onClose: () => void;
}) {
  const { data } = useApi<{ success: boolean; data: DesignDoc }>(
    `/api/brain/design-docs/${doc.id}`,
    { staleTime: 30_000 }
  );
  const full = data?.data || doc;

  async function changeStatus(newStatus: string) {
    await fetch(`/api/brain/design-docs/${doc.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    });
    onStatusChange(doc.id, newStatus);
  }

  return (
    <div className="flex-1 border-l border-gray-200 p-6 overflow-y-auto">
      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-xs px-2 py-0.5 rounded ${STATUS_COLORS[full.status] || 'bg-gray-100 text-gray-600'}`}>
              {STATUS_LABELS[full.status] || full.status}
            </span>
            <span className="text-xs text-gray-400">{TYPE_LABELS[full.type] || full.type}</span>
          </div>
          <h2 className="text-lg font-semibold text-gray-900">{full.title}</h2>
          <p className="text-xs text-gray-400 mt-1">
            {full.author} · {new Date(full.created_at).toLocaleDateString('zh-CN')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={full.status}
            onChange={e => changeStatus(e.target.value)}
            className="text-xs border border-gray-200 rounded px-2 py-1"
          >
            <option value="draft">草稿</option>
            <option value="adopted">采纳</option>
            <option value="rejected">否决</option>
            <option value="shelved">搁置</option>
          </select>
          <button onClick={onClose} className="text-xs text-gray-400 hover:text-gray-600 px-2">✕</button>
        </div>
      </div>
      <pre className="text-sm text-gray-700 whitespace-pre-wrap font-sans leading-relaxed">
        {full.content || '（无内容）'}
      </pre>
      <AnnotationBox entityId={doc.id} />
    </div>
  );
}

export default function DesignVault() {
  const [typeFilter, setTypeFilter] = useState('');
  const [selected, setSelected] = useState<DesignDoc | null>(null);

  const url = `/api/brain/design-docs?type=research,architecture,proposal,analysis${typeFilter ? `&type=${typeFilter}` : ''}&limit=50`;
  const { data, loading, refresh } = useApi<{ success: boolean; data: DesignDoc[] }>(url, { staleTime: 30_000 });

  const docs = data?.data || [];

  function handleStatusChange(id: string, status: string) {
    if (selected?.id === id) setSelected(prev => prev ? { ...prev, status } : null);
    refresh();
  }

  return (
    <div className="flex h-full">
      <div className={`${selected ? 'w-80' : 'flex-1'} flex-shrink-0 p-6 overflow-y-auto`}>
        <div className="flex items-center gap-3 mb-4">
          <FolderOpen size={20} className="text-orange-500" />
          <div>
            <h1 className="text-lg font-semibold text-gray-900">Design Vault</h1>
            <p className="text-xs text-gray-500">{docs.length} 份文档</p>
          </div>
        </div>

        <div className="flex gap-1 mb-4 flex-wrap">
          {(['', 'research', 'architecture', 'proposal', 'analysis'] as const).map(t => (
            <button key={t}
              onClick={() => setTypeFilter(t)}
              className={`text-xs px-2 py-0.5 rounded border ${
                typeFilter === t ? 'bg-orange-500 text-white border-orange-500' : 'border-gray-200 text-gray-600 hover:border-gray-400'
              }`}>
              {t ? TYPE_LABELS[t] : '全部'}
            </button>
          ))}
        </div>

        {loading && <p className="text-sm text-gray-400 text-center py-8">加载中...</p>}

        {!loading && docs.length === 0 && (
          <div className="text-center py-12 text-gray-400">
            <FileText size={36} className="mx-auto mb-2 opacity-30" />
            <p className="text-sm">暂无文档</p>
          </div>
        )}

        <div className="space-y-1.5">
          {docs.map(doc => (
            <button
              key={doc.id}
              onClick={() => setSelected(doc)}
              className={`w-full text-left p-3 rounded-lg border transition-colors ${
                selected?.id === doc.id
                  ? 'border-orange-300 bg-orange-50'
                  : 'border-gray-200 hover:border-gray-300 bg-white'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-800 truncate">{doc.title}</span>
                <ChevronRight size={14} className="text-gray-400 flex-shrink-0" />
              </div>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xs text-gray-400">{TYPE_LABELS[doc.type] || doc.type}</span>
                <span className={`text-xs px-1.5 rounded ${STATUS_COLORS[doc.status] || 'bg-gray-100 text-gray-500'}`}>
                  {STATUS_LABELS[doc.status] || doc.status}
                </span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {selected && (
        <DetailPanel
          doc={selected}
          onStatusChange={handleStatusChange}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
