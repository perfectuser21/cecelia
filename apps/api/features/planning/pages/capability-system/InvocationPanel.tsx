import { FormEvent, useEffect, useRef, useState } from 'react';
import BusinessInputs from './BusinessInputs';
import InvocationEvidence from './InvocationEvidence';
import { InvocationError, InvocationRequest, InvocationResult, InvocationTarget, Resolution, INVOCATION_POLL_MS, invocationJson, terminalInvocation } from './invocations';
export default function InvocationPanel({ target }: { target: InvocationTarget }) {
  return <InvocationSession key={JSON.stringify(target)} target={target} />;
}
function InvocationSession({ target }: { target: InvocationTarget }) {
  const [mode, setMode] = useState<InvocationRequest['mode']>('released');
  const [input, setInput] = useState<Record<string, unknown>>({});
  const [authoringTask, setAuthoringTask] = useState(''), [compose, setCompose] = useState('');
  const [resolution, setResolution] = useState<Resolution | null>(null), [resolving, setResolving] = useState(true);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [result, setResult] = useState<InvocationResult | null>(null), [uncertain, setUncertain] = useState(false);
  const [requestKey, setRequestKey] = useState(''), [refresh, setRefresh] = useState(0);
  const lock = useRef(false), alive = useRef<AbortController | null>(null);
  const payload: InvocationRequest = { target: mode === 'candidate' ? { kind: target.kind, id: target.id } : target, mode, input, ...(mode === 'candidate' ? { authoring_task_id: authoringTask, compose_sha256: compose } : {}) };
  const serialized = JSON.stringify(payload);
  useEffect(() => {
    const controller = new AbortController(); alive.current = controller;
    return () => controller.abort();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setResolving(true); setError('');
    invocationJson<Resolution>('/resolve', controller.signal, JSON.parse(serialized))
      .then(data => { if (!controller.signal.aborted) { setResolution(data); setResolving(false); } })
      .catch(e => { if (!controller.signal.aborted) { setError(e.message); setResolving(false); setResolution(null); } });
    return () => controller.abort();
  }, [serialized, refresh]);
  useEffect(() => {
    if ((!result && !uncertain) || (result && terminalInvocation(result.status))) return;
    const controller = new AbortController();
    let fetching = false;
    const timer = setInterval(() => {
      if (fetching || document.visibilityState === 'hidden') return;
      fetching = true;
      const path = result ? `/${encodeURIComponent(result.task_id)}` : `/by-request/${encodeURIComponent(requestKey)}`;
      invocationJson<InvocationResult>(path, controller.signal).then(value => {
        if (!controller.signal.aborted) { setResult(value); setUncertain(false); setError(''); }
      }).catch(e => { if (!controller.signal.aborted) setError(`结果确认中：${e.message}`); }).finally(() => { fetching = false; });
    }, INVOCATION_POLL_MS);
    return () => { clearInterval(timer); controller.abort(); };
  }, [result, uncertain, requestKey]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (lock.current || (result && !uncertain) || (resolving || resolution?.readiness !== 'ready')) return;
    lock.current = true; setBusy(true); setError('');
    const controller = alive.current!;
    const key = requestKey || crypto.randomUUID(); setRequestKey(key);
    try {
      const value = await invocationJson<InvocationResult>('', controller.signal, { ...payload, target: resolution.target, request_key: key });
      if (!controller.signal.aborted) { setResult(value); setUncertain(false); }
    } catch (e) {
      if (controller.signal.aborted) return;
      if (e instanceof InvocationError && e.status < 500 && e.status !== 408) {
        setError(e.message); setRequestKey(''); setResolution(current => current ? { ...current, readiness: 'blocked', gaps: e.gaps } : null);
      } else {
        setUncertain(true);
        try {
          const value = await invocationJson<InvocationResult>(`/by-request/${encodeURIComponent(key)}`, controller.signal);
          if (!controller.signal.aborted) { setResult(value); setUncertain(false); }
        } catch (lookupError) {
          if (!controller.signal.aborted) setError(`结果确认中：${(lookupError as Error).message}。重试沿用同一请求，不会另建调用。`);
        }
      }
    } finally { if (!controller.signal.aborted) { lock.current = false; setBusy(false); } }
  }
  return <section aria-label={`${target.kind === 'activity' ? '活动' : '工作流'}调用`} className="my-4 space-y-3 rounded-xl border p-4">
    <h3 className="font-semibold">{target.kind === 'activity' ? '活动' : '工作流'}调用</h3>
    <p className="break-all text-sm">指定版本：{resolution?.target.definition_version_id || (mode === 'candidate' ? '候选身份待后端确认' : target.definition_version_id || '未指定（由后端确认）')}</p>
    <form onSubmit={submit} className="space-y-3">
      <label className="block text-sm">调用用途<select aria-label="调用用途" value={mode} disabled={busy || !!requestKey} onChange={e => setMode(e.target.value as InvocationRequest['mode'])} className="ml-2 rounded border p-2 dark:bg-slate-900"><option value="released">正式版本</option><option value="candidate">候选验证（不代表正式可用）</option></select></label>
      {mode === 'candidate' && <details><summary className="text-sm">候选验证来源</summary><fieldset disabled={busy || !!requestKey}><label className="block text-sm">编写任务<input aria-label="编写任务" required value={authoringTask} onChange={e => setAuthoringTask(e.target.value)} className="block w-full rounded border p-2 dark:bg-slate-900" /></label><label className="block text-sm">候选摘要<input aria-label="候选摘要" required value={compose} onChange={e => setCompose(e.target.value)} className="block w-full rounded border p-2 dark:bg-slate-900" /></label><p className="text-sm text-amber-800">验证通过后仍需正式发布门禁。</p></fieldset></details>}
      <p role="status">{resolving ? '正在核对调用条件…' : resolution ? { ready: '可调用', blocked: '调用受阻', unverified: '尚未验证' }[resolution.readiness] : '无法核对调用条件'}</p>
      {resolution?.gaps?.map((gap, i) => <p key={i} className="text-sm text-amber-800">{gap.message || gap.code}{gap.field ? ` · ${gap.field}` : ''}</p>)}
      <button type="button" disabled={busy || !!requestKey} onClick={() => setRefresh(n => n + 1)} className="text-sm text-blue-700 underline disabled:opacity-40">重新核对调用条件</button>
      <BusinessInputs schema={resolution?.input_schema} value={input} onChange={setInput} disabled={busy || !!requestKey} />
      <button type="submit" disabled={busy || resolving || resolution?.readiness !== 'ready' || (!!result && !uncertain)} className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-40">{busy ? '提交中…' : uncertain ? '按原请求重试' : '启动调用'}</button>
    </form>
    {uncertain && <p role="status">结果确认中 · 正在按原请求查回</p>}
    {error && <p role="alert" className="text-red-800">{error}</p>}
    {result && <InvocationEvidence result={result} />}
    {result && terminalInvocation(result.status) && <button type="button" onClick={() => { setResult(null); setRequestKey(''); setRefresh(n => n + 1); }} className="text-sm text-blue-700 underline">发起另一调用</button>}
    <details><summary className="text-sm">调用技术信息</summary><p className="break-all text-xs">目标：{target.kind} / {target.id}</p>{requestKey && <p className="break-all text-xs">请求键：{requestKey}</p>}</details>
  </section>;
}
