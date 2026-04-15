/**
 * TopicsPoolPage — 主理人选题池管理
 *
 * 功能：
 * 1. 展示选题列表（支持状态过滤）
 * 2. 新增 / 编辑 / 删除 topic
 * 3. 节奏配置（daily_limit：每日最多触发几个 pipeline）
 * 4. 批量通过（多选 → 改 status='已通过'）
 *
 * API: /api/brain/topics/pool（CRUD）
 *      /api/brain/topics/rhythm（节奏配置）
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Plus, Pencil, Trash2, CheckCircle, Clock, RefreshCw, Loader2,
  Settings2, ListChecks, XCircle, BookmarkCheck,
} from 'lucide-react';

const BRAIN_API = '/api/brain';

// ─── 类型 ─────────────────────────────────────────────────────────────────────

interface Topic {
  id: string;
  title: string;
  angle: string | null;
  priority: number;
  status: string;
  target_platforms: string[];
  scheduled_date: string | null;
  pipeline_task_id: string | null;
  created_at: string;
  updated_at: string;
}

const STATUS_CONFIG: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
  draft: { label: '草稿', cls: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300', icon: <Clock className="w-3 h-3" /> },
  '已通过': { label: '已通过', cls: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300', icon: <CheckCircle className="w-3 h-3" /> },
  '已发布': { label: '已发布', cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300', icon: <BookmarkCheck className="w-3 h-3" /> },
  '已废弃': { label: '已废弃', cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300', icon: <XCircle className="w-3 h-3" /> },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? { label: status, cls: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300', icon: null };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.cls}`}>
      {cfg.icon}
      {cfg.label}
    </span>
  );
}

// ─── 新增/编辑弹窗 ────────────────────────────────────────────────────────────

interface TopicFormProps {
  initial?: Partial<Topic>;
  onSave: (data: Partial<Topic>) => Promise<void>;
  onCancel: () => void;
}

function TopicForm({ initial, onSave, onCancel }: TopicFormProps) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [angle, setAngle] = useState(initial?.angle ?? '');
  const [priority, setPriority] = useState(String(initial?.priority ?? 50));
  const [status, setStatus] = useState(initial?.status ?? 'draft');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleSave = async () => {
    if (!title.trim()) { setErr('标题不能为空'); return; }
    setSaving(true);
    setErr(null);
    try {
      await onSave({
        title: title.trim(),
        angle: angle.trim() || null,
        priority: parseInt(priority, 10) || 50,
        status,
      });
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
            {initial?.id ? '编辑选题' : '新增选题'}
          </h3>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
            <XCircle className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {err && <p className="text-sm text-red-600 dark:text-red-400">{err}</p>}

          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">标题 *</label>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="选题核心标题"
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">角度 / 切入点</label>
            <input
              value={angle}
              onChange={e => setAngle(e.target.value)}
              placeholder="可选：创作角度描述"
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">优先级 (0-100)</label>
              <input
                type="number"
                min="0"
                max="100"
                value={priority}
                onChange={e => setPriority(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">状态</label>
              <select
                value={status}
                onChange={e => setStatus(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 p-4 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400 text-white rounded-lg"
          >
            {saving && <Loader2 className="w-3 h-3 animate-spin" />}
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── 节奏配置 ─────────────────────────────────────────────────────────────────

function RhythmConfig() {
  const [dailyLimit, setDailyLimit] = useState<number | null>(null);
  const [editValue, setEditValue] = useState('');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(`${BRAIN_API}/topics/rhythm`)
      .then(r => r.json())
      .then(d => { setDailyLimit(d.daily_limit); setEditValue(String(d.daily_limit)); })
      .catch(() => {});
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`${BRAIN_API}/topics/rhythm`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ daily_limit: parseInt(editValue, 10) }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      setDailyLimit(d.daily_limit);
      setEditing(false);
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex items-center gap-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-4 py-3">
      <Settings2 className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0" />
      <span className="text-sm text-amber-800 dark:text-amber-200 font-medium">节奏配置：每日触发上限</span>
      {editing ? (
        <div className="flex items-center gap-2 ml-auto">
          <input
            type="number"
            min="0"
            max="50"
            value={editValue}
            onChange={e => setEditValue(e.target.value)}
            className="w-16 px-2 py-1 text-sm border border-amber-300 dark:border-amber-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
          />
          <button
            onClick={save}
            disabled={saving}
            className="text-xs font-medium text-emerald-600 dark:text-emerald-400 hover:underline"
          >
            {saving ? '保存中...' : '保存'}
          </button>
          <button onClick={() => setEditing(false)} className="text-xs text-gray-500 hover:underline">取消</button>
        </div>
      ) : (
        <div className="flex items-center gap-2 ml-auto">
          <span className="text-sm font-bold text-amber-700 dark:text-amber-300">
            {dailyLimit ?? '—'} 条/天
          </span>
          <button
            onClick={() => setEditing(true)}
            className="text-xs text-amber-600 dark:text-amber-400 hover:underline"
          >
            修改
          </button>
        </div>
      )}
    </div>
  );
}

// ─── 主组件 ───────────────────────────────────────────────────────────────────

export default function TopicsPoolPage() {
  const [topics, setTopics] = useState<Topic[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingTopic, setEditingTopic] = useState<Topic | null>(null);

  const loadTopics = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '50' });
      if (filterStatus) params.set('status', filterStatus);
      const res = await fetch(`${BRAIN_API}/topics/pool?${params}`);
      const d = await res.json();
      setTopics(d.topics ?? []);
      setTotal(d.total ?? 0);
    } catch {
      setTopics([]);
    } finally {
      setLoading(false);
    }
  }, [filterStatus]);

  useEffect(() => { loadTopics(); }, [loadTopics]);

  const createTopic = async (data: Partial<Topic>) => {
    const res = await fetch(`${BRAIN_API}/topics/pool`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error ?? '创建失败');
    setShowForm(false);
    loadTopics();
  };

  const updateTopic = async (id: string, data: Partial<Topic>) => {
    const res = await fetch(`${BRAIN_API}/topics/pool/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error ?? '更新失败');
    setEditingTopic(null);
    loadTopics();
  };

  const deleteTopic = async (id: string) => {
    if (!confirm('确认删除该选题？')) return;
    const res = await fetch(`${BRAIN_API}/topics/pool/${id}`, { method: 'DELETE' });
    if (!res.ok) { alert('删除失败'); return; }
    loadTopics();
  };

  const approveSelected = async (id: string) => {
    await updateTopic(id, { status: '已通过' });
  };

  return (
    <div className="space-y-4">
      {/* 节奏配置 */}
      <RhythmConfig />

      {/* 工具栏 */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
          <ListChecks className="w-4 h-4" />
          共 {total} 条选题
        </div>

        {/* 状态过滤 */}
        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
          className="px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-emerald-500"
        >
          <option value="">全部状态</option>
          {Object.entries(STATUS_CONFIG).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={loadTopics}
            className="p-2 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg"
          >
            <Plus className="w-4 h-4" />
            新增选题
          </button>
        </div>
      </div>

      {/* 列表 */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        </div>
      ) : topics.length === 0 ? (
        <div className="text-center py-12 text-gray-400 dark:text-gray-500">
          <ListChecks className="w-10 h-10 mx-auto mb-2 opacity-40" />
          <p className="text-sm">暂无选题，点击「新增选题」开始</p>
        </div>
      ) : (
        <div className="space-y-2">
          {topics.map(topic => (
            <div
              key={topic.id}
              className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4 flex items-start gap-3"
            >
              {/* 优先级 */}
              <div className="flex-shrink-0 w-10 h-10 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg flex items-center justify-center">
                <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">{topic.priority}</span>
              </div>

              {/* 内容 */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{topic.title}</span>
                  <StatusBadge status={topic.status} />
                  {topic.pipeline_task_id && (
                    <span className="text-xs text-blue-500 dark:text-blue-400">已关联 Pipeline</span>
                  )}
                </div>
                {topic.angle && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">{topic.angle}</p>
                )}
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                  {new Date(topic.created_at).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' })}
                </p>
              </div>

              {/* 操作 */}
              <div className="flex items-center gap-1 flex-shrink-0">
                {topic.status === 'draft' && (
                  <button
                    onClick={() => approveSelected(topic.id)}
                    title="通过"
                    className="p-1.5 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 rounded-lg"
                  >
                    <CheckCircle className="w-4 h-4" />
                  </button>
                )}
                <button
                  onClick={() => setEditingTopic(topic)}
                  title="编辑"
                  className="p-1.5 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
                >
                  <Pencil className="w-4 h-4" />
                </button>
                <button
                  onClick={() => deleteTopic(topic.id)}
                  title="删除"
                  className="p-1.5 text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 新增弹窗 */}
      {showForm && (
        <TopicForm
          onSave={createTopic}
          onCancel={() => setShowForm(false)}
        />
      )}

      {/* 编辑弹窗 */}
      {editingTopic && (
        <TopicForm
          initial={editingTopic}
          onSave={data => updateTopic(editingTopic.id, data)}
          onCancel={() => setEditingTopic(null)}
        />
      )}
    </div>
  );
}
