import React, { useRef, useState } from 'react';
import { loadPending, newSourceId, savePending, submitIntake, type PendingIntake } from './service';

interface Props { onCreated: (id: string) => void }
export default function IntakeForm({ onCreated }: Props) {
  const [initial] = useState(loadPending);
  const [pending, setPending] = useState(initial.pending);
  const [text, setText] = useState(initial.pending?.text ?? '');
  const [answers, setAnswers] = useState(initial.pending?.answers ?? {});
  const [error, setError] = useState<string | null>(initial.error);
  const [storageBlocked, setStorageBlocked] = useState(!!initial.error);
  const [submitting, setSubmitting] = useState(false);
  const lock = useRef(false);
  const created = pending?.phase === 'created';

  function startNew() {
    if (lock.current) return;
    try {
      savePending(null);
      setPending(null); setText(''); setAnswers({}); setError(null); setStorageBlocked(false);
    } catch (e) { setError((e as Error).message); }
  }
  function restore() {
    if (!pending) return;
    setText(pending.text); setAnswers(pending.answers ?? {}); setError(null);
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (lock.current || !text.trim() || created || storageBlocked) return;
    if (pending && (text.trim() !== pending.text || pending.phase !== 'clarification' && JSON.stringify(answers) !== JSON.stringify(pending.answers ?? {}))) {
      setError('原交办内容已保存。请恢复原交办后重试；另起一件事请点击“新交办”。'); return;
    }
    lock.current = true; setSubmitting(true); setError(null);
    try {
      const request = {
        text: text.trim(), source_id: pending?.source_id ?? newSourceId(),
        ...(Object.keys(answers).length ? { answers } : {}),
      };
      const attempt: PendingIntake = { ...request, phase: 'pending', questions: pending?.questions };
      savePending(attempt);
      setPending(attempt);
      const response = await submitIntake(request);
      const next: PendingIntake = response.outcome === 'created'
        ? { ...attempt, phase: 'created', task_id: response.task_id }
        : { ...attempt, phase: 'clarification', questions: response.questions };
      setPending(next);
      // 接单已成功时即使后续缓存失败，也必须保留服务端给出的真实编号。
      if (response.outcome === 'created') onCreated(response.task_id);
      try { savePending(next); }
      catch { setError('回执已收到，但浏览器未能保存最新回执。刷新后可从最近交办继续查看。'); }
    } catch (e) { setError((e as Error).message); }
    finally { lock.current = false; setSubmitting(false); }
  }
  return <form onSubmit={submit} className="space-y-3">
    <label htmlFor="task-intake-text" className="block text-sm text-slate-300">交办内容</label>
    <textarea id="task-intake-text" value={text} onChange={e => setText(e.target.value)} maxLength={6000}
      disabled={submitting || created} rows={4} placeholder="说清想解决的问题、期望的结果和限制条件…"
      className="w-full min-w-0 rounded-xl border border-slate-600 bg-slate-950 p-3 text-base text-slate-100 placeholder:text-slate-500 focus:border-blue-400 focus:outline-none disabled:opacity-60" />
    {!created && pending?.questions?.map(question => <fieldset key={question.id} className="space-y-2">
      <legend className="mb-2 text-sm text-slate-200">{question.prompt}</legend>
      {question.options && <div className="flex flex-wrap gap-2">{question.options.map(option => <button key={option} type="button"
        aria-pressed={answers[question.id] === option} disabled={submitting}
        onClick={() => setAnswers(previous => ({ ...previous, [question.id]: option }))}
        className={`min-h-11 rounded-lg border px-3 text-sm ${answers[question.id] === option ? 'border-blue-400 bg-blue-500/20' : 'border-slate-600'}`}>{option}</button>)}</div>}
      <input aria-label={question.prompt} value={answers[question.id] ?? ''} maxLength={1000} disabled={submitting}
        onChange={e => setAnswers(previous => ({ ...previous, [question.id]: e.target.value }))}
        className="min-h-11 w-full min-w-0 rounded-lg border border-slate-600 bg-slate-950 px-3" placeholder="补充你的要求" />
    </fieldset>)}
    {error && <p role="alert" className="break-words text-sm text-amber-300">{error}</p>}
    {created && <p role="status" className="text-sm text-emerald-300">已接单，任务状态和结果请查看下方回执。</p>}
    <div className="flex flex-wrap gap-2">
      {!created && <button type="submit" disabled={submitting || !text.trim() || storageBlocked}
        className="min-h-11 rounded-lg bg-blue-600 px-5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50">{submitting ? '正在接单…' : '提交交办'}</button>}
      {(pending || storageBlocked) && <button type="button" onClick={startNew} disabled={submitting} className="min-h-11 rounded-lg border border-slate-600 px-4 text-sm">新交办</button>}
      {pending && !created && <button type="button" onClick={restore} disabled={submitting} className="min-h-11 px-3 text-sm text-slate-300">恢复原交办</button>}
    </div>
    {pending && !created && <p className="text-xs text-slate-400">此交办的重试凭据已保存。未拿到回执时请重试原交办；新交办会另起一件事。</p>}
  </form>;
}
