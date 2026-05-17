import { useState } from 'react';
import { Scale, CheckCircle, Clock, Archive, Plus, X } from 'lucide-react';
import { useApi } from '../../shared/hooks/useApi';

interface Decision {
  id: string;
  category?: string;
  topic?: string;
  decision?: string;
  reason?: string;
  status: string;
  confidence?: number;
  executed_at?: string;
  created_at: string;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: typeof CheckCircle }> = {
  active:   { label: '活跃', color: 'text-green-600 bg-green-50 border-green-200', icon: Clock },
  executed: { label: '已执行', color: 'text-blue-600 bg-blue-50 border-blue-200', icon: CheckCircle },
  expired:  { label: '已过期', color: 'text-gray-500 bg-gray-50 border-gray-200', icon: Archive },
};

function AnnotationBox({ entityId }: { entityId: string }) {
  const { data, refresh } = useApi<{ success: boolean; data: Array<{ id: string; content: string; created_at: string }> }>(
    `/api/brain/user-annotations?entity_type=decision&entity_id=${entityId}`,
    { staleTime: 15_000 }
  );
  const [text, setText] = useState('');

  async function add() {
    if (!text.trim()) return;
    await fetch('/api/brain/user-annotations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entity_type: 'decision', entity_id: entityId, content: text }),
    });
    setText('');
    refresh();
  }

  const list = data?.data || [];
  return (
    <div className="mt-2 pt-2 border-t border-gray-100">
      {list.map(a => (
        <p key={a.id} className="text-xs text-gray-600 bg-yellow-50 rounded px-2 py-1 mb-1">
          {a.content}
        </p>
      ))}
      <div className="flex gap-1 mt-1">
        <input
          className="flex-1 text-xs border border-gray-200 rounded px-2 py-0.5 focus:outline-none focus:border-blue-300"
          placeholder="添加备注..."
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && add()}
        />
        <button onClick={add} disabled={!text.trim()}
          className="text-xs px-2 py-0.5 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-40">
          <Plus size={10} />
        </button>
      </div>
    </div>
  );
}

function DecisionCard({ d, onStatusChange }: { d: Decision; onStatusChange: () => void }) {
  const cfg = STATUS_CONFIG[d.status] || STATUS_CONFIG.active;
  const Icon = cfg.icon;

  async function changeStatus(newStatus: string) {
    await fetch(`/api/brain/strategic-decisions/${d.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    });
    onStatusChange();
  }

  return (
    <div className={`border rounded-lg p-3 ${d.status === 'expired' ? 'opacity-60' : ''}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-xs px-2 py-0.5 rounded border ${cfg.color} flex items-center gap-1`}>
              <Icon size={10} /> {cfg.label}
            </span>
            {d.category && (
              <span className="text-xs text-gray-400 bg-gray-100 px-1.5 rounded">{d.category}</span>
            )}
          </div>
          {d.topic && <p className="text-sm font-medium text-gray-800 mb-0.5">{d.topic}</p>}
          {d.decision && <p className="text-sm text-gray-700">{d.decision}</p>}
          {d.reason && <p className="text-xs text-gray-500 mt-1">原因：{d.reason}</p>}
          <p className="text-xs text-gray-400 mt-1">{new Date(d.created_at).toLocaleDateString('zh-CN')}</p>
          <AnnotationBox entityId={d.id} />
        </div>
        <select
          value={d.status}
          onChange={e => changeStatus(e.target.value)}
          className="text-xs border border-gray-200 rounded px-1.5 py-0.5 focus:outline-none"
        >
          <option value="active">活跃</option>
          <option value="executed">已执行</option>
          <option value="expired">已过期</option>
        </select>
      </div>
    </div>
  );
}

function NewDecisionModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({ topic: '', decision: '', reason: '', category: 'general' });
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!form.topic.trim() || !form.decision.trim()) return;
    setSaving(true);
    await fetch('/api/brain/strategic-decisions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    setSaving(false);
    onCreated();
    onClose();
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-gray-900">记录决策</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-gray-500 block mb-1">主题 *</label>
            <input className="w-full text-sm border border-gray-200 rounded px-3 py-1.5 focus:outline-none focus:border-blue-400"
              value={form.topic} onChange={e => setForm(f => ({ ...f, topic: e.target.value }))} placeholder="决策主题" />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">决策内容 *</label>
            <textarea rows={3} className="w-full text-sm border border-gray-200 rounded px-3 py-1.5 focus:outline-none focus:border-blue-400 resize-none"
              value={form.decision} onChange={e => setForm(f => ({ ...f, decision: e.target.value }))} placeholder="具体的决策内容" />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">原因</label>
            <textarea rows={2} className="w-full text-sm border border-gray-200 rounded px-3 py-1.5 focus:outline-none focus:border-blue-400 resize-none"
              value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} placeholder="决策背后的原因" />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">分类</label>
            <input className="w-full text-sm border border-gray-200 rounded px-3 py-1.5 focus:outline-none focus:border-blue-400"
              value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} placeholder="如 technical、product、strategy" />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="text-sm px-4 py-1.5 border border-gray-200 rounded hover:border-gray-400">取消</button>
          <button onClick={submit} disabled={saving || !form.topic.trim() || !form.decision.trim()}
            className="text-sm px-4 py-1.5 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-40">
            {saving ? '保存中...' : '记录'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function DecisionRegistry() {
  const [statusFilter, setStatusFilter] = useState('active');
  const [showModal, setShowModal] = useState(false);
  const { data, loading, refresh } = useApi<{ decisions?: Decision[]; data?: Decision[] }>(
    `/api/brain/strategic-decisions?status=${statusFilter}&limit=100`,
    { staleTime: 20_000 }
  );

  const decisions: Decision[] = (data?.decisions || data?.data || []) as Decision[];

  // 按 category 分组
  const grouped: Record<string, Decision[]> = {};
  for (const d of decisions) {
    const cat = d.category || '未分类';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(d);
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Scale size={24} className="text-blue-600" />
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Decision Registry</h1>
            <p className="text-sm text-gray-500">决策台账 · {decisions.length} 条</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowModal(true)}
            className="flex items-center gap-1 text-xs px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600">
            <Plus size={12} /> 记录决策
          </button>
          {(['active', 'executed', 'expired'] as const).map(s => (
            <button key={s}
              onClick={() => setStatusFilter(s)}
              className={`text-xs px-3 py-1 rounded border transition-colors ${
                statusFilter === s ? 'bg-blue-500 text-white border-blue-500' : 'border-gray-200 text-gray-600 hover:border-gray-400'
              }`}>
              {STATUS_CONFIG[s]?.label}
            </button>
          ))}
        </div>
      </div>

      {loading && <div className="text-center py-12 text-gray-400">加载中...</div>}

      {!loading && decisions.length === 0 && (
        <div className="text-center py-12 text-gray-400">
          <Scale size={40} className="mx-auto mb-3 opacity-30" />
          <p>暂无决策记录</p>
        </div>
      )}

      {showModal && <NewDecisionModal onClose={() => setShowModal(false)} onCreated={refresh} />}

      {Object.entries(grouped).map(([cat, items]) => (
        <div key={cat} className="mb-6">
          <h2 className="text-xs font-semibold text-gray-500 uppercase mb-2 px-1">{cat}</h2>
          <div className="space-y-2">
            {items.map(d => <DecisionCard key={d.id} d={d} onStatusChange={refresh} />)}
          </div>
        </div>
      ))}
    </div>
  );
}
