import React, { useState, useRef } from 'react';
import { PlusCircle, Loader2 } from 'lucide-react';
import { newSourceId, validId } from '../../workbench/task-desk/service';

export interface CaptureReceipt { id: string; status: string; dedupe_key?: string; created_at?: string }
interface QuickCaptureProps {
  onSuccess?: (receipt: CaptureReceipt) => void;
  placeholder?: string;
  submitLabel?: string;
}
export default function QuickCapture({ onSuccess, placeholder = '快速捕获想法、任务、灵感... (Enter 提交)', submitLabel = '提交' }: QuickCaptureProps): React.ReactElement {
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<CaptureReceipt | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const lock = useRef(false);
  const attempt = useRef<{ text: string; key: string } | null>(null);
  const submit = async () => {
    const text = content.trim();
    if (!text || lock.current) return;
    lock.current = true; setSubmitting(true); setError(null);
    try {
      if (!attempt.current || attempt.current.text !== text) attempt.current = { text, key: newSourceId() };
      const res = await fetch('/api/brain/captures', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: text, source: 'dashboard', dedupe_key: attempt.current.key }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error('记录保存失败，请保留文字重试。');
      if (!validId(data?.id)) throw new Error('未收到有效记录编号，请保留文字重试。');
      setReceipt(data); setContent(''); attempt.current = null;
      onSuccess?.(data);
    } catch (e) {
      setError(e instanceof Error && /^(记录|未收到|当前浏览器)/.test(e.message) ? e.message : '记录保存失败，文字已保留，请重试。');
    } finally {
      lock.current = false; setSubmitting(false);
      inputRef.current?.focus();
    }
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void submit(); }
    if (e.key === 'Escape') { setContent(''); setError(null); }
  };
  return <div className="w-full rounded-xl border border-slate-700 bg-slate-800/60 p-3">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <PlusCircle size={18} className="shrink-0 text-slate-400" />
        <input ref={inputRef} type="text" aria-label="记录内容" value={content} maxLength={2000}
          onChange={e => { setContent(e.target.value); setReceipt(null); }} onKeyDown={onKeyDown} placeholder={placeholder} disabled={submitting}
          className="min-h-11 min-w-0 w-full flex-1 rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-base text-slate-100 placeholder:text-slate-500 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:opacity-60" autoComplete="off" />
      </div>
      <button onClick={submit} disabled={!content.trim() || submitting}
        className="flex min-h-11 w-full shrink-0 items-center justify-center rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto" title="提交 (Enter)">
        {submitting ? <Loader2 size={16} className="animate-spin" /> : submitLabel}
      </button>
    </div>
    {error && <p role="alert" className="mt-2 text-sm text-amber-300">{error}</p>}
    {receipt && <div role="status" className="mt-2 space-y-1 text-sm text-emerald-300"><p>已保存记录</p><p className="break-all text-xs">记录编号：{receipt.id}</p></div>}
  </div>;
}
