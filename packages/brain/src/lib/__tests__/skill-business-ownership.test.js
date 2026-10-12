import { describe, it, expect, vi } from "vitest";
import { readSkillBusinessOwnership } from "../skill-business-ownership.js";
const skill = "11111111-1111-4111-8111-111111111111",
  sha = "a".repeat(40),
  digest = "b".repeat(64);
const binding = {
  kind: "skill",
  status: "verified",
  validation_scope: "reference_only",
  repo: "perfectuser21/zenithjoy-skills",
  path: "publish/SKILL.md",
  revision: sha,
  digest: `sha256:${digest}`,
};
const registry = {
  id: skill,
  name: "publish",
  content_digest: digest,
  metadata: {
    source_identity: {
      repo: binding.repo,
      path: binding.path,
      revision: sha,
      digest: binding.digest,
    },
  },
};
function workflow(overrides = {}) {
  return {
    id: "w1",
    name: "发布",
    capability_id: "c1",
    capability_name: "发布能力",
    value_stream_id: "v1",
    value_stream_name: "内容生产",
    definition: {
      id: "wv1",
      workflow_id: "w1",
      source_repo: binding.repo,
      source_commit: sha,
      payload: {
        workflow_id: "w1",
        capability_id: "c1",
        activities: [
          { reference_id: "r1", activity_id: "a1", activity_version_id: "av1" },
        ],
        contract: {},
      },
    },
    organization: {
      effective_area: { id: "area1", name: "新媒体部" },
      gaps: [],
    },
    activities: [
      {
        reference_id: "r1",
        activity_id: "a1",
        activity_definition_version_id: "av1",
        current_definition_version_id: "av1",
        version: {
          id: "av1",
          activity_id: "a1",
          source_repo: binding.repo,
          source_commit: sha,
          payload: {
            activity_id: "a1",
            implementation_bindings: [binding],
            contract: {},
          },
        },
      },
    ],
    ...overrides,
  };
}
async function read(rows, skills = [registry]) {
  const db = { query: vi.fn().mockResolvedValue({ rows }) };
  return { out: await readSkillBusinessOwnership(db, skills), db };
}
describe("业务归属来自规范身份", () => {
  it("单次只读查询，继承完整业务链", async () => {
    const { out, db } = await read([workflow()]);
    expect(db.query).toHaveBeenCalledTimes(1);
    expect(out.get(skill)).toMatchObject({
      status: "mapped",
      areas: [{ id: "area1", name: "新媒体部" }],
      capabilities: [{ id: "c1", name: "发布能力" }],
    });
    expect(out.get(skill).paths[0].source).toMatchObject({
      repo: binding.repo,
      path: binding.path,
      revision: sha,
    });
  });
  it("名称、本地路径、agent均不能替代规范身份", async () => {
    const { out } = await read(
      [workflow()],
      [
        {
          id: skill,
          name: "publish",
          source_path: "/skills/publish/SKILL.md",
          assigned_agents: ["media"],
          content_digest: digest,
        },
      ],
    );
    expect(out.get(skill).status).toBe("unknown");
  });
  it.each(["revision", "digest", "repo", "path"])(
    "固定身份%s漂移不匹配",
    async (key) => {
      const r = structuredClone(registry);
      r.metadata.source_identity[key] = key === "path" ? "other/SKILL.md" : "z";
      expect((await read([workflow()], [r])).out.get(skill).paths).toEqual([]);
    },
  );
  it.each([
    "../publish/SKILL.md",
    "publish/../SKILL.md",
    "/publish/SKILL.md",
    "publish/catalog.json",
    "publish/references/SKILL.md",
  ])("拒绝非规范根文档 %s", async (path) => {
    const r = structuredClone(registry),
      w = workflow();
    r.metadata.source_identity.path = path;
    w.activities[0].version.payload.implementation_bindings = [
      { ...binding, path },
    ];
    expect((await read([w], [r])).out.get(skill).paths).toEqual([]);
  });
  it("旧活动版本不能继承", async () => {
    const w = workflow();
    w.activities[0].current_definition_version_id = "new";
    expect((await read([w])).out.get(skill).paths).toEqual([]);
  });
  it("引用版本不一致不能继承", async () => {
    const w = workflow();
    w.definition.payload.activities[0].activity_version_id = "old";
    expect((await read([w])).out.get(skill).paths).toEqual([]);
  });
  it("binding非verified或非reference_only不能继承", async () => {
    for (const delta of [
      { status: "unknown" },
      { validation_scope: "executed" },
    ]) {
      const w = workflow();
      w.activities[0].version.payload.implementation_bindings = [
        { ...binding, ...delta },
      ];
      expect((await read([w])).out.get(skill).paths).toEqual([]);
    }
  });
  it("来源提交与AV不一致不能继承", async () => {
    const w = workflow();
    w.activities[0].version.source_commit = "c".repeat(40);
    expect((await read([w])).out.get(skill).paths).toEqual([]);
  });
  it("显式UUID可继承，不要求名字匹配", async () => {
    const w = workflow();
    w.definition.payload.contract.runtime = { skill_id: skill };
    expect(
      (await read([w], [{ id: skill, name: "another" }])).out.get(skill).status,
    ).toBe("mapped");
  });
  it("缺部门保能力和流程，明确待核", async () => {
    const w = workflow({
      organization: { effective_area: null, gaps: ["area_unknown"] },
    });
    const row = (await read([w])).out.get(skill);
    expect(row.status).toBe("partial");
    expect(row.capabilities).toHaveLength(1);
    expect(row.gaps).toContain("area_unknown");
  });
  it("没有消费者明确待归属", async () => {
    expect((await read([])).out.get(skill)).toMatchObject({
      status: "unknown",
      paths: [],
      gaps: ["business_relation_missing"],
    });
  });
  it("跨流程共享保完整路径并去重", async () => {
    const first = workflow(),
      second = structuredClone(first);
    second.id = "w2";
    second.definition.workflow_id = "w2";
    second.definition.payload.workflow_id = "w2";
    second.capability_id = "c2";
    second.capability_name = "另能力";
    second.definition.payload.capability_id = "c2";
    second.organization.effective_area = { id: "area2", name: "另部门" };
    const row = (await read([first, second, first])).out.get(skill);
    expect(row.status).toBe("shared");
    expect(row.paths).toHaveLength(2);
    expect(row.areas).toHaveLength(2);
  });
  it("相同bytes多个已验证固定revision支持共享引用", async () => {
    const r = structuredClone(registry),
      w = workflow();
    const next = "c".repeat(40);
    r.metadata.fixed_source_identities = [
      { ...r.metadata.source_identity, revision: next },
    ];
    w.activities[0].version.source_commit = next;
    w.activities[0].version.payload.implementation_bindings = [
      { ...binding, revision: next },
    ];
    expect((await read([w], [r])).out.get(skill).status).toBe("mapped");
  });
  it("固定元数据digest不能替代实际canonical内容digest", async () => {
    const r = { ...registry, content_digest: "d".repeat(64) };
    expect((await read([workflow()], [r])).out.get(skill).status).toBe(
      "unknown",
    );
  });
  it("工作流定义capability或source缺失不能继承UUID", async () => {
    for (const key of ["source_commit", "workflow_id"]) {
      const w = workflow();
      w.definition[key] = "wrong";
      w.definition.payload.contract.runtime = { skill_id: skill };
      expect((await read([w])).out.get(skill).paths).toEqual([]);
    }
  });
  it("缺父价值流保能力并明确partial", async () => {
    const row = (
      await read([workflow({ value_stream_id: null, value_stream_name: null })])
    ).out.get(skill);
    expect(row.status).toBe("partial");
    expect(row.capabilities).toHaveLength(1);
    expect(row.gaps).toContain("value_stream_missing");
  });
  it("活动明确UUID与非规范字符串隔离", async () => {
    const w = workflow();
    w.activities[0].version.payload.contract.implementation = {
      kind: "skill",
      skill_id: skill,
    };
    expect((await read([w], [{ id: skill }])).out.get(skill).status).toBe(
      "mapped",
    );
    w.activities[0].version.payload.contract.implementation.skill_id =
      "publish";
    expect((await read([w], [{ id: skill }])).out.get(skill).status).toBe(
      "unknown",
    );
  });
});
