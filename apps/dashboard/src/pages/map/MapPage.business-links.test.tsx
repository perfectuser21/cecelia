import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import MapPage from "@features/core/planning/pages/MapPage";
const registry = { generated_at:"fixture", counts:{}, areas:[], journeys:[],
  workflows:[{id:"wf",key:"known",name:"获客工作流",capability_id:"cap",activities:[]}],
  activities:[],steps:[],enablers:[],gaps:[],source_repos:[] };
function mockApi(mode: "run" | "release" | "release_full") {
  vi.mocked(fetch).mockImplementation(async (url) => {
    const u=String(url);
    const data=u.includes("/registry") ? registry : u.endsWith("/evidence") ? {
      ci_evidence:[{evidence_ref:"ci-receipt",source:{repo:"owner/repo",base_revision:mode === "release_full" ? undefined : "a".repeat(40),head_revision:"b".repeat(40)},
        definition_versions:[{workflow_id:"wf",id:"fixed-wv"}]}], evidence_status:"unknown"
    } : mode==="run" ? {total:2,runs:[
      {id:"legacy",run_id:"legacy-run",workflow_id:"wf",definition_status:"unknown",evidence_status:"unknown"},
      {id:"orphan",run_id:"orphan-run",definition_status:"unknown",evidence_status:"unknown"}]} :
      {total:1,releases:[{id:"release-id",release_key:"release-key",environment:"test",target:"fixture"}]};
    return new Response(JSON.stringify(data));
  });
}
it("运行的明确业务归属可回工作流，旧记录仍保留定义未知，无归属不猜",async()=>{
  mockApi("run");render(<MapPage />);
  fireEvent.click(await screen.findByRole("tab",{name:"运行"}));
  fireEvent.click(await screen.findByRole("button",{name:/orphan-run/}));
  const orphan=await screen.findByRole("article",{name:"证据详情"});
  expect(within(orphan).getByText("工作流归属未知")).toBeInTheDocument();
  expect(within(orphan).queryByRole("button",{name:/查看工作流/})).not.toBeInTheDocument();
  fireEvent.click(await screen.findByRole("button",{name:/legacy-run/}));
  const detail=await screen.findByRole("article",{name:"证据详情"});
  expect(within(detail).getAllByText("unknown")).toHaveLength(2);
  fireEvent.click(within(detail).getByRole("button",{name:"查看工作流：获客工作流"}));
  expect(screen.getByRole("tab",{name:"结构"})).toHaveAttribute("aria-selected","true");
  expect(screen.getByLabelText("工作流")).toHaveValue("wf");
});
it("完整发布回归只有固定目标版本时显示commit，不虚构差异基线",async()=>{
  mockApi("release_full");render(<MapPage />);
  fireEvent.click(await screen.findByRole("tab",{name:"验证"}));
  fireEvent.click(await screen.findByRole("button",{name:"release-key"}));
  const detail=await screen.findByRole("article",{name:"证据详情"});
  expect(within(detail).getByRole("link",{name:"查看固定源码版本"})).toHaveAttribute("href",`https://github.com/owner/repo/commit/${"b".repeat(40)}`);
  expect(within(detail).queryByRole("link",{name:"查看固定源码差异"})).not.toBeInTheDocument();
});
it("已保存CI证据按固定定义反查业务，不把源码比较称为PR",async()=>{
  mockApi("release");render(<MapPage />);
  fireEvent.click(await screen.findByRole("tab",{name:"验证"}));
  fireEvent.click(await screen.findByRole("button",{name:"release-key"}));
  const detail=await screen.findByRole("article",{name:"证据详情"});
  await within(detail).findByText("ci-receipt");
  expect(within(detail).getByText("fixed-wv")).toBeInTheDocument();
  expect(within(detail).getByRole("link",{name:"查看固定源码差异"})).toHaveAttribute("href",`https://github.com/owner/repo/compare/${"a".repeat(40)}...${"b".repeat(40)}`);
  fireEvent.click(within(detail).getByRole("button",{name:"查看工作流：获客工作流"}));
  expect(screen.getByLabelText("工作流")).toHaveValue("wf");
});
