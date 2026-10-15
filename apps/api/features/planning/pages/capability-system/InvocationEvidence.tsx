import { InvocationResult, invocationStatus } from './invocations';
export default function InvocationEvidence({ result }: { result: InvocationResult }) {
  return <article aria-label="调用结果" className="space-y-2 rounded border p-3">
    <p role="status">{invocationStatus(result.status)}</p>
    <p className="break-all text-sm">任务：{result.task_id}</p>
    {result.run_id && <p className="break-all text-sm">运行：{result.run_id}</p>}
    <p className="break-all text-sm">执行版本：{result.target?.definition_version_id || '尚未确认'}</p>
    {result.gaps?.map((gap, i) => <p key={i} className="text-amber-800">{gap.message || gap.code}</p>)}
    {result.outputs !== undefined && <details open><summary>产物</summary><pre className="overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(result.outputs, null, 2)}</pre></details>}
    {result.evidence !== undefined && <details><summary>运行证据</summary><pre className="overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(result.evidence, null, 2)}</pre></details>}
  </article>;
}
