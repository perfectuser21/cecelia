import { useState, useRef, useEffect } from "react";
import { Gap, getJson } from "./model";
import { State } from "./ActivityDetail";
interface Report {
  mapping_status?: string;
  gaps?: Gap[];
  affected_usages?: Array<{
    workflow_id?: string;
    reference_id?: string;
    activity_id?: string;
  }>;
  required_assertions?: Array<{ assertion_ref?: string; source_repo?: string }>;
  truncated?: boolean;
}
export default function ImpactView({ repos }: { repos: string[] }) {
  const [repo, setRepo] = useState(""),
    [scope, setScope] = useState("cecelia"),
    [base, setBase] = useState(""),
    [head, setHead] = useState(""),
    [files, setFiles] = useState("");
  const sequence = useRef(0);
  useEffect(
    () => () => {
      sequence.current++;
    },
    [],
  );
  const [report, setReport] = useState<Report | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  function invalidate() {
    sequence.current++;
    setReport(null);
    setLoading(false);
    setError("");
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const requestId = ++sequence.current;
    setError("");
    setReport(null);
    if (
      !repo ||
      !scope ||
      !files.trim() ||
      ![base, head].every((s) => /^[0-9a-f]{40}$/.test(s))
    ) {
      setError("请选择来源仓库并填写 scope、两个固定 40 位 SHA 与变更文件。");
      return;
    }
    setLoading(true);
    try {
      const params = new URLSearchParams({
        scope,
        repo,
        base_revision: base,
        head_revision: head,
        changed_files: JSON.stringify(
          files
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean),
        ),
      });
      const result = await getJson<Report>(
        `/api/brain/map/implementation-impact?${params}`,
      );
      if (requestId === sequence.current) setReport(result);
    } catch (e) {
      if (requestId === sequence.current) setError((e as Error).message);
    } finally {
      if (requestId === sequence.current) setLoading(false);
    }
  }
  return (
    <section className="rounded-xl border bg-white p-5 dark:bg-slate-900">
      <h2 className="mb-2 text-lg font-semibold">固定源码影响分析</h2>
      <p className="mb-4 text-sm text-slate-500">
        选择明确仓库与两个版本，查询消费者和必跑断言。
      </p>
      <form onSubmit={submit} className="grid gap-3 md:grid-cols-2">
        <label>
          来源仓库
          <input
            aria-label="来源仓库"
            list="impact-repositories"
            value={repo}
            onChange={(e) => {
              setRepo(e.target.value);
              invalidate();
            }}
            placeholder="owner/repository"
            className="block w-full rounded border p-2"
          />
          <datalist id="impact-repositories">
            {repos.map((r) => (
              <option key={r} value={r} />
            ))}
          </datalist>
        </label>
        <label>
          Scope
          <input
            aria-label="Scope"
            value={scope}
            onChange={(e) => {
              setScope(e.target.value);
              invalidate();
            }}
            className="block w-full rounded border p-2"
          />
        </label>
        <label>
          基线 SHA
          <input
            aria-label="基线 SHA"
            value={base}
            onChange={(e) => {
              setBase(e.target.value);
              invalidate();
            }}
            className="block w-full rounded border p-2"
          />
        </label>
        <label>
          目标 SHA
          <input
            aria-label="目标 SHA"
            value={head}
            onChange={(e) => {
              setHead(e.target.value);
              invalidate();
            }}
            className="block w-full rounded border p-2"
          />
        </label>
        <label className="md:col-span-2">
          变更文件
          <textarea
            aria-label="变更文件"
            value={files}
            onChange={(e) => {
              setFiles(e.target.value);
              invalidate();
            }}
            placeholder="每行一个仓库相对路径"
            className="block w-full rounded border p-2"
          />
        </label>
        <button
          disabled={loading}
          type="submit"
          className="rounded bg-blue-600 px-4 py-2 text-white"
        >
          {loading ? "读取中…" : "查询影响"}
        </button>
      </form>
      {error && (
        <p role="alert" className="mt-3 text-red-700">
          {error}
        </p>
      )}
      {report && (
        <div className="mt-5 space-y-3">
          <State value={report.mapping_status} />
          {report.truncated && <p>结果被截断 · incomplete</p>}
          <h3>缺口</h3>
          {report.gaps?.map((g, i) => (
            <p key={i}>{g.code}</p>
          ))}
          <h3>受影响使用位置 · {report.affected_usages?.length || 0}</h3>
          {report.affected_usages?.map((u, i) => (
            <p key={i} className="break-all text-sm">
              {u.workflow_id} / {u.reference_id} / {u.activity_id}
            </p>
          ))}
          <h3>必跑断言 · {report.required_assertions?.length || 0}</h3>
          {report.required_assertions?.map((a, i) => (
            <p key={i}>
              {a.source_repo} · {a.assertion_ref}
            </p>
          ))}
        </div>
      )}
    </section>
  );
}
