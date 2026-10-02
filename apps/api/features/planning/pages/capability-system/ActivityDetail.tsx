import { Registry, Selection, stateLabel } from "./model";
import ActivityFlowMetrics, { type ActivityFlowMetric } from '../../components/ActivityFlowMetrics';
import { ReadState, useRead } from './useRead';
export function State({ value }: { value?: string }) {
  const state = stateLabel(value);
  return (
    <span
      className={`rounded px-2 py-1 text-xs ${state === "verified" ? "bg-emerald-100 text-emerald-900" : "bg-amber-50 text-amber-900"}`}
    >
      {state}
    </span>
  );
}
export default function ActivityDetail({
  selection,
  registry,
  onShowCanonical,
}: {
  selection: Selection;
  registry: Registry;
  onShowCanonical?: () => void;
}) {
  const { activity, usage } = selection;
  const flow = useRead<Array<{ id: string; flow_metrics?: ActivityFlowMetric[] }>>(
    `/api/brain/journey_steps?activity_id=${encodeURIComponent(activity.id)}`,
  );
  const metrics = flow.data?.find(row => row.id === activity.id)?.flow_metrics ?? [];
  const canUseBindings =
    !usage ||
    Boolean(
      usage.activity_definition_version_id &&
        usage.activity_definition_version_id ===
          activity.current_definition_version_id,
    );
  const bindings = canUseBindings ? activity.implementation_bindings || [] : [];
  const gaps = registry.gaps.filter((g) => g.entity_id === activity.id);
  return (
    <aside
      role="region"
      aria-label="活动详情"
      className="rounded-xl border border-blue-200 bg-white p-5 dark:bg-slate-900"
    >
      <h2 className="text-lg font-semibold">{activity.name}</h2>
      <p className="mt-2 text-sm">规范 Activity ID</p>
      <code className="break-all">{activity.id}</code>
      <p className="my-2">
        <State value={activity.definition_status} />
      </p>
      <ReadState loading={flow.loading} error={flow.error} />
      {flow.data && !flow.error && <ActivityFlowMetrics metrics={usage
        ? metrics.filter(metric => Boolean(usage.workflow_id) && metric.workflow_id === usage.workflow_id)
        : metrics} />}
      {usage && (
        <p className="text-sm">
          使用位置 <code>{usage.reference_id}</code> · {usage.slot_key} · 顺序{" "}
          {usage.sequence_no}
        </p>
      )}
      <p className="mt-2 text-sm">
        固定定义版本：
        {usage
          ? usage.activity_definition_version_id || "unknown"
          : activity.current_definition_version_id || "unknown"}
      </p>
      <h3 className="mb-2 mt-5 font-semibold">
        被谁引用 · {activity.consumers?.length || 0}
      </h3>
      <ul>
        {activity.consumers?.map((c) => (
          <li className="mb-2 text-sm" key={c.reference_id}>
            <span>
              {registry.workflows.find((w) => w.id === c.workflow_id)?.name ||
                c.workflow_id ||
                "未归属工作流"}
            </span>
            <br />
            <code>{c.reference_id}</code> · {c.slot_key}
          </li>
        ))}
      </ul>
      {!activity.consumers?.length && <p>无当前引用，保留历史定义。</p>}
      <h3 className="mb-2 mt-5 font-semibold">
        {usage
          ? "使用位置固定代码 / Skill 来源"
          : "规范Activity当前代码 / Skill 来源"}
      </h3>
      {!canUseBindings && (
        <p className="text-sm">
          该使用位置未固定至当前规范版本；实现来源 unknown。
          <button
            type="button"
            className="ml-2 text-blue-700 underline"
            onClick={onShowCanonical}
          >
            查看规范Activity当前定义
          </button>
        </p>
      )}
      {bindings.length ? (
        bindings.map((b, i) => (
          <div key={i} className="mb-3 rounded border p-3 text-sm">
            <State value={b.status} />
            <p>
              {b.scope === "step"
                ? `所属 Step：${b.step_key || "unknown"} · ${b.step_id || "unknown"}`
                : b.scope === "activity"
                  ? `所属 Activity：${activity.id}`
                  : "实现归属 unknown"}
            </p>
            {b.validation_scope === "reference_only" && (
              <p>
                {b.status === "verified"
                  ? "引用已核验；业务执行结果见运行证据。"
                  : "引用核验未通过；业务执行结果见运行证据。"}
              </p>
            )}
            <p>
              {b.kind} · {b.repo || "unknown"}
            </p>
            <p>{b.path || "unknown"}</p>
            <code className="break-all">{b.revision || "unknown"}</code>
            <p className="break-all">{b.digest || "摘要 unknown"}</p>
            {b.reason && <p>{b.reason}</p>}
          </div>
        ))
      ) : (
        <p>unknown · 未登记实现绑定</p>
      )}
      <h3 className="mb-2 mt-5 font-semibold">
        规范步骤 ·{" "}
        {registry.steps.filter((s) => s.activity_id === activity.id).length}
      </h3>
      {registry.steps
        .filter((s) => s.activity_id === activity.id)
        .map((s) => (
          <details key={s.id || s.key} className="mb-2 rounded border p-2">
            <summary className="cursor-pointer">{s.key}</summary>
            <p className="break-all text-xs">
              {s.id || "unknown"} · {s.active === false ? "inactive" : "active"}
            </p>
            <p className="text-sm">
              来源 {s.source_verified ? "verified" : "unknown"} · 内容{" "}
              {s.content_hash_verified ? "verified" : "unknown"}
            </p>
          </details>
        ))}
      <p className="text-sm text-slate-500">
        内容摘要只验证登记内容；执行结果见运行证据。
      </p>
      <h3 className="mb-2 mt-5 font-semibold">规范Activity当前定义来源</h3>
      <p className="break-all text-sm">
        {activity.definition_source?.repo || "unknown"} /{" "}
        {activity.definition_source?.path || "unknown"} @{" "}
        {activity.definition_source?.commit || "unknown"}
      </p>
      <h3 className="mb-2 mt-5 font-semibold">缺口</h3>
      {gaps.length ? (
        <ul>
          {gaps.map((g, i) => (
            <li key={i}>{g.code || g.gap}</li>
          ))}
        </ul>
      ) : (
        <p className="text-sm">
          当前未返回登记缺口；执行证据需在运行视图核对。
        </p>
      )}
    </aside>
  );
}
