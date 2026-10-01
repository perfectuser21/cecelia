import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import QuickCapture from '../../gtd/components/QuickCapture';
import IntakeForm from './IntakeForm';
import TaskResult from './TaskResult';
import { loadPending, readTask, readTasks, type TaskRecord } from './service';
import { statusLabel, taskTitle } from './results';

export default function TaskDesk() {
  const [mode, setMode] = useState<'task' | 'record'>('task');
  const [selected, setSelected] = useState<string | null>(() => loadPending().pending?.task_id ?? null);
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [listLoaded, setListLoaded] = useState(false);
  const [detail, setDetail] = useState<TaskRecord | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let disposed = false;
    let request: AbortController | undefined;
    async function refresh() {
      request?.abort();
      const controller = new AbortController(); request = controller;
      try {
        const list = await readTasks(controller.signal);
        if (disposed || controller.signal.aborted) return;
        setTasks(list); setListError(null); setListLoaded(true);
        setSelected(previous => previous ?? list[0]?.id ?? null);
      } catch (e) {
        if (!disposed && !controller.signal.aborted) setListError((e as Error).message);
      }
    }
    void refresh();
    const timer = window.setInterval(refresh, 10000);
    return () => { disposed = true; request?.abort(); window.clearInterval(timer); };
  }, [revision, mode]);

  useEffect(() => {
    setDetail(null); setDetailError(null);
    if (!selected) return;
    let disposed = false;
    let request: AbortController | undefined;
    async function refresh() {
      request?.abort();
      const controller = new AbortController(); request = controller;
      setDetailLoading(true);
      try {
        const task = await readTask(selected!, controller.signal);
        if (disposed || controller.signal.aborted) return;
        setDetail(task); setDetailError(null);
      } catch (e) {
        if (!disposed && !controller.signal.aborted) setDetailError((e as Error).message);
      } finally {
        if (!disposed && !controller.signal.aborted) setDetailLoading(false);
      }
    }
    void refresh();
    // completed/canceled 仍会写入迟到回执或恢复执行，持续读真身。
    const timer = window.setInterval(refresh, 10000);
    return () => { disposed = true; request?.abort(); window.clearInterval(timer); };
  }, [selected, revision, mode]);

  return <div className="h-full min-w-0 overflow-y-auto bg-slate-900 text-slate-200">
    <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-xl font-semibold text-white">交办台</h1><p className="mt-1 text-sm text-slate-400">交代事情，查看接单、进展和结果。</p></div>
        <Link to="?view=history" className="inline-flex min-h-11 items-center text-sm text-slate-400 underline">旧记录</Link>
      </header>
      <section className="space-y-4 rounded-2xl border border-slate-700 bg-slate-800/40 p-4 sm:p-5">
        <div className="flex gap-2" aria-label="输入模式">{(['task', 'record'] as const).map(value => <button key={value} onClick={() => setMode(value)} aria-pressed={mode === value}
          className={`min-h-11 rounded-lg px-4 text-sm font-medium ${mode === value ? 'bg-blue-600 text-white' : 'bg-slate-700/50 text-slate-300'}`}>{value === 'task' ? '交给 AI 办' : '记下来'}</button>)}</div>
        <p className="text-sm text-slate-400">{mode === 'task' ? '可以交代调研、代码审查或修改。收到任务编号后，即可在这里查看进展。' : '保存想法和素材，收到记录编号；这不代表已派给 AI 执行。'}</p>
        <div hidden={mode !== 'task'}><IntakeForm onCreated={id => { setSelected(id); setRevision(r => r + 1); }} /></div>
        <div hidden={mode !== 'record'}><QuickCapture placeholder="记下想法、素材或备忘…" submitLabel="保存记录" /></div>
      </section>
      {selected && <TaskResult id={selected} task={detail?.id === selected ? detail : null} error={detailError} loading={detailLoading} />}
      <section className="space-y-3">
        <div className="flex items-center justify-between"><h2 className="font-medium">最近交办</h2><button onClick={() => setRevision(r => r + 1)} className="min-h-11 px-3 text-sm text-blue-300">刷新</button></div>
        {listError && <p role="alert" className="text-sm text-amber-300">{listError}</p>}
        {!listLoaded && !listError && <p className="text-sm text-slate-400">正在读取最近交办…</p>}
        {listLoaded && !listError && tasks.length === 0 && <p className="text-sm text-slate-400">还没有交办记录</p>}
        {tasks.length > 0 && <ul className="space-y-2">{tasks.map(task => <li key={task.id}><button onClick={() => setSelected(task.id)} aria-pressed={selected === task.id}
          className={`flex min-h-14 w-full min-w-0 items-start justify-between gap-3 rounded-lg border p-3 text-left text-sm ${selected === task.id ? 'border-blue-500 bg-blue-500/10' : 'border-slate-700'}`}>
          <span className="min-w-0 break-words">{taskTitle(task)}</span><span className="shrink-0 text-slate-400">{statusLabel(task.status)}</span>
        </button></li>)}</ul>}
      </section>
    </div>
  </div>;
}
