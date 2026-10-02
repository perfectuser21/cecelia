import { useState } from "react";
import {
  Activity,
  ActivityUsage,
  Journey,
  Registry,
  Selection,
  Step,
  Workflow,
} from "./model";
import { State } from "./ActivityDetail";
type Props = {
  registry: Registry;
  query: string;
  area: string;
  workflow: string;
  onSelect: (selection: Selection) => void;
};
export default function StructureView({
  registry: r,
  query,
  area,
  workflow,
  onSelect,
}: Props) {
  const [step, setStep] = useState<Step | null>(null);
  const text = query.trim().toLowerCase();
  const matches = (...values: unknown[]) =>
    !text ||
    values.some((v) =>
      String(v || "")
        .toLowerCase()
        .includes(text),
    );
  const selectedFlows = r.workflows.filter(
    (w) => !workflow || w.id === workflow,
  );
  const activity = (a: ActivityUsage, w: Workflow) =>
    r.activities.find((item) => item.id === a.activity_id) || {
      id: a.activity_id,
      name: a.name,
      definition_status: a.definition_status,
      consumers: [{ ...a.usage, workflow_id: w.id }],
    };
  const usageVisible = (a: ActivityUsage, w: Workflow) =>
    matches(
      a.name,
      a.activity_id,
      a.usage?.reference_id,
      w.name,
      w.key,
      ...(a.steps || []).flatMap((s) => [s.name, s.key, s.id]),
    );
  const flowVisible = (w: Workflow) =>
    matches(w.name, w.key) || w.activities.some((a) => usageVisible(a, w));
  const flow = (w: Workflow) => (
    <details open key={w.id} className="ml-4 border-l border-slate-200 pl-4">
      <summary className="cursor-pointer py-2">
        <span className="text-xs text-slate-500">Workflow · </span>
        <span>{w.name}</span> <State value={w.definition_status} />
      </summary>
      <ul className="space-y-2">
        {w.activities
          .filter((a) => usageVisible(a, w))
          .map((a) => (
            <li
              key={a.usage.reference_id}
              data-reference-id={a.usage.reference_id}
              data-activity-id={a.activity_id}
              className="rounded-lg border bg-white p-3 dark:bg-slate-900"
            >
              <button
                type="button"
                className="text-left font-medium text-blue-700"
                onClick={() =>
                  onSelect({
                    activity: activity(a, w),
                    usage: a.usage,
                    workflow: w,
                  })
                }
              >
                {a.usage.sequence_no}. {a.name}
              </button>
              <p className="break-all text-xs text-slate-500">
                Activity 使用位置 · {a.usage.reference_id}
              </p>
              <ul className="ml-4 mt-2 space-y-1">
                {(a.steps || []).map((s, i) => (
                  <li key={s.id || s.key || i}>
                    <button
                      type="button"
                      onClick={() =>
                        setStep({
                          ...s,
                          ...r.steps.find((item) => item.id === s.id),
                        })
                      }
                      className="text-sm hover:underline"
                    >
                      Step · {s.name || s.key}
                    </button>
                    {!s.id && <State value="unknown" />}
                  </li>
                ))}
              </ul>
            </li>
          ))}
      </ul>
      {!w.activities.length && (
        <p className="py-2 text-sm">此工作流尚无活动引用。</p>
      )}
    </details>
  );
  const flowsFor = (j: Journey) =>
    selectedFlows.filter((w) => w.capability_id === j.id && flowVisible(w));
  const cap = (j: Journey) => {
    const flows = flowsFor(j);
    if (text && !matches(j.name, j.id) && !flows.length) return null;
    return (
      <details open key={j.id} className="ml-4 border-l pl-4">
        <summary className="cursor-pointer py-2">
          <span className="text-xs text-slate-500">Capability · </span>
          <span>{j.name}</span>
          {j.organization?.source === "unknown" && <State />}
        </summary>
        {flows.map(flow)}
        {!flows.length && (
          <p className="text-sm text-slate-500">无匹配工作流</p>
        )}
      </details>
    );
  };
  const effective = (j: Journey) => j.organization?.effective_area?.id || "";
  const groups = [
    ...r.areas.map((a) => ({
      id: a.id,
      name: a.name,
      parent: a.parent_area_id,
    })),
    { id: "", name: "未归属 / unknown", parent: null },
  ].filter((a) => !area || (area === "unknown" ? !a.id : a.id === area));
  const scopedGroups = groups.map((group) => {
    const journeys = r.journeys.filter(
      (j) =>
        effective(j) === group.id ||
        (!r.areas.some((a) => a.id === effective(j)) && !group.id),
    );
    const caps = journeys.filter((j) => j.role === "capability");
    const streams = r.journeys.filter(
      (j) =>
        j.role === "value_stream" &&
        (journeys.includes(j) ||
          caps.some((c) => c.parent_journey_id === j.id)),
    );
    return (
      <section
        key={group.id}
        className="rounded-xl border bg-slate-50 p-4 dark:bg-slate-950"
      >
        <h2 className="mb-2 text-lg font-semibold">
          <span>{group.name}</span>
        </h2>
        {group.parent && (
          <p className="text-xs text-slate-500">
            上级部门：
            {r.areas.find((a) => a.id === group.parent)?.name || "unknown"}
          </p>
        )}
        {streams.map((v) => (
          <details open key={v.id}>
            <summary className="cursor-pointer py-2">
              <span className="text-xs text-slate-500">ValueStream · </span>
              <span>{v.name}</span>
            </summary>
            {caps.filter((c) => c.parent_journey_id === v.id).map(cap)}
          </details>
        ))}
        {caps
          .filter((c) => !streams.some((v) => v.id === c.parent_journey_id))
          .map(cap)}
        {journeys
          .filter((j) => j.role === "unknown")
          .map((j) => (
            <p key={j.id}>{j.name} · 结构 unknown</p>
          ))}
        {!group.id &&
          selectedFlows
            .filter(
              (w) =>
                !r.journeys.some(
                  (j) => j.id === w.capability_id && j.role === "capability",
                ),
            )
            .filter(flowVisible)
            .map(flow)}
        {!journeys.length && group.id && (
          <p className="text-sm text-slate-500">
            该部门尚无已登记价值流或能力。
          </p>
        )}
      </section>
    );
  });
  const unreferenced = r.activities.filter(
    (a) => !a.consumers?.length && matches(a.name, a.id),
  );
  const orphanSteps = r.steps.filter(
    (s) =>
      !r.activities.some((a) => a.id === s.activity_id) &&
      matches(s.key, s.name, s.id),
  );
  return (
    <div className="space-y-4">
      <div className="space-y-4">{scopedGroups}</div>
      {!workflow && (
        <section className="rounded-xl border p-4">
          <h2 className="font-semibold">
            未被 Workflow 引用的活动 · {unreferenced.length}
          </h2>
          {unreferenced.map((a: Activity) => (
            <div key={a.id} className="mt-3 flex items-center gap-3">
              <button
                type="button"
                onClick={() => onSelect({ activity: a })}
                className="text-blue-700"
              >
                {a.name}
              </button>
              <State value={a.definition_status} />
            </div>
          ))}
        </section>
      )}
      {orphanSteps.length > 0 && (
        <section className="rounded-xl border p-4">
          <h2>未归属步骤</h2>
          {orphanSteps.map((s) => (
            <button
              type="button"
              key={s.id || s.key}
              className="block"
              onClick={() =>
                setStep({ ...s, ...r.steps.find((item) => item.id === s.id) })
              }
            >
              {s.name || s.key} · unknown
            </button>
          ))}
        </section>
      )}
      <section className="rounded-xl border p-4">
        <h2 className="font-semibold">
          共享组件 / Enablers · {r.enablers.length}
        </h2>
        {r.enablers.map((e) => (
          <p key={e.id} className="mt-2">
            {e.name} · {e.kind}{" "}
            <State value={e.source_verified ? "verified" : "unknown"} />
          </p>
        ))}
        {!r.enablers.length && (
          <p className="text-sm text-slate-500">暂无共享组件登记。</p>
        )}
      </section>
      {step && (
        <aside
          aria-label="步骤详情"
          className="rounded-xl border border-blue-200 p-4"
        >
          <button
            type="button"
            onClick={() => setStep(null)}
            className="float-right"
          >
            关闭步骤
          </button>
          <h2 className="font-semibold">{step.name || step.key}</h2>
          <p>Step ID：{step.id || step.step_id || "unknown · 尚未登记"}</p>
          <p>{step.description}</p>
          <p>模式：{step.mode || "unknown"}</p>
          <p className="break-all">
            来源摘要：{step.source_sha256 || "unknown"}
          </p>
          <State
            value={step.source_verified === true ? "verified" : "unknown"}
          />
          <p className="mt-2 text-sm">
            内容摘要只验证登记内容；执行结果见运行证据。
          </p>
          <p>
            登记内容摘要：
            {step.content_hash_verified === true ? "verified" : "unknown"}
          </p>
        </aside>
      )}
    </div>
  );
}
