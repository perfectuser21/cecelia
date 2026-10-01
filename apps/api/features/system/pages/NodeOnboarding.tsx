import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { nodeOnboardingApi, NodeOnboardingRequest } from '../api/node-onboarding.api';
import NodeOnboardingForm from './NodeOnboardingForm';

const statuses = { queued: '等待接入', in_progress: '正在接入', completed: '接入完成', failed: '接入失败', cancelled: '已取消' };
const stepStatuses = { pending: '待开始', running: '进行中', completed: '已完成', failed: '失败' };
const active = (request: NodeOnboardingRequest) => request.status === 'queued' || request.status === 'in_progress' || request.automatic === true;

export default function NodeOnboarding({ open, onOpen, onClose, onCompleted }: {
  open: boolean; onOpen: () => void; onClose: () => void; onCompleted: () => void;
}) {
  const [items, setItems] = useState<NodeOnboardingRequest[]>([]);
  const [readError, setReadError] = useState<string | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);
  const busy = useRef(false);
  const callbacks = useRef({ onOpen, onCompleted });
  callbacks.current = { onOpen, onCompleted };
  const completed = useRef(new Set<string>());
  function accept(item: NodeOnboardingRequest) {
    setItems(previous => [item, ...previous.filter(existing => existing.id !== item.id)]);
    if (item.status === 'completed' && !completed.current.has(item.id)) {
      completed.current.add(item.id); callbacks.current.onCompleted();
    }
    if(item.status !== 'completed' && completed.current.delete(item.id)) callbacks.current.onCompleted();
  }
  useEffect(() => {
    const controller = new AbortController();
    nodeOnboardingApi.list(controller.signal).then(({ items: requests }) => {
      if (controller.signal.aborted) return;
      const unfinished = requests.filter(item => item.status !== 'completed');
      const recent = requests.filter(item => item.status === 'completed').slice(0, 5);
      for(const item of recent) completed.current.add(item.id);
      setItems(previous => [...previous, ...[...unfinished, ...recent].filter(item => !previous.some(existing => existing.id === item.id))]);
      if (unfinished.length) callbacks.current.onOpen();
    }).catch(cause => {
      if (!controller.signal.aborted) { setReadError(cause.message); callbacks.current.onOpen(); }
    });
    return () => controller.abort();
  }, []);
  const activeIds = items.filter(item=>active(item)&&(open||item.automatic===true)).map(item => item.id).sort().join(',');
  useEffect(() => {
    if (!activeIds) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      const results = await Promise.allSettled(activeIds.split(',').map(id => nodeOnboardingApi.get(id, controller.signal)));
      if (controller.signal.aborted) return;
      let failure: string | null = null;
      for (const result of results) {
        if (result.status === 'fulfilled') accept(result.value);
        else failure = result.reason instanceof Error ? result.reason.message : '进度读取失败';
      }
      setReadError(failure);
      timer = setTimeout(poll, 4000);
    }
    timer = setTimeout(poll, 4000);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [open, activeIds]);
  async function retry(item: NodeOnboardingRequest) {
    if (busy.current || (item.status !== 'failed' && item.status !== 'cancelled')) return;
    busy.current = true; setRetrying(item.id); setOperationError(null);
    try { accept(await nodeOnboardingApi.retry(item.id)); }
    catch (cause) { setOperationError(cause instanceof Error ? cause.message : '重试接入失败'); }
    finally { busy.current = false; setRetrying(null); }
  }
  return (
    <section hidden={!open} aria-label="新机器接入" className="mb-6 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5 text-gray-900 dark:text-white">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">接入新机器</h2>
        <button type="button" onClick={onClose} className="text-sm text-gray-500">关闭接入面板</button>
      </div>
      <NodeOnboardingForm onCreated={accept} />
      {readError && <p role="alert" className="mt-3 text-sm text-red-600">{readError}</p>}
      {operationError && <p role="alert" className="mt-3 text-sm text-red-600">{operationError}</p>}
      <div aria-live="polite" className="space-y-3 mt-5">
        {items.map(item => <article key={item.id} className="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
          <div className="flex justify-between gap-2"><h3 className="font-medium">{item.machine_name}</h3><span>{statuses[item.status]}</span></div>
          {item.status === 'in_progress' && !item.stage && <p className="mt-2 text-sm text-gray-500">执行中，等待验收回执</p>}
          {item.notice && <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">{item.notice}</p>}
          <ol className="my-2 space-y-1 text-sm">{item.steps.map(step => <li key={step.key}>
            <span>{step.label}</span><span className="ml-2 text-gray-500">{stepStatuses[step.status]}</span>
            {step.message && <p className="text-gray-500">{step.message}</p>}
          </li>)}</ol>
          {item.error && <p className="text-sm text-red-600">{item.error}</p>}
          <div className="mt-2 flex items-center gap-4 text-sm">
            <Link to="/workbench/tasks" className="text-blue-600">查看任务</Link>
            {(item.status === 'failed' || item.status === 'cancelled') && <button type="button" disabled={retrying !== null} onClick={() => retry(item)} className="text-blue-600 disabled:opacity-50">{retrying === item.id ? '正在重试…' : '重试接入'}</button>}
          </div>
        </article>)}
      </div>
    </section>
  );
}
