import React, { useState, useRef, useEffect } from 'react';
import type { ColumnDef } from './types';
import { Check, Link, Mail, Phone, ExternalLink } from 'lucide-react';

// ── 颜色映射 ──────────────────────────────────────────

const BADGE_COLORS: Record<string, string> = {
  '#ef4444': 'bg-red-900/40 text-red-300 border border-red-700/40',
  '#f59e0b': 'bg-amber-900/40 text-amber-300 border border-amber-700/40',
  '#10b981': 'bg-emerald-900/40 text-emerald-300 border border-emerald-700/40',
  '#3b82f6': 'bg-blue-900/40 text-blue-300 border border-blue-700/40',
  '#8b5cf6': 'bg-purple-900/40 text-purple-300 border border-purple-700/40',
  '#6b7280': 'bg-slate-700/60 text-slate-300 border border-slate-600/40',
  '#06b6d4': 'bg-cyan-900/40 text-cyan-300 border border-cyan-700/40',
  red:    'bg-red-900/40 text-red-300 border border-red-700/40',
  amber:  'bg-amber-900/40 text-amber-300 border border-amber-700/40',
  green:  'bg-emerald-900/40 text-emerald-300 border border-emerald-700/40',
  blue:   'bg-blue-900/40 text-blue-300 border border-blue-700/40',
  purple: 'bg-purple-900/40 text-purple-300 border border-purple-700/40',
  gray:   'bg-slate-700/60 text-slate-300 border border-slate-600/40',
  cyan:   'bg-cyan-900/40 text-cyan-300 border border-cyan-700/40',
};

function getBadgeClass(color?: string) {
  if (!color) return BADGE_COLORS.gray;
  return BADGE_COLORS[color] ?? BADGE_COLORS.gray;
}

// ── 内部工具组件 ───────────────────────────────────────

function BadgeDisplayInternal({ value, col }: { value: unknown; col: ColumnDef }) {
  const str = String(value ?? '');
  if (!str) return <span className="text-slate-600 text-sm">—</span>;
  const opt = col.options?.find((o) => o.value === str);
  const label = opt?.label ?? str;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${getBadgeClass(opt?.color)}`}>
      {label}
    </span>
  );
}

function ProgressBar({ value }: { value: unknown }) {
  const num = typeof value === 'number' ? value : parseFloat(String(value ?? '0'));
  const pct = isNaN(num) ? 0 : Math.max(0, Math.min(100, num));
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-slate-700 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, background: pct >= 80 ? '#10b981' : pct >= 40 ? '#3b82f6' : '#f59e0b' }} />
      </div>
      <span className="text-xs text-slate-400 w-8 text-right shrink-0">{pct}%</span>
    </div>
  );
}

// ── InlineEdit 主组件 ──────────────────────────────────

interface InlineEditProps {
  value: unknown;
  col: ColumnDef;
  onSave?: (value: unknown) => void;
  rowId?: string;
  onNavigate?: (href: string) => void;
}

export function InlineEdit({ value, col, onSave, rowId, onNavigate }: InlineEditProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(null);

  // editable 默认 true（只有显式设为 false 才禁用）
  const isEditable = col.editable !== false && !!onSave;

  useEffect(() => {
    if (editing && inputRef.current) inputRef.current.focus();
  }, [editing]);

  function startEdit() {
    if (!isEditable) return;
    setDraft(String(value ?? ''));
    setEditing(true);
  }

  function commit(val?: unknown) {
    setEditing(false);
    const finalVal = val !== undefined ? val : draft;
    if (col.type === 'number' || col.type === 'progress') {
      onSave?.(parseFloat(String(finalVal)) || 0);
    } else {
      onSave?.(finalVal);
    }
  }

  function cancel() { setEditing(false); }

  // ── relation (双链跳转) ────────────────────────────────
  if (col.type === 'relation') {
    const str = String(value ?? '');
    const href = rowId ? (col.navigateTo?.(rowId) ?? null) : null;
    if (!str) return <span className="text-slate-600 text-sm">—</span>;
    if (href && onNavigate) {
      return (
        <button
          onClick={(e) => { e.stopPropagation(); onNavigate(href); }}
          className="flex items-center gap-1 text-sm text-blue-400 hover:text-blue-300 hover:underline transition-colors"
        >
          {str}
          <ExternalLink className="w-3 h-3 opacity-60 shrink-0" />
        </button>
      );
    }
    return <span className="text-sm text-gray-300">{str}</span>;
  }

  // ── checkbox ────────────────────────────────────────
  if (col.type === 'checkbox') {
    const checked = value === true || value === 'true' || value === 1;
    return (
      <button
        onClick={() => isEditable && onSave?.(!checked)}
        disabled={!isEditable}
        className="flex items-center justify-center w-4 h-4 rounded border transition-colors"
        style={{ borderColor: checked ? '#4f46e5' : '#475569', background: checked ? '#4f46e5' : 'transparent' }}
      >
        {checked && <Check className="w-3 h-3 text-white" />}
      </button>
    );
  }

  // ── url ─────────────────────────────────────────────
  if (col.type === 'url') {
    if (editing) {
      return (
        <input
          ref={inputRef as React.RefObject<HTMLInputElement>}
          type="url"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => commit()}
          onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') cancel(); }}
          className="w-full text-sm bg-slate-700 text-gray-100 border border-indigo-500 rounded px-2 py-0.5 outline-none"
          placeholder="https://"
        />
      );
    }
    const url = String(value ?? '');
    if (!url) return (
      <span onClick={startEdit} className="text-slate-600 text-sm cursor-pointer hover:text-slate-400">
        {isEditable ? '添加链接' : '—'}
      </span>
    );
    return (
      <span className="flex items-center gap-1">
        <a href={url} target="_blank" rel="noopener noreferrer" className="text-blue-400 text-sm hover:underline truncate max-w-[180px]" onClick={(e) => e.stopPropagation()}>
          <Link className="w-3 h-3 inline mr-1" />{url.replace(/^https?:\/\//, '')}
        </a>
        {isEditable && <button onClick={startEdit} className="text-slate-500 hover:text-slate-300 text-xs opacity-0 group-hover:opacity-100">✏</button>}
      </span>
    );
  }

  // ── email ────────────────────────────────────────────
  if (col.type === 'email') {
    if (editing) {
      return (
        <input
          ref={inputRef as React.RefObject<HTMLInputElement>}
          type="email"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => commit()}
          onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') cancel(); }}
          className="w-full text-sm bg-slate-700 text-gray-100 border border-indigo-500 rounded px-2 py-0.5 outline-none"
        />
      );
    }
    const email = String(value ?? '');
    if (!email) return <span onClick={startEdit} className="text-slate-600 text-sm cursor-pointer">{isEditable ? '添加邮件' : '—'}</span>;
    return (
      <a href={`mailto:${email}`} className="text-blue-400 text-sm hover:underline" onClick={(e) => e.stopPropagation()}>
        <Mail className="w-3 h-3 inline mr-1" />{email}
      </a>
    );
  }

  // ── phone ────────────────────────────────────────────
  if (col.type === 'phone') {
    if (editing) {
      return (
        <input
          ref={inputRef as React.RefObject<HTMLInputElement>}
          type="tel"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => commit()}
          onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') cancel(); }}
          className="w-full text-sm bg-slate-700 text-gray-100 border border-indigo-500 rounded px-2 py-0.5 outline-none"
        />
      );
    }
    const phone = String(value ?? '');
    if (!phone) return <span onClick={startEdit} className="text-slate-600 text-sm cursor-pointer">{isEditable ? '添加电话' : '—'}</span>;
    return (
      <a href={`tel:${phone}`} className="text-gray-300 text-sm hover:text-blue-400" onClick={(e) => e.stopPropagation()}>
        <Phone className="w-3 h-3 inline mr-1" />{phone}
      </a>
    );
  }

  // ── multi_select ─────────────────────────────────────
  if (col.type === 'multi_select') {
    const vals: string[] = Array.isArray(value) ? value : (value ? String(value).split(',').filter(Boolean) : []);
    if (editing) {
      return (
        <div className="flex flex-wrap gap-1 p-1 bg-slate-700 rounded border border-indigo-500">
          {(col.options ?? []).map(opt => {
            const selected = vals.includes(opt.value);
            return (
              <button
                key={opt.value}
                onClick={() => {
                  const next = selected ? vals.filter(v => v !== opt.value) : [...vals, opt.value];
                  onSave?.(next);
                }}
                className={`px-2 py-0.5 rounded-full text-xs font-medium transition-all border ${
                  selected ? getBadgeClass(opt.color) : 'bg-slate-600/40 text-slate-400 border-slate-600/40 hover:border-slate-400'
                }`}
              >
                {opt.label}
              </button>
            );
          })}
          <button onClick={cancel} className="text-xs text-slate-500 hover:text-slate-300 ml-1">完成</button>
        </div>
      );
    }
    return (
      <div className="flex flex-wrap gap-1 cursor-pointer" onClick={startEdit}>
        {vals.length === 0
          ? <span className="text-slate-600 text-sm">{isEditable ? '选择...' : '—'}</span>
          : vals.map(v => {
              const opt = col.options?.find(o => o.value === v);
              return (
                <span key={v} className={`px-1.5 py-0.5 rounded-full text-xs font-medium ${getBadgeClass(opt?.color)}`}>
                  {opt?.label ?? v}
                </span>
              );
            })
        }
      </div>
    );
  }

  // ── date ─────────────────────────────────────────────
  if (col.type === 'date') {
    if (editing) {
      return (
        <input
          ref={inputRef as React.RefObject<HTMLInputElement>}
          type="date"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => commit()}
          onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') cancel(); }}
          className="text-sm bg-slate-700 text-gray-100 border border-indigo-500 rounded px-2 py-0.5 outline-none"
        />
      );
    }
    const dateStr = String(value ?? '');
    return (
      <span onClick={startEdit} className={`text-sm rounded px-1 py-0.5 transition-colors ${isEditable ? 'cursor-pointer hover:bg-slate-700/50' : ''} ${dateStr ? 'text-gray-300' : 'text-slate-600'}`}>
        {dateStr || (isEditable ? '设置日期' : '—')}
      </span>
    );
  }

  // ── select ───────────────────────────────────────────
  if (col.type === 'select') {
    if (editing) {
      return (
        <select
          ref={inputRef as React.RefObject<HTMLSelectElement>}
          value={draft}
          onChange={(e) => { commit(e.target.value); }}
          onBlur={() => cancel()}
          className="text-sm bg-slate-700 text-gray-300 border border-indigo-500 rounded px-1 py-0.5 outline-none"
        >
          <option value="">—</option>
          {(col.options ?? []).map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      );
    }
    const opt = (col.options ?? []).find((o) => o.value === String(value ?? ''));
    return (
      <span onClick={startEdit} className={`text-sm rounded px-1 py-0.5 transition-colors ${isEditable ? 'cursor-pointer hover:bg-slate-700/50' : ''} ${opt ? 'text-gray-200' : 'text-slate-600'}`}>
        {opt?.label ?? (value ? String(value) : '—')}
      </span>
    );
  }

  // ── badge ────────────────────────────────────────────
  if (col.type === 'badge') {
    if (editing && col.options?.length) {
      return (
        <select
          ref={inputRef as React.RefObject<HTMLSelectElement>}
          value={draft}
          onChange={(e) => { commit(e.target.value); }}
          onBlur={() => cancel()}
          className="text-sm bg-slate-700 text-gray-300 border border-indigo-500 rounded px-1 py-0.5 outline-none"
        >
          <option value="">—</option>
          {(col.options ?? []).map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      );
    }
    return (
      <span onClick={startEdit} className={isEditable ? 'cursor-pointer' : ''}>
        <BadgeDisplayInternal value={value} col={col} />
      </span>
    );
  }

  // ── progress ─────────────────────────────────────────
  if (col.type === 'progress') {
    if (editing) {
      return (
        <input
          ref={inputRef as React.RefObject<HTMLInputElement>}
          type="number" min={0} max={100}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => commit()}
          onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') cancel(); }}
          className="w-20 text-sm bg-slate-700 text-gray-300 border border-indigo-500 rounded px-2 py-0.5 outline-none"
        />
      );
    }
    return (
      <div onClick={startEdit} className={isEditable ? 'cursor-pointer' : ''}>
        <ProgressBar value={value} />
      </div>
    );
  }

  // ── number ───────────────────────────────────────────
  if (col.type === 'number') {
    if (editing) {
      return (
        <input
          ref={inputRef as React.RefObject<HTMLInputElement>}
          type="number"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => commit()}
          onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') cancel(); }}
          className="w-20 text-sm bg-slate-700 text-gray-300 border border-indigo-500 rounded px-2 py-0.5 outline-none"
        />
      );
    }
    return (
      <span onClick={startEdit} className={`text-sm rounded px-1 py-0.5 transition-colors ${isEditable ? 'cursor-pointer hover:bg-slate-700/50' : ''} ${value !== undefined && value !== '' ? 'text-gray-300' : 'text-slate-600'}`}>
        {value !== undefined && value !== null && value !== '' ? String(value) : '—'}
      </span>
    );
  }

  // ── text (default) ───────────────────────────────────
  if (editing) {
    return (
      <input
        ref={inputRef as React.RefObject<HTMLInputElement>}
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => commit()}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') cancel(); }}
        className="w-full text-sm bg-slate-700 text-gray-100 border border-indigo-500 rounded px-2 py-0.5 outline-none"
      />
    );
  }

  const str = String(value ?? '');
  return (
    <span onClick={startEdit} className={`text-sm rounded px-1 py-0.5 transition-colors ${isEditable ? 'cursor-pointer hover:bg-slate-700/50' : ''} ${str ? 'text-gray-100' : 'text-slate-600'}`}>
      {str || '—'}
    </span>
  );
}

// ── 导出辅助组件 ────────────────────────────────────────

export function BadgeDisplay({ value, options }: { value: unknown; options?: Array<{ value: string; label: string; color?: string }> }) {
  const str = String(value ?? '');
  if (!str) return <span className="text-slate-600 text-sm">—</span>;
  const opt = options?.find((o) => o.value === str);
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${getBadgeClass(opt?.color)}`}>
      {opt?.label ?? str}
    </span>
  );
}

export function ProgressDisplay({ value }: { value: number }) {
  return <ProgressBar value={value} />;
}
