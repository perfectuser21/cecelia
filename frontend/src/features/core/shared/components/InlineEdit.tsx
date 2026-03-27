import { useState, useRef, useCallback, KeyboardEvent } from 'react';

interface InlineEditProps {
  value: string;
  onSave: (newValue: string) => Promise<void> | void;
  className?: string;
  inputClassName?: string;
  placeholder?: string;
}

/**
 * InlineEdit — 点击即可编辑的文本组件
 *
 * 用法：
 *   <InlineEdit value={title} onSave={async (v) => await api.update(id, { title: v })} />
 *
 * 交互：
 *   - 单击文本 → 进入编辑模式（input）
 *   - Enter / blur → 保存（调用 onSave）
 *   - Escape → 取消，恢复原值
 */
export default function InlineEdit({
  value,
  onSave,
  className = '',
  inputClassName = '',
  placeholder = '点击编辑...',
}: InlineEditProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const startEdit = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setDraft(value);
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  }, [value]);

  const commit = useCallback(async () => {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === value) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onSave(trimmed);
    } finally {
      setSaving(false);
      setEditing(false);
    }
  }, [draft, value, onSave]);

  const cancel = useCallback(() => {
    setDraft(value);
    setEditing(false);
  }, [value]);

  const onKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    }
  }, [commit, cancel]);

  if (editing) {
    return (
      <input
        ref={inputRef}
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={commit}
        onClick={(e) => e.stopPropagation()}
        disabled={saving}
        placeholder={placeholder}
        className={`bg-white dark:bg-slate-700 border border-blue-400 dark:border-blue-500 rounded px-1.5 py-0.5 text-inherit font-inherit outline-none focus:ring-2 focus:ring-blue-400/30 disabled:opacity-60 w-full ${inputClassName}`}
      />
    );
  }

  return (
    <span
      onClick={startEdit}
      title="点击编辑"
      className={`cursor-text hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded px-0.5 transition-colors ${className}`}
    >
      {value || <span className="text-slate-400 italic">{placeholder}</span>}
    </span>
  );
}
