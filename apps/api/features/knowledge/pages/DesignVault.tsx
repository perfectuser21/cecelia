import { useState } from 'react';
import { FolderOpen, FileText, Plus, ChevronRight, X } from 'lucide-react';
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

function renderMarkdown(text: string): string {
  return text
    .replace(/^### (.+)$/gm, '<h3 style="font-size:0.95rem;font-weight:600;margin:1rem 0 0.25rem">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 style="font-size:1.1rem;font-weight:700;margin:1.25rem 0 0.5rem">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 style="font-size:1.25rem;font-weight:700;margin:1.5rem 0 0.5rem">$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^- (.+)$/gm, '<li style="margin-left:1.25rem;list-style-type:disc">$1</li>')
    .replace(/^(\d+)\. (.+)$/gm, '<li style="margin-left:1.25rem;list-style-type:decimal">$2</li>')
    .replace(/`(.+?)`/g, '<code style="background:#f3f4f6;padding:0.1em 0.3em;border-radius:3px;font-size:0.85em">$1</code>')
    .replace(/\n\n/g, '<br/><br/>')
    .replace(/\n/g, '<br/>');
}

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
      <div
        className="text-sm text-gray-700 leading-relaxed"
        dangerouslySetInnerHTML={{ __html: renderMarkdown(full.content || '（无内容）') }}
      />
      <AnnotationBox entityId={doc.id} />
    </div>
  );
}

function NewDocModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({ title: '', type: 'proposal', content: '', area: 'cecelia' });
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!form.title.trim() || !form.content.trim()) return;
    setSaving(true);
    await fetch('/api/brain/design-docs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, author: 'user' }),
    });
    setSaving(false);
    onCreated();
    onClose();
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold">新建文档</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-gray-500 block mb-1">标题 *</label>
            <input className="w-full text-sm border border-gray-200 rounded px-3 py-1.5 focus:outline-none focus:border-blue-400"
              value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="文档标题" />
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-xs text-gray-500 block mb-1">类型</label>
              <select className="w-full text-sm border border-gray-200 rounded px-3 py-1.5"
                value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
                <option value="proposal">提案</option>
                <option value="research">调研</option>
                <option value="architecture">架构</option>
                <option value="analysis">分析</option>
              </select>
            </div>
            <div className="flex-1">
              <label className="text-xs text-gray-500 block mb-1">领域</label>
              <input className="w-full text-sm border border-gray-200 rounded px-3 py-1.5 focus:outline-none"
                value={form.area} onChange={e => setForm(f => ({ ...f, area: e.target.value }))} placeholder="cecelia" />
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">内容 * (支持 Markdown)</label>
            <textarea rows={8} className="w-full text-sm border border-gray-200 rounded px-3 py-1.5 focus:outline-none focus:border-blue-400 resize-none font-mono"
              value={form.content} onChange={e => setForm(f => ({ ...f, content: e.target.value }))} placeholder={'# 标题\n\n正文内容...'} />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="text-sm px-4 py-1.5 border border-gray-200 rounded hover:border-gray-400">取消</button>
          <button onClick={submit} disabled={saving || !form.title.trim() || !form.content.trim()}
            className="text-sm px-4 py-1.5 bg-orange-500 text-white rounded hover:bg-orange-600 disabled:opacity-40">
            {saving ? '保存中...' : '创建'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function DesignVault() {
  const [typeFilter, setTypeFilter] = useState('');
  const [selected, setSelected] = useState<DesignDoc | null>(null);
  const [showModal, setShowModal] = useState(false);

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
          <div className="flex-1">
            <h1 className="text-lg font-semibold text-gray-900">Design Vault</h1>
            <p className="text-xs text-gray-500">{docs.length} 份文档</p>
          </div>
          <button onClick={() => setShowModal(true)}
            className="flex items-center gap-1 text-xs px-3 py-1.5 bg-orange-500 text-white rounded hover:bg-orange-600">
            <Plus size={12} /> 新建文档
          </button>
        </div>
        {showModal && <NewDocModal onClose={() => setShowModal(false)} onCreated={refresh} />}

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
