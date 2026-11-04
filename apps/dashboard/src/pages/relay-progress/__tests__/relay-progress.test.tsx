import React from 'react';
import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import {act,cleanup,render,screen,waitFor} from '@testing-library/react';
vi.mock('react-router-dom',()=>({
  useNavigate:()=>vi.fn(),useLocation:()=>({pathname:'/relay-progress'}),Link:({children}:any)=>children,
}));
import RelayProgressPage,{stripPhasePrefix} from '../RelayProgressPage';
const fetchMock=vi.fn();
beforeEach(()=>{
  vi.useRealTimers();
  fetchMock.mockReset().mockResolvedValue({ok:true,status:200,json:async()=>[]});
  vi.stubGlobal('fetch',fetchMock);
});
afterEach(()=>{
  cleanup();
  if(vi.isFakeTimers())vi.clearAllTimers();
  vi.useRealTimers();vi.unstubAllGlobals();vi.restoreAllMocks();
});
async function show(){let view:ReturnType<typeof render>;await act(async()=>{view=render(<RelayProgressPage/>);});return view!;}
describe('真实stripPhasePrefix导出',()=>{
  it.each([
    ['A_planning','planning'],['A_generate','generate'],['planning','planning'],['gan','gan'],['A_judge','judge'],
  ])('%s → %s',(input,output)=>expect(stripPhasePrefix(input)).toBe(output));
});
describe('RelayProgressPage真实空态与错误态',()=>{
  it('初载只fetch一次，真实空态显示文案',async()=>{
    await show();
    await waitFor(()=>expect(screen.getByTestId('relay-progress-empty')).toHaveTextContent('暂无进行中的 relay'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/brain/orchestrator/relay-runs');
  });
  it('空态不显示进度条行',async()=>{
    await show();expect(screen.getByTestId('relay-progress-empty')).toBeInTheDocument();
    expect(screen.queryAllByTestId('relay-progress-row')).toHaveLength(0);
  });
  it('HTTP错误渲染真实error及状态文案，只加载一次',async()=>{
    fetchMock.mockResolvedValue({ok:false,status:500,statusText:'Internal Server Error'});
    await show();
    expect(screen.getByTestId('relay-progress-error')).toHaveTextContent('请求失败: 500 Internal Server Error');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('请求异常被真实组件收敛为错误渲染',async()=>{
    fetchMock.mockRejectedValue(new Error('isolated network unavailable'));
    await show();expect(screen.getByTestId('relay-progress-error')).toHaveTextContent('isolated network unavailable');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
describe('RelayProgressPage真实数据渲染',()=>{
  beforeEach(()=>fetchMock.mockResolvedValue({ok:true,json:async()=>[
    {initiative_id:'abcdef1234567890',phase:'A_generate',judge_verdict:'APPROVED',cost_usd:0.12},
    {initiative_id:'bbbbbbbb99999999',phase:'planning',judge_verdict:null,cost_usd:null},
  ]}));
  it('有数据时渲染进度容器',async()=>{await show();expect(screen.getByTestId('relay-progress-container')).toBeInTheDocument();});
  it('有数据时不渲染空态',async()=>{await show();expect(screen.getByTestId('relay-progress-container')).toBeInTheDocument();expect(screen.queryByTestId('relay-progress-empty')).not.toBeInTheDocument();});
  it('initiative前8位短码实际显示',async()=>{await show();expect(screen.getByText(/abcdef12/)).toBeInTheDocument();});
  it('真实前缀normalize不把A_generate当标签显示',async()=>{await show();expect(screen.getByTestId('relay-progress-container')).toBeInTheDocument();expect(screen.queryByText('A_generate')).not.toBeInTheDocument();});
  it('七段phase标签存在',async()=>{
    await show();for(const phase of ['planning','gan','generate','evaluate','judge','merge','report'])expect(screen.getAllByTestId(`phase-label-${phase}`).length).toBeGreaterThan(0);
  });
  it('两个initiative分别实际显示，不冒称租户隔离已证',async()=>{await show();expect(screen.getByText(/abcdef12/)).toBeInTheDocument();expect(screen.getByText(/bbbbbbbb/)).toBeInTheDocument();});
});
it('仅polling场景显式推进：初载1次，14999ms仍1次，15000ms第2次，卸载后零轮询',async()=>{
  vi.useFakeTimers();
  const view=await show();expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('relay-progress-empty')).toBeInTheDocument();
  await act(async()=>{await vi.advanceTimersByTimeAsync(14999);});expect(fetchMock).toHaveBeenCalledTimes(1);
  await act(async()=>{await vi.advanceTimersByTimeAsync(1);});expect(fetchMock).toHaveBeenCalledTimes(2);
  view.unmount();expect(vi.getTimerCount()).toBe(0);
  await act(async()=>{await vi.advanceTimersByTimeAsync(15000);});expect(fetchMock).toHaveBeenCalledTimes(2);
});
