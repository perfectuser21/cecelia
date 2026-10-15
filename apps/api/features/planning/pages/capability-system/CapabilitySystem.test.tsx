import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import CapabilitySystem from './CapabilitySystem';
const registry = { generated_at:'preview', counts:{}, areas:[], journeys:[], source_repos:[], enablers:[], gaps:[], steps:[], workflows:[{ id:'w1', key:'workflow', name:'无副作用样板', current_definition_version_id:'wv1', activities:[] }], activities:[{id:'a1',name:'读取样板',current_definition_version_id:'av1',definition_status:'active',consumers:[]}] };
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('在现有目录原位选择工作流和活动，分别向后端核对固定版本资格', async () => {
  const bodies: unknown[] = [];
  vi.stubGlobal('fetch',vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes('/map/registry')) return new Response(JSON.stringify(registry));
    const body = JSON.parse(String(init?.body)); bodies.push(body);
    return new Response(JSON.stringify({target:body.target,readiness:'blocked',gaps:[{code:'transport_missing',message:'尚无运行通道'}],input_schema:{type:'object',properties:{}}}));
  }));
  render(<CapabilitySystem />);
  await screen.findByRole('option',{name:'无副作用样板'});
  fireEvent.change(screen.getByLabelText('工作流'), {target:{value:'w1'}});
  expect(await screen.findByLabelText('工作流调用')).toBeInTheDocument();
  expect(await screen.findByText('尚无运行通道')).toBeInTheDocument();
  expect(bodies).toContainEqual(expect.objectContaining({target:{kind:'workflow',id:'w1',definition_version_id:'wv1'}}));
  fireEvent.change(screen.getByLabelText('工作流'), {target:{value:''}});
  fireEvent.click(screen.getByRole('tab',{name:'实现'}));
  fireEvent.click(screen.getByRole('button',{name:/读取样板/}));
  expect(await screen.findByLabelText('活动调用')).toBeInTheDocument();
  await waitFor(() => expect(bodies).toContainEqual(expect.objectContaining({target:{kind:'activity',id:'a1',definition_version_id:'av1'}})));
  expect(screen.getByRole('button',{name:'启动调用'})).toBeDisabled();
});
