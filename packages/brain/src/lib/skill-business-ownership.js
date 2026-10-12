/** Skill业务归属：只读规范绑定，不按名称或Agent猜能力。 */
import { JOURNEY_ORGANIZATION_SQL } from "./journey-organization.js";
const SHA = /^[a-f0-9]{40}$/,
  HEX = /^[a-f0-9]{64}$/,
  REPO = /^[\w.-]+\/[\w.-]+$/,
  UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const array = (v) => (Array.isArray(v) ? v : []);
const digest = (v) =>
  typeof v === "string" && HEX.test(v.replace(/^sha256:/, ""))
    ? v.replace(/^sha256:/, "")
    : null;
function skillPath(p) {
  if (
    typeof p !== "string" ||
    p.includes("\\") ||
    p.includes("%") ||
    p.startsWith("/")
  )
    return false;
  const parts = p.split("/");
  return (
    parts.at(-1) === "SKILL.md" &&
    parts.every((v) => v && v !== "." && v !== "..") &&
    !parts
      .slice(0, -1)
      .some((v) => ["references", "scripts", "assets"].includes(v))
  );
}
function identity(s) {
  return s &&
    REPO.test(s.repo || "") &&
    SHA.test(s.revision || "") &&
    skillPath(s.path) &&
    digest(s.digest)
    ? {
        repo: s.repo,
        path: s.path,
        revision: s.revision,
        digest: digest(s.digest),
      }
    : null;
}
function sources(row) {
  return [
    row.metadata?.source_identity,
    ...array(row.metadata?.source_identities),
    ...array(row.metadata?.fixed_source_identities),
  ]
    .map(identity)
    .filter((s) => s && s.digest === digest(row.content_digest));
}
const unique = (values) => [
  ...new Map(values.map((v) => [JSON.stringify(v), v])).values(),
];
const nodes = (values) =>
  [...new Map(values.filter((v) => v?.id).map((v) => [v.id, v])).values()].sort(
    (a, b) => String(a.id).localeCompare(String(b.id)),
  );
export const SKILL_BUSINESS_OWNERSHIP_SQL = `SELECT w.id,w.name,w.capability_id,c.name AS capability_name,p.id AS value_stream_id,p.name AS value_stream_name,
 (${JOURNEY_ORGANIZATION_SQL}) AS organization,to_jsonb(v) AS definition,
 COALESCE((SELECT jsonb_agg(jsonb_build_object('reference_id',r.id,'activity_id',r.activity_id,
 'source_ref',r.source_ref,'source_repo',r.source_repo,'source_path',r.source_path,'source_commit',r.source_commit,
 'activity_definition_version_id',r.activity_definition_version_id,'current_definition_version_id',a.current_definition_version_id,'version',to_jsonb(av)) ORDER BY r.sequence_no,r.id)
 FROM workflow_activity_refs r JOIN activities a ON a.id=r.activity_id
 LEFT JOIN activity_definition_versions av ON av.id=r.activity_definition_version_id AND av.activity_id=a.id
 WHERE r.workflow_id=w.id AND r.active),'[]'::jsonb) AS activities
 FROM workflows w JOIN capabilities c ON c.id=w.capability_id
 LEFT JOIN value_streams p ON p.id=c.parent_journey_id AND p.parent_journey_id IS NULL
 LEFT JOIN workflow_definition_versions v ON v.id=w.current_definition_version_id AND v.workflow_id=w.id
 WHERE w.status='active' ORDER BY w.id`;
function validDefinition(w) {
  const d = w.definition;
  return (
    d &&
    d.workflow_id === w.id &&
    d.payload?.workflow_id === w.id &&
    d.payload?.capability_id === w.capability_id &&
    REPO.test(d.source_repo || "") &&
    SHA.test(d.source_commit || "")
  );
}
function validActivity(pins, a) {
  const v = a.version;
  return (
    v &&
    v.id === a.activity_definition_version_id &&
    v.activity_id === a.activity_id &&
    v.payload?.activity_id === a.activity_id &&
    REPO.test(v.source_repo || "") &&
    SHA.test(v.source_commit || "") &&
    pins.get(a.reference_id)?.activity_id === a.activity_id &&
    pins.get(a.reference_id)?.activity_version_id === v.id
  );
}
/** 单条SELECT提供一致关系快照；业务库零写入。 */
export async function readSkillBusinessOwnership(client, registryRows) {
  const result = new Map(
    registryRows.map((r) => [
      r.id,
      {
        areas: [],
        value_streams: [],
        capabilities: [],
        workflows: [],
        paths: [],
        status: "unknown",
        gaps: ["business_relation_missing"],
      },
    ]),
  );
  const ids = new Map(
    registryRows
      .filter((r) => UUID.test(r.id || ""))
      .map((r) => [r.id.toLowerCase(), r.id]),
  );
  const fixed = new Map();
  for (const row of registryRows) {
    for (const source of sources(row)) {
      const key = JSON.stringify(source);
      if (!fixed.has(key)) fixed.set(key, new Set());
      fixed.get(key).add(row.id);
    }
  }
  const { rows } = await client.query(SKILL_BUSINESS_OWNERSHIP_SQL);
  function add(skillId, w, source, evidence) {
    const out = result.get(skillId);
    if (!out) return;
    const effectiveArea = w.organization?.effective_area;
    const area = effectiveArea ? { id: effectiveArea.id, name: effectiveArea.name } : null,
      vs = w.value_stream_id
        ? { id: w.value_stream_id, name: w.value_stream_name }
        : null;
    const gaps = [
      ...array(w.organization?.gaps),
      ...(!vs ? ["value_stream_missing"] : []),
      ...(!area ? ["area_unknown"] : []),
    ];
    out.paths.push({
      area,
      value_stream: vs,
      capability: { id: w.capability_id, name: w.capability_name },
      workflow: { id: w.id, name: w.name },
      source,
      evidence,
      gaps: unique(gaps),
    });
  }
  function explicit(id, w, source, evidence) {
    if (UUID.test(id || ""))
      add(ids.get(id.toLowerCase()), w, source, evidence);
  }
  for (const w of rows) {
    if (!validDefinition(w)) continue;
    const d = w.definition,
      source = {
        repo: d.source_repo,
        path: d.source_path || null,
        revision: d.source_commit,
      };
    explicit(d.payload.contract?.runtime?.skill_id, w, source, {
      kind: "workflow_skill_uuid",
      workflow_definition_version_id: d.id,
    });
    const pins = new Map();
    for (const ref of array(d.payload.activities)) {
      // Ambiguous duplicate references cannot supply a canonical identity.
      pins.set(ref.reference_id, pins.has(ref.reference_id) ? null : ref);
    }
    for (const a of array(w.activities)) {
      if (!validActivity(pins, a)) continue;
      const v = a.version,
        evidence = {
          reference_id: a.reference_id,
          activity_id: a.activity_id,
          activity_definition_version_id: v.id,
          workflow_definition_version_id: d.id,
          source_ref: a.source_ref || null,
          reference_source: {
            repo: a.source_repo || null,
            path: a.source_path || null,
            revision: a.source_commit || null,
          },
        };
      explicit(
        v.payload.contract?.implementation?.kind === "skill"
          ? v.payload.contract.implementation.skill_id
          : null,
        w,
        {
          repo: v.source_repo,
          path: v.source_path || null,
          revision: v.source_commit,
        },
        { ...evidence, kind: "activity_skill_uuid" },
      );
      explicit(
        v.payload.contract?.workflow_authoring?.runtime?.skill_id,
        w,
        {
          repo: v.source_repo,
          path: v.source_path || null,
          revision: v.source_commit,
        },
        { ...evidence, kind: "authoring_runtime_skill_uuid" },
      );
      for (const b of array(v.payload.implementation_bindings)) {
        if (
          b.kind !== "skill" ||
          b.status !== "verified" ||
          b.validation_scope !== "reference_only"
        )
          continue;
        const s = identity(b);
        if (!s) continue;
        for (const id of fixed.get(JSON.stringify(s)) || [])
            add(
              id,
              w,
              { ...s, digest: `sha256:${s.digest}` },
              { ...evidence, kind: "fixed_skill_source" },
            );
      }
    }
  }
  for (const out of result.values()) {
    out.paths = unique(out.paths).sort((a, b) =>
      JSON.stringify(a).localeCompare(JSON.stringify(b)),
    );
    if (!out.paths.length) continue;
    out.areas = nodes(out.paths.map((p) => p.area));
    out.value_streams = nodes(out.paths.map((p) => p.value_stream));
    out.capabilities = nodes(out.paths.map((p) => p.capability));
    out.workflows = nodes(out.paths.map((p) => p.workflow));
    out.gaps = [...new Set(out.paths.flatMap((p) => p.gaps))].sort();
    out.status = out.gaps.length
      ? "partial"
      : out.workflows.length > 1
        ? "shared"
        : "mapped";
  }
  return result;
}
