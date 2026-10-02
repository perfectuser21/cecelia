import { useState } from "react";
import { Gap } from "./model";
import { State } from "./ActivityDetail";
import { ReadState, useRead } from "./useRead";
interface Run {
  id: string;
  run_id: string;
  release_id?: string;
  workflow_id?: string;
  workflow_definition_version_id?: string;
  attempt_key?: string;
  source_kind?: string;
  definition_status?: string;
  record_source?: string;
  evidence_status?: string;
  expected_count?: number;
}
interface Release {
  id: string;
  release_key: string;
  environment: string;
  target: string;
  manifest_sha256?: string;
  verification?: { status?: string; ci_status?: string; gaps?: Gap[] };
  gate?: {
    deployed?: boolean;
    ever_deployed?: boolean;
    current_status?: string;
    gaps?: Gap[];
  };
  workflow_versions?: Array<{
    id: string;
    key: string;
    source_repo: string;
    source_commit: string;
  }>;
}
interface List {
  runs?: Run[];
  releases?: Release[];
  total: number;
  limit: number;
  offset: number;
}
interface Evidence {
  release?: Release;
  components?: Array<{
    kind: string;
    repo: string;
    path?: string;
    revision: string;
    digest?: string;
  }>;
  ci_evidence?: Array<{
    evidence_ref: string;
    source?: { repo: string; base_revision?: string; head_revision: string };
    report_sha256?: string;
    verdict?: string;
    recorded_at?: string;
    definition_versions?: Array<{ id: string; workflow_id: string }>;
    assertions?: Array<{
      assertion_ref: string;
      source_repo: string;
      source_revision: string;
      test_sha256: string;
      exit_code: number;
    }>;
  }>;
  run_id?: string;
  business_outcome?: string;
  evidence_status?: string;
  gaps?: Gap[];
  missing?: Gap[];
  unexpected?: Gap[];
  span_count?: number;
  expected_count?: number;
  duration_ms?: Record<string, number>;
  spans?: Array<{
    id: string;
    activity_id?: string;
    step_id?: string;
    reference_id?: string;
    outcome: string;
    started_at?: string;
    ended_at?: string;
  }>;
  verification?: { status?: string; gaps?: Gap[] };
}
export default function EvidenceView({
  mode,
  workflow,
  workflows = [],
  onOpenWorkflow,
}: {
  mode: "运行" | "发布" | "验证";
  workflow: string;
  workflows?: Array<{ id: string; name: string }>;
  onOpenWorkflow?: (id: string) => void;
}) {
  const [offset, setOffset] = useState(0),
    [selected, setSelected] = useState("");
  const kind = mode === "运行" ? "runs" : "releases";
  const params = new URLSearchParams({
    limit: "20",
    offset: String(offset),
    ...(workflow ? { workflow_id: workflow } : {}),
  });
  const list = useRead<List>(`/api/brain/map/${kind}?${params}`);
  const evidence = useRead<Evidence>(
    selected
      ? `/api/brain/map/${kind}/${encodeURIComponent(selected)}/evidence`
      : null,
  );
  const rows = kind === "runs" ? list.data?.runs : list.data?.releases;
  function businessLink(id?: string) {
    if (!id) return <p className="text-sm">工作流归属未知</p>;
    const flow = workflows.find((w) => w.id === id);
    return <button type="button" disabled={!flow || !onOpenWorkflow}
      aria-label={`查看工作流：${flow?.name || id}`}
      onClick={() => onOpenWorkflow?.(id)}
      className="my-2 text-sm text-blue-700 underline disabled:text-slate-500 dark:text-blue-300">
      {flow?.name || `${id}（需刷新登记）`}
    </button>;
  }
  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">
        {mode === "验证"
          ? "验证证据"
          : mode === "发布"
            ? "发布与实际部署"
            : "运行与证据对账"}
      </h2>
      <ReadState {...list} />
      {list.data && (
        <>
          <p className="text-sm text-slate-500">
            共 {list.data.total} 条 · 当前 {rows?.length || 0} 条
          </p>
          {!rows?.length && (
            <p className="rounded border p-5">
              暂无{mode === "运行" ? "运行" : "发布版本"}记录 · unknown
            </p>
          )}
          <div className="grid gap-3">
            {kind === "runs"
              ? list.data.runs?.map((run) => (
                  <button
                    type="button"
                    key={run.id}
                    onClick={() => setSelected(run.run_id)}
                    className="rounded-xl border bg-white p-4 text-left dark:bg-slate-900"
                  >
                    <span className="font-mono">{run.run_id}</span>
                    <p className="my-2 text-sm">
                      {run.attempt_key} · {run.source_kind} · 预期{" "}
                      {run.expected_count ?? "unknown"} 段
                    </p>
                    <p>
                      <span>定义</span> <State value={run.definition_status} />
                    </p>
                    <p className="my-2">
                      证据 <State value={run.evidence_status} />
                    </p>
                    <p className="text-xs text-slate-500">
                      登记来源：{run.record_source || "unknown"}
                    </p>
                  </button>
                ))
              : list.data.releases?.map((release) => (
                  <article
                    key={release.id}
                    className="rounded-xl border bg-white p-4 dark:bg-slate-900"
                  >
                    <button
                      type="button"
                      className="font-semibold text-blue-700"
                      onClick={() => setSelected(release.id)}
                    >
                      {release.release_key}
                    </button>
                    <p className="my-2 text-sm">
                      {release.environment} · {release.target}
                    </p>
                    <p>
                      定义与 CI <State value={release.verification?.status} />
                    </p>
                    <p className="mt-2">
                      当前部署{" "}
                      <State
                        value={
                          release.gate?.deployed
                            ? "verified"
                            : release.gate?.current_status || "unknown"
                        }
                      />
                    </p>
                    {release.gate?.ever_deployed && !release.gate.deployed && (
                      <p>曾部署，当前未通过实际观测。</p>
                    )}
                    <p className="mt-2 break-all text-xs">
                      发布摘要：{release.manifest_sha256 || "unknown"}
                    </p>
                    {release.workflow_versions?.map((v) => (
                      <p key={v.id} className="text-sm">
                        {v.key} · {v.source_repo} @ {v.source_commit}
                      </p>
                    ))}
                    {[
                      ...(release.verification?.gaps || []),
                      ...(release.gate?.gaps || []),
                    ].map((g, i) => (
                      <p key={i} className="text-sm text-amber-800">
                        {g.code}
                      </p>
                    ))}
                  </article>
                ))}
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              disabled={offset === 0}
              onClick={() => {
                setOffset(Math.max(0, offset - 20));
                setSelected("");
              }}
              className="rounded border p-2 disabled:opacity-40"
            >
              上一页
            </button>
            <button
              type="button"
              disabled={offset + 20 >= list.data.total}
              onClick={() => {
                setOffset(offset + 20);
                setSelected("");
              }}
              className="rounded border p-2 disabled:opacity-40"
            >
              下一页
            </button>
          </div>
        </>
      )}
      <ReadState {...evidence} />
      {evidence.data && (
        <article
          aria-label="证据详情"
          className="rounded-xl border border-blue-200 bg-white p-5 dark:bg-slate-900"
        >
          <h3 className="mb-3 font-semibold">{selected}</h3>
          {mode === "运行" && businessLink(list.data?.runs?.find((r) => r.run_id === selected)?.workflow_id)}
          <div className="flex gap-4">
            <p>
              证据{" "}
              <State
                value={
                  evidence.data.evidence_status ||
                  evidence.data.verification?.status
                }
              />
            </p>
            {mode === "运行" && (
              <p>
                业务结果 <State value={evidence.data.business_outcome} />
              </p>
            )}
          </div>
          {mode === "运行" && (
            <p className="mt-3">
              实际执行段 {evidence.data.span_count ?? 0} / 预期{" "}
              {evidence.data.expected_count ?? "unknown"}
            </p>
          )}
          <h4 className="mt-4 font-semibold">缺口</h4>
          {(evidence.data.gaps || evidence.data.verification?.gaps || []).map(
            (g, i) => (
              <p key={i}>{g.code}</p>
            ),
          )}
          {!!evidence.data.missing?.length && (
            <>
              <h4 className="mt-4 font-semibold">
                缺失执行段 · {evidence.data.missing.length}
              </h4>
              {evidence.data.missing.map((m, i) => (
                <p key={i}>
                  <span>{m.step_id || "Activity"}</span> · {m.reference_id}
                </p>
              ))}
            </>
          )}
          {mode !== "运行" && (
            <>
              <h4 className="mt-4 font-semibold">固定发布组件</h4>
              {evidence.data.components?.map((c, i) => (
                <p key={i} className="break-all text-sm">
                  {c.kind} · {c.repo} / {c.path || "仓库"} @ {c.revision} ·{" "}
                  {c.digest}
                </p>
              ))}
              <h4 className="mt-4 font-semibold">CI 验证断言</h4>
              {evidence.data.ci_evidence?.map((ci, i) => (
                <div key={i} className="mt-3 rounded border p-3">
                  <State value={ci.verdict} />
                  <p>{ci.evidence_ref}</p>
                  <p className="text-xs">
                    {ci.source?.repo} · {ci.source?.base_revision ? `${ci.source.base_revision} → ` : ""}
                    {ci.source?.head_revision}
                  </p>
                  <p className="text-xs">{ci.recorded_at}</p>
                  {ci.source && /^[\w.-]+\/[\w.-]+$/.test(ci.source.repo) &&
                    /^[0-9a-f]{40}$/.test(ci.source.head_revision) && (
                    <a className="text-sm text-blue-700 underline dark:text-blue-300" target="_blank" rel="noreferrer"
                      href={`https://github.com/${ci.source.repo}/${/^[0-9a-f]{40}$/.test(ci.source.base_revision || "") ? `compare/${ci.source.base_revision}...${ci.source.head_revision}` : `commit/${ci.source.head_revision}`}`}>
                      {/^[0-9a-f]{40}$/.test(ci.source.base_revision || "") ? "查看固定源码差异" : "查看固定源码版本"}
                    </a>
                  )}
                  {ci.definition_versions?.map((definition) => <div key={definition.id}>
                    <code className="mr-3 text-xs">{definition.id}</code>{businessLink(definition.workflow_id)}
                  </div>)}
                  {ci.assertions?.map((a, j) => (
                    <p className="break-all text-sm" key={j}>
                      {a.assertion_ref} · exit {a.exit_code} · {a.source_repo} @{" "}
                      {a.source_revision} · {a.test_sha256}
                    </p>
                  ))}
                </div>
              ))}
            </>
          )}
          {mode === "运行" && (
            <h4 className="mt-4 font-semibold">已收到的执行段</h4>
          )}
          {evidence.data.spans?.map((s) => (
            <p key={s.id} className="text-sm">
              {s.step_id || s.activity_id} · {s.outcome} · {s.started_at} →{" "}
              {s.ended_at || "未结束"}
            </p>
          ))}
          {mode === "运行" && !evidence.data.spans?.length && (
            <p>尚无执行段明细。</p>
          )}
          {evidence.data.duration_ms && (
            <p className="mt-3 text-sm">
              总时长 {evidence.data.duration_ms.wall ?? 0} ms；Activity{" "}
              {evidence.data.duration_ms.activity ?? 0} ms；Step{" "}
              {evidence.data.duration_ms.step ?? 0} ms
            </p>
          )}
        </article>
      )}
    </section>
  );
}
