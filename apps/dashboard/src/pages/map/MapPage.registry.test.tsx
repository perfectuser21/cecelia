import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import MapPage from "@features/core/planning/pages/MapPage";
const usage = (reference_id: string) => ({
  activity_id: "shared",
  name: "共享预检",
  canonical_id: "shared",
  usage: { reference_id, slot_key: "preflight", sequence_no: 1,activity_definition_version_id:"av-shared" },
  steps: [{ id: "step-1", key: "lock", name: "设备锁" }],
});
const registry = {
  generated_at: "2026-10-02T00:00:00Z",
  counts: {
    areas: { total: 1 },
    value_streams: { total: 1 },
    capabilities: { total: 1 },
    workflows: { total: 2, versioned: 2 },
    activities: { total: 2, referenced: 1, usage_count: 2, unknown: 1 },
    steps: { total: 1 },
    enablers: { total: 0 },
    legacy_features: { total: 7 },
  },
  areas: [{ id: "area", name: "增长部门" }],
  journeys: [
    {
      id: "vs",
      name: "客户获取",
      role: "value_stream",
      organization: { effective_area: { id: "area" } },
    },
    {
      id: "cap",
      name: "获客能力",
      role: "capability",
      parent_journey_id: "vs",
      organization: { effective_area: { id: "area" } },
    },
  ],
  workflows: [
    {
      id: "kw",
      key: "keyword",
      name: "关键词流程",
      capability_id: "cap",
      activities: [usage("ref-kw")],
    },
    {
      id: "bm",
      key: "benchmark",
      name: "对标流程",
      capability_id: "cap",
      activities: [usage("ref-bm")],
    },
  ],
  activities: [
    {
      id: "shared",
      name: "共享预检",
      definition_status: "versioned",
      current_definition_version_id:"av-shared",
      consumers: [
        { workflow_id: "kw", reference_id: "ref-kw" },
        { workflow_id: "bm", reference_id: "ref-bm" },
      ],
      implementation_bindings: [
        {
          kind: "code",
          repo: "owner/repo-a",
          path: "runner.sh",
          revision: "a".repeat(40),
          status: "verified",
        },
      ],
    },
    {
      id: "orphan",
      name: "历史孤立活动",
      definition_status: "unknown",
      consumers: [],
      implementation_bindings: [],
    },
  ],
  steps: [{ id: "step-1", activity_id: "shared", key: "lock" }],
  enablers: [],
  gaps: [
    {
      entity_type: "activity",
      entity_id: "orphan",
      code: "definition_unknown",
    },
  ],
  source_repos: ["owner/repo-a", "owner/repo-b"],
};
const json = (body: unknown) =>
  ({ ok: true, json: async () => body }) as Response;
beforeEach(() => {
  vi.mocked(fetch).mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes("/registry")) return json(registry);
    if (url.includes("/runs/run-1/evidence"))
      return json({
        run_id: "run-1",
        evidence_status: "incomplete",
        business_outcome: "unknown",
        missing: [{ step_id: "step-1", reference_id: "ref-kw" }],
        gaps: [{ code: "EXPECTED_SPAN_MISSING" }],
        unexpected: [],
        span_count: 1,
        expected_count: 2,
        spans: [],
      });
    if (url.includes("/runs?"))
      return json({
        runs: [
          {
            id: "binding-1",
            run_id: "run-1",
            workflow_id: "kw",
            attempt_key: "a1",
            evidence_status: "not_assessed",
          },
        ],
        total: 1,
        limit: 20,
        offset: 0,
      });
    if (url.includes("/implementation-impact"))
      return json({
        mapping_status: "unknown",
        gaps: [{ code: "SOURCE_UNKNOWN" }],
        required_assertions: [],
        affected_usages: [],
      });
    return json({
      scope_key: "cecelia",
      fact_revisions: {},
      freshness: { status: "fresh" },
      summary: {},
      nodes: [],
      edges: [],
      shared_prerequisites: { applicable: false },
    });
  });
});
it("默认全体系：共享活动两位置同规范ID，历史无引用活动与unknown都可见", async () => {
  render(<MapPage />);
  expect(
    await screen.findByRole("heading", { name: "能力系统" }),
  ).toBeInTheDocument();
  expect(
    await screen.findByRole("heading", { name: "增长部门" }),
  ).toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: /共享预检/ })).toHaveLength(2);
  expect(screen.getByText("历史孤立活动")).toBeInTheDocument();
  expect(screen.getAllByText(/unknown/).length).toBeGreaterThan(0);
  fireEvent.click(screen.getAllByRole("button", { name: /共享预检/ })[1]);
  const panel = screen.getByRole("region", { name: "活动详情" });
  expect(within(panel).getByText("shared")).toBeInTheDocument();
  expect(within(panel).getAllByText("ref-bm")).toHaveLength(2);
  expect(within(panel).getByText("关键词流程")).toBeInTheDocument();
  expect(within(panel).getByText("对标流程")).toBeInTheDocument();
  expect(within(panel).getByText("runner.sh")).toBeInTheDocument();
});
it("运行对账保留incomplete与缺Step，不把单个成功span显示成全流程通过", async () => {
  render(<MapPage />);
  await screen.findByRole("heading", { name: "增长部门" });
  fireEvent.click(screen.getByRole("tab", { name: "运行" }));
  fireEvent.click(await screen.findByRole("button", { name: /run-1/ }));
  expect(await screen.findByText("incomplete")).toBeInTheDocument();
  expect(screen.getByText("EXPECTED_SPAN_MISSING")).toBeInTheDocument();
  expect(screen.getByText("step-1")).toBeInTheDocument();
});
it("影响分析必须明确选择来源仓库，切换仓库使用对应查询参数", async () => {
  render(<MapPage />);
  await screen.findByRole("heading", { name: "增长部门" });
  fireEvent.click(screen.getByRole("tab", { name: "影响" }));
  fireEvent.change(screen.getByLabelText("来源仓库"), {
    target: { value: "owner/repo-b" },
  });
  fireEvent.change(screen.getByLabelText("基线 SHA"), {
    target: { value: "a".repeat(40) },
  });
  fireEvent.change(screen.getByLabelText("目标 SHA"), {
    target: { value: "b".repeat(40) },
  });
  fireEvent.change(screen.getByLabelText("变更文件"), {
    target: { value: "runner.sh" },
  });
  fireEvent.click(screen.getByRole("button", { name: "查询影响" }));
  await waitFor(() =>
    expect(
      vi
        .mocked(fetch)
        .mock.calls.some(([url]) =>
          String(url).includes("repo=owner%2Frepo-b"),
        ),
    ).toBe(true),
  );
  expect(await screen.findByText("SOURCE_UNKNOWN")).toBeInTheDocument();
});
it("来源切换取消旧结果语义，慢返回的旧仓库报告不能污染新选择", async () => {
  let finish: (value: Response) => void = () => {};
  const original = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation((input, init) =>
    String(input).includes("/implementation-impact")
      ? new Promise<Response>((resolve) => {
          finish = resolve;
        })
      : original(input, init),
  );
  render(<MapPage />);
  await screen.findByRole("heading", { name: "增长部门" });
  fireEvent.click(screen.getByRole("tab", { name: "影响" }));
  fireEvent.change(screen.getByLabelText("来源仓库"), {
    target: { value: "owner/repo-a" },
  });
  fireEvent.change(screen.getByLabelText("基线 SHA"), {
    target: { value: "a".repeat(40) },
  });
  fireEvent.change(screen.getByLabelText("目标 SHA"), {
    target: { value: "b".repeat(40) },
  });
  fireEvent.change(screen.getByLabelText("变更文件"), {
    target: { value: "runner.sh" },
  });
  fireEvent.click(screen.getByRole("button", { name: "查询影响" }));
  fireEvent.change(screen.getByLabelText("来源仓库"), {
    target: { value: "owner/repo-b" },
  });
  finish(
    json({ mapping_status: "verified", gaps: [{ code: "OLD_REPO_REPORT" }] }),
  );
  await waitFor(() =>
    expect(screen.queryByText("读取中…")).not.toBeInTheDocument(),
  );
  expect(screen.queryByText("OLD_REPO_REPORT")).not.toBeInTheDocument();
});
it("旧Feature切换保留独立名称与旧查询协议，新登记失败有明确错误", async () => {
  vi.mocked(fetch).mockResolvedValueOnce({
    ok: false,
    status: 503,
    json: async () => ({ error: { message: "登记读取失败" } }),
  } as Response);
  render(<MapPage />);
  expect(await screen.findByRole("alert")).toHaveTextContent("登记读取失败");
  fireEvent.click(screen.getByRole("button", { name: "旧 Feature 地图" }));
  expect(
    await screen.findByRole("heading", { name: "Feature 地图" }),
  ).toBeInTheDocument();
  expect(screen.queryByRole("tab", { name: "结构" })).not.toBeInTheDocument();
});
it("未知层级Journey中的Workflow仍进入未归属组，不能被全集结构遗漏", async () => {
  const data = structuredClone(registry);
  data.journeys.push({
    id: "unknown-cap",
    name: "待整理归属",
    role: "unknown",
    organization: { effective_area: { id: "missing-area" } },
  } as (typeof data.journeys)[number]);
  data.workflows.push({
    id: "unmapped-workflow",
    key: "unmapped",
    name: "未知组织工作流",
    capability_id: "unknown-cap",
    activities: [usageForUnknown()],
  });
  vi.mocked(fetch).mockResolvedValue({
    ok: true,
    json: async () => data,
  } as Response);
  render(<MapPage />);
  await waitFor(() =>
    expect(
      document.querySelector('[data-reference-id="ref-unknown"]'),
    ).not.toBeNull(),
  );
  function usageForUnknown() {
    return {
      ...registry.workflows[0].activities[0],
      usage: {
        reference_id: "ref-unknown",
        slot_key: "preflight",
        sequence_no: 1,
      },
    };
  }
});
it("发布证据展示固定组件与CI断言，unknown发布不会显示当前已验证", async () => {
  const original = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.includes("/releases/release-1/evidence"))
      return json({
        verification: { status: "unknown", gaps: [{ code: "CI_UNKNOWN" }] },
        components: [
          {
            kind: "code",
            repo: "owner/repo-a",
            path: "fixed.sh",
            revision: "c".repeat(40),
          },
        ],
        ci_evidence: [
          {
            evidence_ref: "ci-ref",
            verdict: "PASS",
            source: {
              repo: "owner/repo-a",
              base_revision: "a".repeat(40),
              head_revision: "b".repeat(40),
            },
            assertions: [
              {
                assertion_ref: "tests/regression.test.js",
                exit_code: 0,
                source_repo: "owner/repo-a",
                source_revision: "b".repeat(40),
                test_sha256: "d".repeat(64),
              },
            ],
          },
        ],
      });
    if (url.includes("/releases?"))
      return json({
        releases: [
          {
            id: "release-1",
            release_key: "发布一",
            environment: "scratch",
            target: "fixture-host",
            verification: { status: "unknown" },
            gate: { deployed: false, current_status: "unknown", gaps: [] },
          },
        ],
        total: 1,
      });
    return original(input, init);
  });
  render(<MapPage />);
  await screen.findByRole("heading", { name: "增长部门" });
  fireEvent.click(screen.getByRole("tab", { name: "验证" }));
  fireEvent.click(await screen.findByRole("button", { name: "发布一" }));
  expect(await screen.findByText("CI_UNKNOWN")).toBeInTheDocument();
  expect(screen.getByText(/fixed.sh/)).toBeInTheDocument();
  expect(screen.getByText(/tests\/regression.test.js/)).toBeInTheDocument();
  expect(screen.queryByText("verified")).not.toBeInTheDocument();
});
it("无Workflow历史活动下仍可下钻全部规范Step，内容hash不冒充来源核验", async () => {
  const data = structuredClone(registry);
  data.steps.push({
    id: "historic-step",
    activity_id: "orphan",
    key: "historic.step",
    content_hash_verified: true,
    source_verified: false,
  } as (typeof data.steps)[number]);
  vi.mocked(fetch).mockResolvedValue(json(data));
  render(<MapPage />);
  fireEvent.click(await screen.findByRole("button", { name: "历史孤立活动" }));
  const detail = screen.getByRole("region", { name: "活动详情" });
  expect(within(detail).getByText("historic.step")).toBeInTheDocument();
  expect(within(detail).getByText(/来源 unknown/)).toBeInTheDocument();
  expect(within(detail).getByText(/内容 verified/)).toBeInTheDocument();
});
it("平台与终端只按规范channel/form筛选，缺值保留unknown选项", async () => {
  const data = structuredClone(registry);
  Object.assign(data.workflows[0], { channel: "douyin", form: "phone" });
  Object.assign(data.workflows[1], { channel: "wechat", form: null });
  vi.mocked(fetch).mockResolvedValue(json(data));
  render(<MapPage />);
  await screen.findByRole("heading", { name: "增长部门" });
  fireEvent.change(screen.getByLabelText("平台"), {
    target: { value: "douyin" },
  });
  expect(document.querySelector('[data-reference-id="ref-kw"]')).not.toBeNull();
  expect(document.querySelector('[data-reference-id="ref-bm"]')).toBeNull();
  fireEvent.change(screen.getByLabelText("平台"), { target: { value: "" } });
  fireEvent.change(screen.getByLabelText("终端"), {
    target: { value: "unknown" },
  });
  expect(document.querySelector('[data-reference-id="ref-bm"]')).not.toBeNull();
  expect(document.querySelector('[data-reference-id="ref-kw"]')).toBeNull();
  fireEvent.click(screen.getByRole("tab", { name: "影响" }));
  expect(screen.queryByLabelText("部门")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("平台")).not.toBeInTheDocument();
});
it("实现视图部门筛选实际生效，证据视图只显示Workflow筛选", async () => {
  render(<MapPage />);
  await screen.findByRole("heading", { name: "增长部门" });
  fireEvent.click(screen.getByRole("tab", { name: "实现" }));
  fireEvent.change(screen.getByLabelText("部门"), {
    target: { value: "unknown" },
  });
  expect(
    screen.getByRole("button", { name: /历史孤立活动/ }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /共享预检/ }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("tab", { name: "运行" }));
  expect(screen.queryByLabelText("部门")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("搜索")).not.toBeInTheDocument();
  expect(screen.getByLabelText("工作流")).toBeInTheDocument();
});
it("无定义版本的仓库仍可显式输入影响查询，由API返回unknown", async () => {
  render(<MapPage />);
  await screen.findByRole("heading", { name: "增长部门" });
  fireEvent.click(screen.getByRole("tab", { name: "影响" }));
  fireEvent.change(screen.getByLabelText("来源仓库"), {
    target: { value: "new-owner/unversioned-repo" },
  });
  fireEvent.change(screen.getByLabelText("基线 SHA"), {
    target: { value: "a".repeat(40) },
  });
  fireEvent.change(screen.getByLabelText("目标 SHA"), {
    target: { value: "b".repeat(40) },
  });
  fireEvent.change(screen.getByLabelText("变更文件"), {
    target: { value: "new.js" },
  });
  fireEvent.click(screen.getByRole("button", { name: "查询影响" }));
  await waitFor(() =>
    expect(
      vi
        .mocked(fetch)
        .mock.calls.some(([url]) =>
          String(url).includes("repo=new-owner%2Funversioned-repo"),
        ),
    ).toBe(true),
  );
});
it('无固定版本的使用位置保持unknown，不借共享Activity当前版本冒充固定引用',async()=>{
 const data=structuredClone(registry);Object.assign(data.activities[0],{current_definition_version_id:'canonical-current-av'});Object.assign(data.workflows[0].activities[0].usage,{activity_definition_version_id:null});vi.mocked(fetch).mockResolvedValue(json(data));
 render(<MapPage/>);await screen.findByRole('heading',{name:'增长部门'});fireEvent.click(screen.getAllByRole('button',{name:/共享预检/})[0]);const detail=screen.getByRole('region',{name:'活动详情'});expect(within(detail).getByText(/固定定义版本：unknown/)).toBeInTheDocument();expect(within(detail).queryByText('canonical-current-av')).not.toBeInTheDocument();expect(within(detail).queryByText('runner.sh')).not.toBeInTheDocument();
});
