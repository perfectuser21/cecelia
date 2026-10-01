import React from 'react';
import { parseResult, safeHttpUrl, statusLabel, taskTitle } from './results';
import type { TaskRecord } from './service';
const labels = { done: '已完成事项', not_done: '未完成事项', next_steps: '下一步' };
function StructuredValue({ value }: { value: unknown }) {
  if (typeof value === 'string') return <p className="whitespace-pre-wrap break-words text-sm">{value}</p>;
  if (Array.isArray(value) && value.every(item => typeof item === 'string')) return <ul className="list-inside list-disc space-y-1 text-sm">{value.map((item, i) => <li key={i}>{item}</li>)}</ul>;
  return <details><summary className="cursor-pointer text-sm text-slate-400">查看结构化内容</summary><pre className="mt-2 whitespace-pre-wrap break-all text-xs">{JSON.stringify(value, null, 2)}</pre></details>;
}
export default function TaskResult({ id, task, error, loading }: { id: string; task: TaskRecord | null; error: string | null; loading: boolean }) {
  const result = task ? parseResult(task) : null;
  return <section aria-label="任务回执" className="min-w-0 space-y-3 rounded-xl border border-slate-700 bg-slate-800/40 p-4">
    <p className="break-all text-xs text-slate-400">任务编号：{id}</p>
    {error && <p role="alert" className="text-sm text-amber-300">{error}</p>}
    {loading && <p className="text-xs text-slate-400">正在读取最新状态…</p>}
    {task && result && <>
      <h2 className="break-words font-medium text-slate-100">{taskTitle(task)}</h2>
      <p className="text-sm text-blue-300">{statusLabel(task.status)}</p>
      {result.summaries.map(summary => <p key={summary} className="whitespace-pre-wrap break-words text-sm leading-relaxed">{summary}</p>)}
      {['blocked', 'failed'].includes(task.status ?? '') && result.reasons.length === 0 && <p className="text-sm text-amber-300">尚未提供具体原因</p>}
      {result.reasons.length > 0 && <div className="space-y-1 text-sm text-amber-300"><h3>原因</h3>{result.reasons.map(reason => <p className="whitespace-pre-wrap break-words" key={reason}>{reason}</p>)}</div>}
      {result.sections.map(section => <div key={section.key} className="space-y-1"><h3 className="text-sm font-medium text-slate-300">{labels[section.key]}</h3><StructuredValue value={section.value} /></div>)}
      {result.artifactValues.length > 0 && <div className="space-y-2 text-sm"><h3>产物</h3>{result.artifactValues.map(value => safeHttpUrl(value)
        ? <a key={value} href={value} target="_blank" rel="noopener noreferrer" className="block break-all text-blue-300 underline">{value}</a>
        : <p key={value} className="break-all text-slate-300">{value}</p>)}</div>}
      {['completed', 'completed_no_pr'].includes(task.status ?? '') && !result.hasEvidence && <p className="text-sm text-slate-400">状态已完成，尚无结果证据</p>}
      {(task.result || task.payload) && <details className="text-xs text-slate-500"><summary className="cursor-pointer">查看原始结果</summary><pre className="mt-2 max-h-80 overflow-y-auto whitespace-pre-wrap break-all">{JSON.stringify({ result: task.result, payload: task.payload }, null, 2)}</pre></details>}
    </>}
  </section>;
}
