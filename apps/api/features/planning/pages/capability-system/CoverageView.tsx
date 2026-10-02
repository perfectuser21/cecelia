import { useState } from "react";
import { Registry } from "./model";
import { ReadState, useRead } from "./useRead";

type CoverageStatus = "mapped" | "unknown" | "excluded";
interface InventorySource {
  kind: string;
  title: string;
  total: number;
  mapped: number;
  unknown: number;
  excluded: number;
  source_revision: string | null;
  scope_note: string;
}
interface InventoryItem {
  id: string;
  name: string;
  kind: string;
  coverage_status: CoverageStatus;
  reason: string;
  record_status?: string;
  excluded_reason?: string;
  source: { repo?: string; path?: string; revision?: string; digest?: string } | null;
  consumers: Array<{ capability_id: string; workflow_id: string | null; activity_id?: string }>;
}
interface Coverage {
  generated_at: string;
  sources: InventorySource[];
  selection: { kind: string; coverage: string; limit: number; offset: number; total: number };
  items: InventoryItem[];
}
const kinds = [
  ["skills", "Skill 登记"], ["repositories", "仓库与 Map 范围"],
  ["apis", "API 入口"], ["ops_workflows", "已登记调度／运行入口"],
  ["resources", "资源台账"], ["legacy_features", "旧 Feature"],
];
const statusLabels = { mapped: "已关联", unknown: "未知／未关联", excluded: "明确排除" };
export default function CoverageView({ registry, onOpenWorkflow }: {
  registry: Registry; onOpenWorkflow: (id: string) => void;
}) {
  const [kind, setKind] = useState("skills");
  const [coverage, setCoverage] = useState("unknown");
  const [offset, setOffset] = useState(0);
  const params = new URLSearchParams({ kind, coverage, limit: "20", offset: String(offset) });
  const state = useRead<Coverage>(`/api/brain/map/coverage?${params}`);
  const data = state.data;
  const chooseKind = (value: string) => { setKind(value); setOffset(0); };
  return (
    <section aria-label="库存覆盖清单" className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">库存覆盖与未关联清单</h2>
        <p className="text-sm text-slate-500">各来源单独计数；已关联表示能找到业务归属，不代表已验证、已部署或运行成功。</p>
      </div>
      <div className="flex flex-wrap gap-4">
        <label>库存来源<select aria-label="库存来源" value={kind} onChange={(e) => chooseKind(e.target.value)} className="ml-2 rounded border p-2 dark:bg-slate-900">
          {kinds.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        <label>关联状态<select aria-label="关联状态" value={coverage} onChange={(e) => { setCoverage(e.target.value); setOffset(0); }} className="ml-2 rounded border p-2 dark:bg-slate-900">
          <option value="all">全部状态</option>
          {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
      </div>
      <ReadState {...state} />
      {data && <>
        <div className="overflow-x-auto rounded border bg-white dark:bg-slate-900">
          <table className="w-full text-left text-sm">
            <caption className="p-3 text-left">全量来源分母 · {data.generated_at}</caption>
            <thead><tr>{["来源", "总数", "已关联", "未知", "排除", "来源版本"].map((label) => <th key={label} className="p-3">{label}</th>)}</tr></thead>
            <tbody>{data.sources.map((source) => <tr key={source.kind} className="border-t align-top">
              <td className="p-3"><button type="button" onClick={() => chooseKind(source.kind)} className="text-blue-700 underline dark:text-blue-300">{source.title}</button><p className="mt-1 max-w-md text-xs text-slate-500">{source.scope_note}</p></td>
              <td className="p-3">{source.total}</td><td className="p-3">{source.mapped}</td><td className="p-3">{source.unknown}</td><td className="p-3">{source.excluded}</td>
              <td className="max-w-48 break-all p-3"><code>{source.source_revision || "逐项查看；无统一固定版本"}</code></td>
            </tr>)}</tbody>
          </table>
        </div>
        <div aria-label="库存明细" className="space-y-3">
          {data.items.map((item) => <article key={`${item.kind}:${item.id}`} className="rounded-xl border bg-white p-4 dark:bg-slate-900">
            <h3 className="font-semibold">{item.name} <span className="ml-2 text-sm font-normal">{statusLabels[item.coverage_status] || "未知／未关联"}</span></h3>
            <p className="break-all text-xs text-slate-500">{item.kind} · {item.id}{item.record_status ? ` · 登记状态 ${item.record_status}` : ""}</p>
            <p className="my-2 text-sm">{item.reason}</p>
            {item.excluded_reason && <p className="text-sm">排除原因：{item.excluded_reason}</p>}
            <p className="break-all text-xs">{item.source?.repo || "仓库未知"}{item.source?.path ? ` · ${item.source.path}` : ""}</p>
            <p className="break-all text-xs">{item.source?.revision || "来源版本未知"}{item.source?.digest ? ` · ${item.source.digest}` : ""}</p>
            {item.consumers?.map((consumer, index) => {
              const flow = registry.workflows.find((w) => w.id === consumer.workflow_id);
              return <div key={`${consumer.workflow_id}:${consumer.activity_id || index}`} className="mt-2 text-sm">
                <span className="mr-3 break-all">能力：{registry.journeys.find((j) => j.id === consumer.capability_id)?.name || consumer.capability_id}</span>
                {consumer.workflow_id ? <button type="button" disabled={!flow} onClick={() => onOpenWorkflow(consumer.workflow_id!)} className="text-blue-700 underline disabled:text-slate-500 dark:text-blue-300" aria-label={`查看工作流：${flow?.name || consumer.workflow_id}`}>{flow?.name || `${consumer.workflow_id}（需刷新登记）`}</button> : <span>未登记工作流归属</span>}
                {consumer.activity_id && <span className="ml-3 break-all">活动：{consumer.activity_id}</span>}
              </div>;
            })}
          </article>)}
          {!data.items.length && <p>本次筛选没有记录；完整分母见上表。</p>}
        </div>
        <div className="flex items-center gap-4">
          <button type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 20))} className="rounded border px-3 py-2 disabled:opacity-40">上一页</button>
          <span>筛选结果 {data.selection.total} 条 · 第 {Math.floor(offset / 20) + 1} 页</span>
          <button type="button" disabled={offset + data.selection.limit >= data.selection.total} onClick={() => setOffset(offset + 20)} className="rounded border px-3 py-2 disabled:opacity-40">下一页</button>
        </div>
      </>}
    </section>
  );
}
