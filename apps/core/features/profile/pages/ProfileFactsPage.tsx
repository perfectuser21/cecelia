/**
 * ProfileFactsPage — 记忆管理（表格视图）
 *
 * 以数据库表格样式展示 user_profile_facts，支持：
 * - 关键字实时搜索
 * - Category Tab 筛选
 * - 分页（每页 20 条）
 * - 添加 / 编辑 / 删除（Modal）
 * - 批量导入（文本粘贴 / 文件上传）
 *
 * API 端点（Core v1.88.1）:
 *   GET    /api/brain/profile/facts?category=xxx&limit=500&offset=0
 *   POST   /api/brain/profile/facts          {content, category}
 *   PUT    /api/brain/profile/facts/:id      {content, category}
 *   DELETE /api/brain/profile/facts/:id
 *   POST   /api/brain/profile/facts/import   {text}
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  BrainCircuit, Plus, Pencil, Trash2, Upload, Check, X,
  Loader2, RefreshCw, FileText, Search,
  ChevronLeft, ChevronRight, Square, CheckSquare,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

type Category =
  | 'preference' | 'behavior' | 'background' | 'goal'
  | 'relationship' | 'health' | 'other';

interface ProfileFact {
  id: string;
  content: string;
  category: Category;
  created_at: string;
  updated_at: string;
}

interface FactsResponse {
  facts: ProfileFact[];
  total: number;
  limit: number;
  offset: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const PAGE_SIZE = 20;

const CATEGORIES: { value: Category | 'all'; label: string; color: string }[] = [
  { value: 'all',          label: '全部',     color: 'bg-slate-500/20 text-slate-300 border-slate-500/30' },
  { value: 'preference',   label: '偏好',     color: 'bg-blue-500/20 text-blue-300 border-blue-500/30' },
  { value: 'behavior',     label: '行为',     color: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' },
  { value: 'background',   label: '背景',     color: 'bg-violet-500/20 text-violet-300 border-violet-500/30' },
  { value: 'goal',         label: '目标',     color: 'bg-amber-500/20 text-amber-300 border-amber-500/30' },
  { value: 'relationship', label: '关系',     color: 'bg-pink-500/20 text-pink-300 border-pink-500/30' },
  { value: 'health',       label: '健康',     color: 'bg-red-500/20 text-red-300 border-red-500/30' },
  { value: 'other',        label: '其他',     color: 'bg-slate-400/20 text-slate-400 border-slate-400/30' },
];

const CAT_MAP = Object.fromEntries(CATEGORIES.map(c => [c.value, c]));
const catLabel = (c: string) => CAT_MAP[c]?.label ?? c;
const catColor = (c: string) => CAT_MAP[c]?.color ?? CAT_MAP['other'].color;

// ─── API helpers ──────────────────────────────────────────────────────────────

const BASE = '/api/brain/profile/facts';

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ─── CategoryBadge ────────────────────────────────────────────────────────────

function CategoryBadge({ category }: { category: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${catColor(category)}`}>
      {catLabel(category)}
    </span>
  );
}

// ─── Edit/Add Modal ───────────────────────────────────────────────────────────

function FactModal({
  initial,
  onClose,
  onSave,
}: {
  initial?: ProfileFact | null;
  onClose: () => void;
  onSave: (data: { content: string; category: Category }) => Promise<void>;
}) {
  const [content, setContent] = useState(initial?.content ?? '');
  const [category, setCategory] = useState<Category>(initial?.category ?? 'other');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const textRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { textRef.current?.focus(); }, []);

  const handleSave = async () => {
    if (!content.trim()) { setError('内容不能为空'); return; }
    setSaving(true);
    setError('');
    try {
      await onSave({ content: content.trim(), category });
      onClose();
    } catch (e: any) {
      setError(e.message ?? '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-lg mx-4 bg-slate-900 border border-slate-700/60 rounded-2xl shadow-2xl p-6">
        <h3 className="text-base font-semibold text-slate-100 mb-4">
          {initial ? '编辑记忆' : '添加记忆'}
        </h3>
        <div className="flex flex-wrap gap-2 mb-4">
          {CATEGORIES.filter(c => c.value !== 'all').map(c => (
            <button
              key={c.value}
              onClick={() => setCategory(c.value as Category)}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-all ${
                category === c.value
                  ? `${c.color} opacity-100`
                  : 'border-slate-700 text-slate-500 hover:border-slate-500 hover:text-slate-300'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
        <textarea
          ref={textRef}
          value={content}
          onChange={e => setContent(e.target.value)}
          rows={4}
          className="w-full bg-slate-800/60 border border-slate-700/50 rounded-xl px-4 py-3 text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-slate-500 resize-none"
          placeholder="记录一条关于你的信息，例如：我偏好使用简体中文沟通..."
        />
        {error && <p className="mt-1.5 text-xs text-rose-400">{error}</p>}
        <div className="flex justify-end gap-2 mt-4">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-xl text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 text-sm rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-100 transition-colors disabled:opacity-50"
          >
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Import Panel ─────────────────────────────────────────────────────────────

function ImportPanel({ onImported }: { onImported: () => void }) {
  const [text, setText] = useState('');
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const doImport = async (rawText: string) => {
    if (!rawText.trim()) { setError('内容不能为空'); return; }
    setImporting(true);
    setError('');
    setResult(null);
    try {
      const res = await apiFetch<{ imported: number; facts: ProfileFact[] }>(
        `${BASE}/import`,
        { method: 'POST', body: JSON.stringify({ text: rawText }) }
      );
      setResult(`✅ 成功导入 ${res.imported} 条记忆`);
      setText('');
      onImported();
    } catch (e: any) {
      setError(e.message ?? '导入失败');
    } finally {
      setImporting(false);
    }
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const name = file.name.toLowerCase();
    const isTextFile = name.endsWith('.txt') || name.endsWith('.csv');

    if (!isTextFile) {
      setText(`[${file.name}] 无法直接读取此文件格式，请手动粘贴内容`);
      if (fileRef.current) fileRef.current.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const raw = reader.result as string;
      setText(raw.length > 0 ? raw : `[${file.name}] 文件内容为空`);
      if (fileRef.current) fileRef.current.value = '';
    };
    reader.onerror = () => {
      setError(`读取文件失败：${file.name}`);
      if (fileRef.current) fileRef.current.value = '';
    };
    reader.readAsText(file, 'utf-8');
  };

  return (
    <div className="space-y-3">
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        rows={5}
        className="w-full bg-slate-800/60 border border-slate-700/50 rounded-xl px-4 py-3 text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-slate-500 resize-none"
        placeholder="粘贴文字或上传文件，Cecelia 会自动拆解成记忆条目...&#10;例如：我叫徐啸，喜欢用简体中文沟通，目前在做 AI 创业项目..."
      />
      {error && <p className="text-xs text-rose-400">{error}</p>}
      {result && <p className="text-xs text-emerald-400">{result}</p>}
      <div className="flex items-center gap-2">
        <button
          onClick={() => fileRef.current?.click()}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-500 transition-colors"
        >
          <FileText className="w-3.5 h-3.5" />
          上传文件
        </button>
        <input ref={fileRef} type="file" accept=".txt,.csv" onChange={handleFile} className="hidden" />
        <span className="text-xs text-slate-500">支持 txt / CSV（PDF/Excel/Word 请手动粘贴）</span>
        <button
          onClick={() => doImport(text)}
          disabled={importing || !text.trim()}
          className="ml-auto flex items-center gap-2 px-4 py-1.5 text-sm rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-100 transition-colors disabled:opacity-50"
        >
          {importing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
          {importing ? '导入中…' : '开始导入'}
        </button>
      </div>
    </div>
  );
}

// ─── FactTableRow ─────────────────────────────────────────────────────────────

function FactTableRow({
  fact,
  isLast,
  isDeleting,
  selected,
  onToggleSelect,
  onEdit,
  onDeleteRequest,
  onDeleteConfirm,
  onDeleteCancel,
}: {
  fact: ProfileFact;
  isLast: boolean;
  isDeleting: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onEdit: () => void;
  onDeleteRequest: () => void;
  onDeleteConfirm: () => void;
  onDeleteCancel: () => void;
}) {
  const formatted = new Date(fact.created_at).toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });

  return (
    <div
      className={`group grid items-center px-4 py-2.5 gap-3 transition-colors ${
        selected ? 'bg-slate-700/30' : 'hover:bg-slate-800/40'
      } ${!isLast ? 'border-b border-slate-700/30' : ''}`}
      style={{ gridTemplateColumns: '20px 1fr 80px 90px 64px' }}
    >
      {/* Checkbox */}
      <button
        onClick={onToggleSelect}
        className="text-slate-500 hover:text-slate-300 transition-colors"
        title={selected ? '取消选择' : '选择'}
      >
        {selected
          ? <CheckSquare className="w-4 h-4 text-blue-400" />
          : <Square className="w-4 h-4" />}
      </button>

      {/* Content */}
      <p className="text-sm text-slate-200 truncate leading-relaxed" title={fact.content}>
        {fact.content}
      </p>

      {/* Category */}
      <div><CategoryBadge category={fact.category} /></div>

      {/* Date */}
      <span className="text-xs text-slate-500 tabular-nums">{formatted}</span>

      {/* Actions */}
      <div className="flex items-center justify-end gap-1">
        {isDeleting ? (
          <>
            <button
              onClick={onDeleteConfirm}
              className="p-1 rounded-md bg-rose-500/20 hover:bg-rose-500/40 text-rose-400 hover:text-rose-300 transition-colors"
              title="确认删除"
            >
              <Check className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={onDeleteCancel}
              className="p-1 rounded-md hover:bg-slate-700 text-slate-500 hover:text-slate-300 transition-colors"
              title="取消"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </>
        ) : (
          <>
            <button
              onClick={onEdit}
              className="p-1 rounded-md text-slate-500 hover:text-slate-300 hover:bg-slate-700 transition-colors opacity-0 group-hover:opacity-100"
              title="编辑"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={onDeleteRequest}
              className="p-1 rounded-md text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors opacity-0 group-hover:opacity-100"
              title="删除"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ProfileFactsPage() {
  const [allFacts, setAllFacts] = useState<ProfileFact[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fetchError, setFetchError] = useState('');

  const [category, setCategory] = useState<Category | 'all'>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);

  const [showAdd, setShowAdd] = useState(false);
  const [editFact, setEditFact] = useState<ProfileFact | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [showImport, setShowImport] = useState(false);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchDeleting, setBatchDeleting] = useState(false);

  // ── Fetch ──────────────────────────────────────────────────────────────────

  const fetchFacts = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    setFetchError('');
    try {
      const params = new URLSearchParams({ limit: '500', offset: '0' });
      if (category !== 'all') params.set('category', category);
      const data = await apiFetch<FactsResponse>(`${BASE}?${params}`);
      setAllFacts(data.facts);
      setTotal(data.total);
      setPage(0);
    } catch (e: any) {
      setFetchError(e.message ?? '加载失败');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [category]);

  useEffect(() => { fetchFacts(); }, [fetchFacts]);
  useEffect(() => { setPage(0); setSelectedIds(new Set()); }, [search]);
  useEffect(() => { setSelectedIds(new Set()); }, [category]);

  // ── Filter + paginate ──────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allFacts;
    return allFacts.filter(f => f.content.toLowerCase().includes(q));
  }, [allFacts, search]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const pageData = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const startIdx = filtered.length === 0 ? 0 : page * PAGE_SIZE + 1;
  const endIdx = Math.min((page + 1) * PAGE_SIZE, filtered.length);

  // ── CRUD ───────────────────────────────────────────────────────────────────

  const handleAdd = async (data: { content: string; category: Category }) => {
    await apiFetch<ProfileFact>(BASE, { method: 'POST', body: JSON.stringify(data) });
    await fetchFacts(true);
  };

  const handleEdit = async (data: { content: string; category: Category }) => {
    if (!editFact) return;
    await apiFetch<ProfileFact>(`${BASE}/${editFact.id}`, { method: 'PUT', body: JSON.stringify(data) });
    await fetchFacts(true);
  };

  const handleDelete = async (id: string) => {
    await apiFetch(`${BASE}/${id}`, { method: 'DELETE' });
    setAllFacts(prev => prev.filter(f => f.id !== id));
    setTotal(prev => prev - 1);
    setDeletingId(null);
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === pageData.length && pageData.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(pageData.map(f => f.id)));
    }
  };

  const handleBatchDelete = async () => {
    if (selectedIds.size === 0 || batchDeleting) return;
    setBatchDeleting(true);
    try {
      await apiFetch(`${BASE}/batch`, {
        method: 'DELETE',
        body: JSON.stringify({ ids: Array.from(selectedIds) }),
      });
      setSelectedIds(new Set());
      await fetchFacts(true);
    } finally {
      setBatchDeleting(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-slate-700/60 flex items-center justify-center shrink-0">
            <BrainCircuit className="w-[18px] h-[18px] text-slate-300" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-slate-100 leading-tight">记忆管理</h1>
            <p className="text-xs text-slate-500 mt-0.5">共 {total} 条 · pgvector 向量化存储</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => fetchFacts(true)}
            disabled={refreshing}
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-slate-800 transition-colors"
            title="刷新"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => setShowImport(v => !v)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border transition-colors ${
              showImport
                ? 'bg-slate-700 border-slate-600 text-slate-200'
                : 'border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-600'
            }`}
          >
            <Upload className="w-3.5 h-3.5" />
            批量导入
          </button>
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-100 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            添加
          </button>
        </div>
      </div>

      {/* Import Panel */}
      {showImport && (
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
          <h2 className="text-xs font-medium text-slate-400 mb-3 flex items-center gap-1.5">
            <Upload className="w-3.5 h-3.5" /> 批量导入
          </h2>
          <ImportPanel onImported={() => fetchFacts(true)} />
        </div>
      )}

      {/* Toolbar: Category tabs + Search */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1 flex-wrap">
          {CATEGORIES.map(c => (
            <button
              key={c.value}
              onClick={() => setCategory(c.value as any)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all border ${
                category === c.value
                  ? c.color
                  : 'border-transparent text-slate-500 hover:text-slate-300 hover:bg-slate-800/60'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="搜索记忆..."
            className="w-48 pl-8 pr-7 py-1.5 text-xs bg-slate-800/60 border border-slate-700/50 rounded-lg text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-slate-500 transition-colors"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Batch delete bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 px-3 py-2 bg-slate-800/80 border border-slate-600/50 rounded-xl">
          <span className="text-xs text-slate-300">已选 {selectedIds.size} 条</span>
          <div className="flex-1" />
          <button
            onClick={() => setSelectedIds(new Set())}
            className="px-3 py-1.5 text-xs rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-700 transition-colors"
          >
            取消选择
          </button>
          <button
            onClick={handleBatchDelete}
            disabled={batchDeleting}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-400 hover:text-rose-300 border border-rose-500/30 transition-colors disabled:opacity-50"
          >
            {batchDeleting
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <Trash2 className="w-3.5 h-3.5" />}
            {batchDeleting ? '删除中…' : `批量删除 (${selectedIds.size})`}
          </button>
        </div>
      )}

      {/* Table */}
      <div className="rounded-xl border border-slate-700/50 overflow-hidden">
        {/* Table header */}
        <div
          className="grid bg-slate-800/60 border-b border-slate-700/50 px-4 py-2.5 gap-3 items-center"
          style={{ gridTemplateColumns: '20px 1fr 80px 90px 64px' }}
        >
          <button
            onClick={toggleSelectAll}
            className="text-slate-500 hover:text-slate-300 transition-colors"
            title={selectedIds.size === pageData.length && pageData.length > 0 ? '取消全选' : '全选当前页'}
          >
            {selectedIds.size === pageData.length && pageData.length > 0
              ? <CheckSquare className="w-4 h-4 text-blue-400" />
              : <Square className="w-4 h-4" />}
          </button>
          <span className="text-xs font-medium text-slate-400">内容</span>
          <span className="text-xs font-medium text-slate-400">分类</span>
          <span className="text-xs font-medium text-slate-400">时间</span>
          <span className="text-xs font-medium text-slate-400 text-right">操作</span>
        </div>

        {/* Rows */}
        {loading ? (
          <div className="flex items-center justify-center py-16 text-slate-500">
            <Loader2 className="w-4 h-4 animate-spin mr-2" />
            <span className="text-sm">加载中…</span>
          </div>
        ) : fetchError ? (
          <div className="py-12 text-center text-rose-400 text-sm">{fetchError}</div>
        ) : pageData.length === 0 ? (
          <div className="py-16 text-center">
            <BrainCircuit className="w-8 h-8 text-slate-600 mx-auto mb-2" />
            <p className="text-sm text-slate-500">
              {search
                ? `没有包含「${search}」的记忆`
                : category !== 'all'
                ? '当前分类暂无记忆'
                : '还没有任何记忆，点击「添加」开始记录'}
            </p>
          </div>
        ) : (
          pageData.map((fact, idx) => (
            <FactTableRow
              key={fact.id}
              fact={fact}
              isLast={idx === pageData.length - 1}
              isDeleting={deletingId === fact.id}
              selected={selectedIds.has(fact.id)}
              onToggleSelect={() => toggleSelect(fact.id)}
              onEdit={() => setEditFact(fact)}
              onDeleteRequest={() => setDeletingId(fact.id)}
              onDeleteConfirm={() => handleDelete(fact.id)}
              onDeleteCancel={() => setDeletingId(null)}
            />
          ))
        )}
      </div>

      {/* Pagination */}
      {!loading && filtered.length > 0 && (
        <div className="flex items-center justify-between px-1">
          <span className="text-xs text-slate-500">
            {(search || category !== 'all') && filtered.length !== total
              ? `筛选结果 ${filtered.length} 条（共 ${total} 条）`
              : `共 ${total} 条`}
            {filtered.length > 0 && `，显示 ${startIdx}–${endIdx}`}
          </span>
          {totalPages > 1 && (
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0}
                className="p-1 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-xs text-slate-400 px-2">{page + 1} / {totalPages}</span>
              <button
                onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="p-1 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      )}

      {/* Modals */}
      {showAdd && <FactModal onClose={() => setShowAdd(false)} onSave={handleAdd} />}
      {editFact && <FactModal initial={editFact} onClose={() => setEditFact(null)} onSave={handleEdit} />}
    </div>
  );
}
