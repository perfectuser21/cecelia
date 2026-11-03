import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ContentTypeConfigPage from './ContentTypeConfigPage';

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

function renderPage() {
  return render(
    <MemoryRouter>
      <ContentTypeConfigPage />
    </MemoryRouter>
  );
}

describe('ContentTypeConfigPage', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => [],
    });
  });

  it('renders page header', async () => {
    renderPage();
    expect(screen.getByText('内容类型配置')).toBeInTheDocument();
  });

  it('renders subtitle', async () => {
    renderPage();
    expect(screen.getByText(/NotebookLM ID/i)).toBeInTheDocument();
  });

  it('renders content type list section', async () => {
    renderPage();
    expect(screen.getByText('内容类型列表')).toBeInTheDocument();
  });

  it('shows empty state when no types', async () => {
    renderPage();
    // Waits for fetch to resolve, list becomes visible
    const emptyMsg = await screen.findByText('暂无内容类型');
    expect(emptyMsg).toBeInTheDocument();
  });

  it('renders link back to content factory', async () => {
    renderPage();
    expect(screen.getByText('内容工厂')).toBeInTheDocument();
  });
});


describe('非空内容类型配置读写',()=>{
  function server({failure=false}={}) {
    let config={title:'案例配置',notebook_id:'old-book',other:{preserve:true}};
    let puts=0;
    mockFetch.mockImplementation(async(url:string,options?:RequestInit)=>{
      if(url==='/api/brain/content-types')return {ok:true,json:async()=>['case']};
      expect(url).toBe('/api/brain/content-types/case/config');
      if(options?.method==='PUT'){
        puts++;
        const body=JSON.parse(options.body as string);
        expect(body).toEqual({title:'案例配置',notebook_id:'new-book',other:{preserve:true},_updated_by:'content-type-config-page'});
        if(failure)return {ok:false,status:503,json:async()=>({error:'配置保存失败'})};
        config=body;
      }
      return {ok:true,json:async()=>({source:'db',config,updated_at:'2026-03-30T10:00:00Z'})};
    });
    return {puts:()=>puts,read:()=>config};
  }
  it('读取现值、合并PUT保留其它配置，并显示保存后的服务器读回',async()=>{
    const api=server();renderPage();
    const input=await screen.findByDisplayValue('old-book');
    fireEvent.change(input,{target:{value:' new-book '}});
    fireEvent.click(screen.getByRole('button',{name:'保存'}));
    expect(await screen.findByText('已保存')).toBeInTheDocument();
    expect(await screen.findByDisplayValue('new-book')).toBeInTheDocument();
    expect(api.puts()).toBe(1);expect(api.read().other).toEqual({preserve:true});
  });
  it('保存失败不显示成功、不改服务端值，保留用户输入重试',async()=>{
    const api=server({failure:true});renderPage();
    const input=await screen.findByDisplayValue('old-book');
    fireEvent.change(input,{target:{value:'new-book'}});
    fireEvent.click(screen.getByRole('button',{name:'保存'}));
    expect(await screen.findByText('配置保存失败')).toBeInTheDocument();
    expect(screen.queryByText('已保存')).not.toBeInTheDocument();
    expect(input).toHaveValue('new-book');expect(api.read().notebook_id).toBe('old-book');
    expect(screen.getByRole('button',{name:'保存'})).not.toBeDisabled();
  });
});
