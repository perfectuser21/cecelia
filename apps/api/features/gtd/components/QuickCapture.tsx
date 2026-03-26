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
      const res = await fetch('/api/captures', {
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
    <div className="quick-capture-bar">
      <div className="quick-capture-inner">
        <PlusCircle size={18} className="quick-capture-icon" />
        <input
          ref={inputRef}
          type="text"
          value={content}
          onChange={e => setContent(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          disabled={submitting}
          className="quick-capture-input"
          autoComplete="off"
        />
        <button
          onClick={submit}
          disabled={!content.trim() || submitting}
          className="quick-capture-btn"
          title="提交 (Enter)"
        >
          {submitting ? <Loader2 size={16} className="spin" /> : '捕获'}
        </button>
      </div>
      {error && (
        <div className="quick-capture-error">{error}</div>
      )}
    </div>
  );
}
