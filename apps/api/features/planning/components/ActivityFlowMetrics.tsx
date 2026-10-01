export interface ActivityFlowMetric {
  activity_id: string; workflow_id?: string | null; activity_name?: string; workflow_name?: string | null;
  p50_duration_ms?: number | null; first_pass_yield?: number | null;
  pass_rate?: number | null; span_count?: number | null;
}
const percent = (n?: number | null) => n == null ? '—' : (n * 100).toLocaleString('zh-CN', { maximumFractionDigits: 1 }) + '%';
const duration = (n?: number | null) => n == null ? '—' : (n / 1000).toLocaleString('zh-CN', { maximumFractionDigits: 2 }) + '秒';
export default function ActivityFlowMetrics({ metrics }: { metrics?: ActivityFlowMetric[] }) {
  return <section className="mt-2 text-xs" aria-label="活动过程指标">
    <h3 className="font-medium">近7天过程</h3>
    {!metrics?.length ? <p>暂无活动执行数据</p> : <>
      <table className="mt-1 w-full text-left"><thead><tr>
        <th>活动 / 工作流</th><th>p50</th><th>一次做对</th><th>通过率</th><th>样本</th>
      </tr></thead><tbody>{metrics.map(m => <tr key={m.activity_id + ':' + (m.workflow_id ?? '')}>
        <td>{m.activity_name ?? m.activity_id} · {m.workflow_name ?? m.workflow_id ?? '未挂工作流'}</td>
        <td>{duration(m.p50_duration_ms)}</td><td>{percent(m.first_pass_yield)}</td>
        <td>{percent(m.pass_rate)}</td><td>{m.span_count ?? '—'}</td>
      </tr>)}</tbody></table>
      <p className="mt-1 opacity-70">一次做对 = 未使用兜底的比例；不包含重试次数或成功判定，请结合通过率查看。</p>
    </>}
  </section>;
}
