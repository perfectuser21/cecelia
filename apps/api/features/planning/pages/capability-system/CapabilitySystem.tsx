import { useState } from "react";
import { Registry, Selection, labels } from "./model";
import ActivityDetail, { State } from "./ActivityDetail";
import StructureView from "./StructureView";
import EvidenceView from "./EvidenceView";
import ImpactView from "./ImpactView";
import CoverageView from "./CoverageView";
import { ReadState, useRead } from "./useRead";
const tabs = ["结构", "实现", "影响", "覆盖", "验证", "发布", "运行"] as const;
export default function CapabilitySystem() {
  const [tab, setTab] = useState<(typeof tabs)[number]>("结构"),
    [query, setQuery] = useState(""),
    [area, setArea] = useState(""),
    [channel, setChannel] = useState(""),
    [form, setForm] = useState(""),
    [workflow, setWorkflow] = useState(""),
    [selection, setSelection] = useState<Selection | null>(null),
    [reload, setReload] = useState(0);
  const state = useRead<Registry>(
    `/api/brain/map/registry${reload ? `?refresh=${reload}` : ""}`,
  );
  const r = state.data;
  const structural = tab === "结构" || tab === "实现";
  const areaFor = (w: Registry["workflows"][number]) =>
    w.organization?.effective_area?.id ||
    r?.journeys.find((j) => j.id === w.capability_id)?.organization
      ?.effective_area?.id ||
    "unknown";
  const scopedFlows =
    r?.workflows.filter(
      (w) =>
        (!workflow || w.id === workflow) &&
        (!channel || (w.channel || "unknown") === channel) &&
        (!form || (w.form || "unknown") === form) &&
        (!area || areaFor(w) === area),
    ) || [];
  const scopedIds = new Set(scopedFlows.map((w) => w.id));
  const allowUnassigned =
    !workflow &&
    (!area || area === "unknown") &&
    (!channel || channel === "unknown") &&
    (!form || form === "unknown");
  const scopedActivities =
    r?.activities.filter((a) =>
      a.consumers?.length
        ? a.consumers.some((c) => scopedIds.has(c.workflow_id || ""))
        : allowUnassigned,
    ) || [];
  const activityIds = new Set(scopedActivities.map((a) => a.id));
  const scopedRegistry = r
    ? {
        ...r,
        workflows: scopedFlows,
        activities: scopedActivities,
        steps: r.steps.filter(
          (s) =>
            activityIds.has(s.activity_id || "") ||
            (allowUnassigned &&
              !r.activities.some((a) => a.id === s.activity_id)),
        ),
      }
    : null;
  function resetSelection() {
    setSelection(null);
    setWorkflow("");
  }
  function openWorkflow(id: string) {
    setArea(""); setChannel(""); setForm(""); setQuery("");
    setWorkflow(id); setSelection(null); setTab("结构");
  }
  return (
    <main className="min-h-screen bg-slate-50 p-4 text-slate-900 dark:bg-slate-950 dark:text-slate-100 md:p-6">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">能力系统</h1>
          <p className="mt-1 text-sm text-slate-500">
            部门 → 价值流 → 能力 → 工作流 → 活动使用位置 → 步骤
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setReload((n) => n + 1);
            setSelection(null);
          }}
          className="rounded border bg-white px-4 py-2 dark:bg-slate-900"
        >
          刷新登记
        </button>
      </header>
      <ReadState {...state} />
      {r && (
        <>
          <section
            aria-label="全量登记计数"
            className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4"
          >
            {Object.entries(labels).map(([key, label]) => (
              <article
                key={key}
                className="rounded-xl border bg-white p-3 dark:bg-slate-900"
              >
                <p className="text-sm text-slate-500">{label}</p>
                <strong className="text-2xl">
                  {r.counts[key]?.total ?? 0}
                </strong>
                {r.counts[key]?.unknown !== undefined && (
                  <p className="text-xs text-amber-800">
                    unknown {r.counts[key].unknown}
                  </p>
                )}
                {key === "activities" && (
                  <p className="text-xs">
                    使用位置 {r.counts.activities?.usage_count ?? 0}
                  </p>
                )}
              </article>
            ))}
          </section>
          <p className="mb-4 text-xs text-slate-500">
            登记快照：{r.generated_at} · 缺口 {r.gaps.length}
          </p>
          <div
            role="tablist"
            aria-label="能力系统视图"
            className="mb-5 flex flex-wrap gap-2"
          >
            {tabs.map((t) => (
              <button
                type="button"
                role="tab"
                aria-selected={tab === t}
                key={t}
                onClick={() => setTab(t)}
                className={`rounded-lg px-4 py-2 ${tab === t ? "bg-blue-600 text-white" : "border bg-white dark:bg-slate-900"}`}
              >
                {t}
              </button>
            ))}
          </div>
          {tab !== "影响" && tab !== "覆盖" && (
            <div className="mb-5 grid gap-3 md:grid-cols-3">
              {structural && (
                <>
                  <label className="text-sm">
                    搜索
                    <input
                      aria-label="搜索"
                      value={query}
                      onChange={(e) => {
                        setQuery(e.target.value);
                        setSelection(null);
                      }}
                      className="mt-1 block w-full rounded border p-2 dark:bg-slate-900"
                      placeholder="名称、规范 ID 或使用位置"
                    />
                  </label>
                  <label className="text-sm">
                    部门
                    <select
                      aria-label="部门"
                      value={area}
                      onChange={(e) => {
                        setArea(e.target.value);
                        resetSelection();
                      }}
                      className="mt-1 block w-full rounded border p-2 dark:bg-slate-900"
                    >
                      <option value="">全部部门</option>
                      {r.areas.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                      <option value="unknown">未归属 / unknown</option>
                    </select>
                  </label>
                  <label className="text-sm">
                    平台 / Channel
                    <select
                      aria-label="平台"
                      value={channel}
                      onChange={(e) => {
                        setChannel(e.target.value);
                        resetSelection();
                      }}
                      className="mt-1 block w-full rounded border p-2 dark:bg-slate-900"
                    >
                      <option value="">全部平台</option>
                      {[
                        ...new Set([
                          ...r.workflows.map((w) => w.channel || "unknown"),
                          "unknown",
                        ]),
                      ]
                        .sort()
                        .map((v) => (
                          <option key={v}>{v}</option>
                        ))}
                    </select>
                  </label>
                  <label className="text-sm">
                    终端 / Form
                    <select
                      aria-label="终端"
                      value={form}
                      onChange={(e) => {
                        setForm(e.target.value);
                        resetSelection();
                      }}
                      className="mt-1 block w-full rounded border p-2 dark:bg-slate-900"
                    >
                      <option value="">全部终端</option>
                      {[
                        ...new Set([
                          ...r.workflows.map((w) => w.form || "unknown"),
                          "unknown",
                        ]),
                      ]
                        .sort()
                        .map((v) => (
                          <option key={v}>{v}</option>
                        ))}
                    </select>
                  </label>
                </>
              )}
              <label className="text-sm">
                工作流
                <select
                  aria-label="工作流"
                  value={workflow}
                  onChange={(e) => {
                    setWorkflow(e.target.value);
                    setSelection(null);
                  }}
                  className="mt-1 block w-full rounded border p-2 dark:bg-slate-900"
                >
                  <option value="">全部工作流</option>
                  {(structural
                    ? r.workflows.filter(
                        (w) =>
                          (!channel || (w.channel || "unknown") === channel) &&
                          (!form || (w.form || "unknown") === form) &&
                          (!area || areaFor(w) === area),
                      )
                    : r.workflows
                  ).map((w) => (
                    <option value={w.id} key={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
          {(tab === "结构" || tab === "实现") && (
            <div
              className={`grid gap-5 ${selection ? "xl:grid-cols-[minmax(0,1fr)_380px]" : ""}`}
            >
              <div>
                {tab === "结构" ? (
                  <StructureView
                    registry={scopedRegistry!}
                    query={query}
                    area={area}
                    workflow={workflow}
                    onSelect={setSelection}
                  />
                ) : (
                  <section className="space-y-3">
                    <h2 className="text-lg font-semibold">
                      实现绑定与规范活动
                    </h2>
                    {scopedActivities
                      .filter(
                        (a) =>
                          (!workflow ||
                            a.consumers?.some(
                              (c) => c.workflow_id === workflow,
                            )) &&
                          (!query ||
                            `${a.name} ${a.id} ${(a.implementation_bindings || []).map((b) => b.path).join(" ")}`
                              .toLowerCase()
                              .includes(query.toLowerCase())),
                      )
                      .map((a) => (
                        <button
                          type="button"
                          key={a.id}
                          onClick={() => setSelection({ activity: a })}
                          className="block w-full rounded-xl border bg-white p-4 text-left dark:bg-slate-900"
                        >
                          <span className="font-semibold">{a.name}</span>{" "}
                          <State value={a.definition_status} />
                          <p className="text-sm">
                            {a.implementation_bindings?.length || 0} 个绑定 ·{" "}
                            {a.consumers?.length || 0} 个使用位置
                          </p>
                          <code className="text-xs">{a.id}</code>
                        </button>
                      ))}
                  </section>
                )}
              </div>
              {selection && (
                <ActivityDetail
                  selection={selection}
                  registry={r}
                  onShowCanonical={() =>
                    setSelection({ activity: selection.activity })
                  }
                />
              )}
            </div>
          )}
          {tab === "影响" && <ImpactView repos={r.source_repos} />}
          {tab === "覆盖" && <CoverageView registry={r} onOpenWorkflow={openWorkflow} />}
          {tab === "验证" && (
            <section className="mb-5 rounded-xl border p-4">
              <h2 className="mb-3 font-semibold">
                全量登记缺口 · {r.gaps.length}
              </h2>
              {r.gaps.map((gap, i) => (
                <p key={i} className="break-all text-sm">
                  {gap.entity_type} / {gap.entity_id} · {gap.code}
                </p>
              ))}
              {!r.gaps.length && <p>当前未返回登记缺口。</p>}
            </section>
          )}
          {(tab === "运行" || tab === "发布" || tab === "验证") && (
            <EvidenceView
              key={`${tab}:${workflow}`}
              mode={tab}
              workflow={workflow}
              workflows={r.workflows}
              onOpenWorkflow={openWorkflow}
            />
          )}
          {!r.workflows.length && !r.activities.length && (
            <p className="mt-5 rounded border p-5">
              尚无工作流或活动登记。上层组织与未知对象仍保留显示。
            </p>
          )}
        </>
      )}
    </main>
  );
}
