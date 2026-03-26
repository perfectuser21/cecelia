import React, { useState, useEffect, useCallback } from 'react';
import {
  CheckCircle2, X, RefreshCw, FileText, BookOpen,
  Rss, CheckSquare, Scale, Calendar, ChevronDown, ChevronUp,
} from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

interface CaptureAtom {
  id: string;
  capture_id: string;
  content: string;
  target_type: string;
  target_subtype: string | null;
  suggested_area_id: string | null;
  status: string;
  routed_to_table: string | null;
  routed_to_id: string | null;
  confidence: number | null;
  created_at: string;
  capture_content?: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const TARGET_TYPE_CONFIG: Record<string, { icon: React.ElementType; color: string; label: string }> = {
  notes:        { icon: FileText,    color: 'text-blue-500 bg-blue-50 dark:bg-blue-900/30',      label: '笔记' },
  knowledge:    { icon: BookOpen,    color: 'text-purple-500 bg-purple-50 dark:bg-purple-900/30', label: '知识' },
  content_seed: { icon: Rss,         color: 'text-orange-500 bg-orange-50 dark:bg-orange-900/30', label: '内容种子' },
  task:         { icon: CheckSquare, color: 'text-green-500 bg-green-50 dark:bg-green-900/30',   label: '任务' },
  decision:     { icon: Scale,       color: 'text-red-500 bg-red-50 dark:bg-red-900/30',         label: '决策' },
  event:        { icon: Calendar,    color: 'text-cyan-500 bg-cyan-50 dark:bg-cyan-900/30',      label: '事件' },
};

const SUBTYPES: Record<string, string[]> = {
  notes:     ['project_note', 'daily_diary', 'meeting_note', 'idea_note', 'reflection'],
  knowledge: ['operational', 'reference', 'domain', 'insight'],
};

const SUBTYPE_LABELS: Record<string, string> = {
  project_note: '项目笔记', daily_diary: '日记', meeting_note: '会议记录',
  idea_note: '想法', reflection: '反思',
  operational: '操作知识', reference: '参考资料', domain: '领域知识', insight: '洞察',
};

// ─── AtomCard ────────────────────────────────────────────────────────────────

function AtomCard({ atom, onAction }: {
  atom: CaptureAtom;
  onAction: (id: string, action: 'confirm' | 'dismiss', extra?: Record<string, string>) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [selectedType, setSelectedType] = useState(atom.target_type);
  const [selectedSubtype, setSelectedSubtype] = useState(atom.target_subtype || '');
  const [loading, setLoading] = useState(false);

  const typeConfig = TARGET_TYPE_CONFIG[selectedType] || TARGET_TYPE_CONFIG.notes;
  const Icon = typeConfig.icon;
  const subtypeOptions = SUBTYPES[selectedType] || [];
  const confidencePct = atom.confidence != null ? Math.round(atom.confidence * 100) : null;

  async function handleConfirm() {
    setLoading(true);
    try {
      await onAction(atom.id, 'confirm', {
        target_type: selectedType,
        ...(selectedSubtype ? { target_subtype: selectedSubtype } : {}),
      });
    } finally {
      setLoading(false);
    }
  }

  async function handleDismiss() {
    setLoading(true);
    try {
      await onAction(atom.id, 'dismiss');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
      {/* Header */}
      <div className="flex items-start gap-3 p-4">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${typeConfig.color}`}>
          <Icon className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-slate-800 dark:text-slate-100 leading-snug">{atom.content}</p>
          {atom.capture_content && atom.capture_content !== atom.content && (
            <button
              onClick={() => setExpanded(v => !v)}
              className="flex items-center gap-1 mt-1 text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
            >
              {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              原始记录
            </button>
          )}
          {expanded && (
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-900 rounded p-2 italic">
              {atom.capture_content}
            </p>
          )}
        </div>
        {confidencePct != null && (
          <span className="text-xs text-slate-400 flex-shrink-0">{confidencePct}%</span>
        )}
      </div>

      {/* Type selector */}
      <div className="px-4 pb-3 flex flex-wrap gap-2">
        {Object.entries(TARGET_TYPE_CONFIG).map(([type, cfg]) => {
          const TIcon = cfg.icon;
          return (
            <button
              key={type}
              onClick={() => { setSelectedType(type); setSelectedSubtype(''); }}
              className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium border transition-colors ${
                selectedType === type
                  ? `${cfg.color} border-current`
                  : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 border-transparent hover:border-slate-300'
              }`}
            >
              <TIcon className="w-3 h-3" />
              {cfg.label}
            </button>
          );
        })}
      </div>

      {/* Subtype selector */}
      {subtypeOptions.length > 0 && (
        <div className="px-4 pb-3 flex flex-wrap gap-1">
          {subtypeOptions.map(sub => (
            <button
              key={sub}
              onClick={() => setSelectedSubtype(sub === selectedSubtype ? '' : sub)}
              className={`px-2 py-0.5 rounded text-xs transition-colors ${
                selectedSubtype === sub
                  ? 'bg-slate-700 text-white dark:bg-slate-200 dark:text-slate-900'
                  : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600'
              }`}
            >
              {SUBTYPE_LABELS[sub] || sub}
            </button>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="px-4 pb-4 flex gap-2">
        <button
          onClick={handleConfirm}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
        >
          <CheckCircle2 className="w-4 h-4" />
          确认路由
        </button>
        <button
          onClick={handleDismiss}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 disabled:opacity-50 text-slate-600 dark:text-slate-300 rounded-lg text-sm font-medium transition-colors"
        >
          <X className="w-4 h-4" />
          忽略
        </button>
      </div>
    </div>
  );
}

// ─── CaptureReview (main export) ─────────────────────────────────────────────

export default function CaptureReview(): React.ReactElement {
  const [atoms, setAtoms] = useState<CaptureAtom[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/brain/capture-atoms?status=pending_review&limit=50');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setAtoms(Array.isArray(data) ? data : []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleAction = useCallback(async (
    id: string,
    action: 'confirm' | 'dismiss',
    extra?: Record<string, string>
  ) => {
    const res = await fetch(`/api/brain/capture-atoms/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...extra }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    setAtoms(prev => prev.filter(a => a.id !== id));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-slate-400">
        <RefreshCw className="w-5 h-5 animate-spin mr-2" />
        加载中…
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12 text-red-500 text-sm">
        加载失败：{error}
        <button onClick={load} className="ml-3 underline">重试</button>
      </div>
    );
  }

  if (atoms.length === 0) {
    return (
      <div className="text-center py-16 text-slate-400 text-sm">
        <CheckCircle2 className="w-8 h-8 mx-auto mb-3 text-emerald-400" />
        暂无待确认的 Capture 原子事件
        <br />
        <span className="text-xs mt-1 block">Brain 会在后台自动分析新记录</span>
        <button onClick={load} className="mt-4 flex items-center gap-1 mx-auto text-xs text-slate-400 hover:text-slate-600">
          <RefreshCw className="w-3 h-3" /> 刷新
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm text-slate-500">{atoms.length} 条待确认</span>
        <button
          onClick={load}
          className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
        >
          <RefreshCw className="w-3 h-3" /> 刷新
        </button>
      </div>
      {atoms.map(atom => (
        <AtomCard key={atom.id} atom={atom} onAction={handleAction} />
      ))}
    </div>
  );
}
