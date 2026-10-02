import { render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import ActivityDetail from "@features/core/planning/pages/capability-system/ActivityDetail";
import MapPage from "@features/core/planning/pages/MapPage";
import EvidenceView from "@features/core/planning/pages/capability-system/EvidenceView";

it("展示固定 Step 实现归属且区分引用核验与业务执行", () => {
  const activity = {
    id: "a",
    name: "预检",
    consumers: [],
    implementation_bindings: [
      {
        kind: "code",
        path: "lock.sh",
        status: "verified",
        scope: "step",
        step_key: "lock",
        step_id: "step-lock",
        validation_scope: "reference_only",
      },
    ],
  };
  render(
    <ActivityDetail
      selection={{ activity }}
      registry={{ gaps: [], workflows: [], steps: [] } as never}
    />,
  );
  expect(screen.getByText("所属 Step：lock · step-lock")).toBeInTheDocument();
  expect(
    screen.getByText("引用已核验；业务执行结果见运行证据。"),
  ).toBeInTheDocument();
});

it("旧运行记录明确标记定义未知并保留原始登记来源", async () => {
  vi.mocked(fetch).mockResolvedValue({
    ok: true,
    json: async () => ({
      runs: [
        {
          id: "old-run",
          run_id: "old-run",
          definition_status: "unknown",
          evidence_status: "unknown",
          record_source: "task_runs",
          expected_count: null,
        },
      ],
      total: 1,
    }),
  } as Response);
  render(<EvidenceView mode="运行" workflow="" />);
  const row = await screen.findByRole("button", { name: /old-run/ });
  expect(within(row).getByText("定义")).toBeInTheDocument();
  expect(within(row).getByText("登记来源：task_runs")).toBeInTheDocument();
  expect(within(row).getAllByText("unknown")).toHaveLength(2);
});

it("地图类型按钮在深色主题继承明确文字色且有选中语义", () => {
  vi.mocked(fetch).mockImplementation(() => new Promise(() => {}));
  render(<MapPage />);
  const navigation = screen.getByRole("navigation", { name: "地图类型" });
  expect(navigation).toHaveClass("dark:text-slate-100");
  expect(
    within(navigation).getByRole("button", { name: "能力系统" }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(
    within(navigation).getByRole("button", { name: "旧 Feature 地图" }),
  ).toHaveAttribute("aria-pressed", "false");
});
