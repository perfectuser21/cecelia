import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ContentFactory from './ContentFactory';

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

function renderWithRouter() {
  return render(
    <MemoryRouter>
      <ContentFactory />
    </MemoryRouter>
  );
}

describe('ContentFactory', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    // Default: content-types returns empty, pipelines returns empty
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => [],
    });
  });

  it('renders page header', async () => {
    renderWithRouter();
    expect(screen.getByText('内容工厂')).toBeInTheDocument();
  });

  it('renders form section', async () => {
    renderWithRouter();
    expect(screen.getByText('启动新 Pipeline')).toBeInTheDocument();
  });

  it('renders pipeline list section', async () => {
    renderWithRouter();
    expect(screen.getByText('Pipeline 列表')).toBeInTheDocument();
  });

  it('renders submit button', async () => {
    renderWithRouter();
    expect(screen.getByText('启动 Pipeline')).toBeInTheDocument();
  });

  it('renders refresh button', async () => {
    renderWithRouter();
    expect(screen.getByText('刷新')).toBeInTheDocument();
  });

  it('pipeline 列表条目渲染为指向 /content-factory/:id 的链接', async () => {
    const mockPipeline = {
      id: 'abc-123',
      title: '[内容工厂] 测试 (solo-company-case)',
      status: 'completed',
      priority: 'P1',
      payload: { keyword: '测试', content_type: 'solo-company-case' },
      created_at: '2026-03-30T10:00:00.000Z',
    };
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/pipelines')) {
        return Promise.resolve({ ok: true, json: async () => [mockPipeline] });
      }
      return Promise.resolve({ ok: true, json: async () => [] });
    });
    renderWithRouter();
    const link = await screen.findByRole('link', { name: /测试/ });
    expect(link).toHaveAttribute('href', '/content-factory/abc-123');
  });
});


// HTTP为外部边界，表单、状态刷新与阶段展开均执行真实组件。
describe('内容工厂交互合同',()=>{
  afterEach(()=>vi.useRealTimers());
  function server({failure=false,active=false}={}) {
    let rows: any[] = active ? [{id:'pending-1',title:'待处理任务',status:'queued',priority:'P1',created_at:'2026-03-30T10:00:00Z',payload:{}}] : [];
    const submitted: any[]=[];
    let listReads=0;
    mockFetch.mockImplementation(async(url:string,options?:RequestInit)=>{
      if(url==='/api/brain/content-types')return {ok:true,json:async()=>['article','case']};
      if(url==='/api/brain/content-types/article/config')return {ok:true,json:async()=>({config:{notebook_id:'article-book'}})};
      if(url==='/api/brain/content-types/case/config')return {ok:true,json:async()=>({config:{notebook_id:'case-book'}})};
      if(url==='/api/brain/pipelines' && options?.method==='POST') {
        const body=JSON.parse(options.body as string);submitted.push(body);
        if(failure)return {ok:false,status:503,json:async()=>({error:'生产队列不可用'})};
        rows=[{id:'created-1',title:`已创建：${body.keyword}`,status:'completed',priority:body.priority,created_at:'2026-03-30T10:00:00Z',payload:body}];
        return {ok:true,json:async()=>({id:'created-1'})};
      }
      if(url==='/api/brain/pipelines?limit=20'){listReads++;return {ok:true,json:async()=>rows};}
      if(url==='/api/brain/pipelines/created-1/stages')return {ok:true,json:async()=>({stages:{'content-research':{status:'completed',summary:'阶段真实读回'}}})};
      throw Error(`未声明请求 ${url}`);
    });
    return {submitted,reads:()=>listReads,finish:()=>{rows=[{...rows[0],status:'completed',title:'刷新后的完成任务'}];}};
  }
  it('切换类型回填Notebook，提交精确身份并读回新列表与目标阶段',async()=>{
    const api=server();renderWithRouter();
    await screen.findByDisplayValue('article-book');
    fireEvent.change(screen.getAllByRole('combobox')[0],{target:{value:'case'}});
    const notebook=await screen.findByDisplayValue('case-book');
    fireEvent.change(notebook,{target:{value:' custom-book '}});
    fireEvent.change(screen.getAllByRole('combobox')[1],{target:{value:'P2'}});
    fireEvent.change(screen.getByPlaceholderText('例：字节跳动、得物'),{target:{value:' 测试关键词 '}});
    fireEvent.click(screen.getByRole('button',{name:'启动 Pipeline'}));
    const link=await screen.findByRole('link',{name:/已创建：测试关键词/});
    expect(api.submitted).toEqual([{keyword:'测试关键词',content_type:'case',priority:'P2',notebook_id:'custom-book'}]);
    expect(link).toHaveAttribute('href','/content-factory/created-1');
    expect(screen.getByPlaceholderText('例：字节跳动、得物')).toHaveValue('');
    fireEvent.click(screen.getByRole('button',{name:'展开'}));
    expect(await screen.findByText('阶段真实读回')).toBeInTheDocument();
  });
  it('POST失败显示错误并保留输入，不显示创建成功或新列表',async()=>{
    const api=server({failure:true});renderWithRouter();
    await screen.findByDisplayValue('article-book');
    const keyword=screen.getByPlaceholderText('例：字节跳动、得物');
    fireEvent.change(keyword,{target:{value:'保留重试关键词'}});
    fireEvent.click(screen.getByRole('button',{name:'启动 Pipeline'}));
    expect(await screen.findByText('生产队列不可用')).toBeInTheDocument();
    expect(keyword).toHaveValue('保留重试关键词');
    expect(screen.queryByText('Pipeline 已创建，Brain 将自动开始执行')).not.toBeInTheDocument();
    expect(api.reads()).toBe(1);
    expect(screen.getByRole('button',{name:'启动 Pipeline'})).not.toBeDisabled();
  });
  it('排队任务5秒后从同列表读回，卸载后停止刷新',async()=>{
    vi.useFakeTimers({toFake:['setInterval','clearInterval']});
    const api=server({active:true});const rendered=renderWithRouter();
    await screen.findByRole('link',{name:/待处理任务/});
    api.finish();
    await act(async()=>{vi.advanceTimersByTime(5000);});
    expect(await screen.findByRole('link',{name:/刷新后的完成任务/})).toBeInTheDocument();
    expect(api.reads()).toBe(2);
    rendered.unmount();
    await act(async()=>{vi.advanceTimersByTime(10000);});
    expect(api.reads()).toBe(2);
  });
});
