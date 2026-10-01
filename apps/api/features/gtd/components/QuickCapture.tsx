import React, { useState, useRef } from 'react';
import { PlusCircle, Loader2 } from 'lucide-react';

interface QuickCaptureProps {
  onSuccess?: () => void;
  placeholder?: string;
}

export default function QuickCapture({ onSuccess, placeholder = '快速捕获想法、任务、灵感... (Enter 提交)' }: QuickCaptureProps): React.ReactElement {
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = async () => {
    const text = content.trim();
    if (!text || submitting) return;

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/brain/captures', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: text, source: 'dashboard' }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setContent('');
      onSuccess?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : '提交失败');
    } finally {
      setSubmitting(false);
      inputRef.current?.focus();
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
    if (e.key === 'Escape') {
      setContent('');
      setError(null);
    }
  };

  return (
    <div className="w-full rounded-xl border border-slate-700 bg-slate-800/60 p-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <PlusCircle size={18} className="shrink-0 text-slate-400" />
          <input
            ref={inputRef}
            type="text"
            value={content}
            onChange={e => setContent(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            disabled={submitting}
            className="min-h-11 min-w-0 w-full flex-1 rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-base text-slate-100 placeholder:text-slate-500 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:opacity-60"
            autoComplete="off"
          />
        </div>
        <button
          onClick={submit}
          disabled={!content.trim() || submitting}
          className="flex min-h-11 w-full shrink-0 items-center justify-center rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
          title="提交 (Enter)"
        >
          {submitting ? <Loader2 size={16} className="animate-spin" /> : '提交'}
        </button>
      </div>
      {error && (
        <div className="mt-2 text-sm text-red-400">{error}</div>
      )}
    </div>
  );
}
