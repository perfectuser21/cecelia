import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import MapPage from "@features/core/planning/pages/MapPage";
const registry = { generated_at:"fixture", counts:{enablers:{total:0}}, areas:[], journeys:[],
  workflows:[{id:"wf",key:"known",name:"已登记工作流",capability_id:"cap",activities:[]}],
  activities:[],steps:[],enablers:[],gaps:[],source_repos:[] };
const sources = [{kind:"skills",title:"Skill 登记",total:232,mapped:1,unknown:230,excluded:1,
  source_revision:null,scope_note:"Skill Registry 全集；不等于 Enabler 集合"}];
const item = {id:"skill-id",name:"同名技能",kind:"skills",coverage_status:"unknown",
  reason:"fixed_identity_missing",record_status:"active",source:null,consumers:[],config:"NEVER_RENDER_SECRET"};
let fail = false;
beforeEach(() => {
  fail=false;
  vi.stubGlobal("fetch",vi.fn(async (url: string) => {
    if(String(url).startsWith("/api/brain/map/registry")) return new Response(JSON.stringify(registry));
    const query = new URL(String(url),"http://fixture").searchParams;
    if(fail) return new Response(JSON.stringify({error:{message:"覆盖数据不可用"}}),{status:503});
    const mapped = query.get("coverage")==="mapped";
    return new Response(JSON.stringify({generated_at:"fixture",sources,
      selection:{kind:query.get("kind"),coverage:query.get("coverage"),limit:20,offset:Number(query.get("offset")),total:mapped?1:230},
      items:[mapped?{...item,coverage_status:"mapped",reason:"explicit_binding",source:{repo:"owner/repo",path:"SKILL.md",revision:"a".repeat(40)},consumers:[{workflow_id:"wf",capability_id:"cap"}]}:item]}));
  }));
});
async function openCoverage(){
  render(<MapPage />);
  fireEvent.click(await screen.findByRole("tab",{name:"覆盖"}));
  return screen.findByRole("region",{name:"库存覆盖清单"});
}
it("显示独立Skill分母、逐项未知与来源缺口，不把active或同名当业务关联",async()=>{
  const region=await openCoverage();
  await within(region).findByText("232");
  expect(within(region).getByText("fixed_identity_missing")).toBeInTheDocument();
  expect(within(region).getByText("Skill Registry 全集；不等于 Enabler 集合")).toBeInTheDocument();
  expect(within(region).getByText("来源版本未知")).toBeInTheDocument();
  expect(screen.queryByText("NEVER_RENDER_SECRET")).not.toBeInTheDocument();
  expect(screen.queryByRole("button",{name:"查看工作流：已登记工作流"})).not.toBeInTheDocument();
  expect(screen.queryByLabelText("平台")).not.toBeInTheDocument();
});
it("分页按来源及关联状态查询，明确消费者能回到业务工作流",async()=>{
  const region=await openCoverage();await within(region).findByText("同名技能");
  fireEvent.click(within(region).getByRole("button",{name:"下一页"}));
  await waitFor(()=>expect(vi.mocked(fetch).mock.calls.some(([u])=>String(u).includes("offset=20"))).toBe(true));
  fireEvent.change(within(region).getByLabelText("关联状态"),{target:{value:"mapped"}});
  fireEvent.click(await within(region).findByRole("button",{name:"查看工作流：已登记工作流"}));
  expect(screen.getByRole("tab",{name:"结构"})).toHaveAttribute("aria-selected","true");
  expect(screen.getByLabelText("工作流")).toHaveValue("wf");
});
it("来源读取失败不显示零库存或伪装为已覆盖",async()=>{
  fail=true;await openCoverage();
  expect(await screen.findByRole("alert")).toHaveTextContent("覆盖数据不可用");
  expect(screen.queryByText("232")).not.toBeInTheDocument();
});
