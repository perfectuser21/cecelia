import {describe,it,expect} from 'vitest';
import {render,screen,fireEvent,act} from '@testing-library/react';
import {MemoryRouter,useLocation} from 'react-router-dom';
import TabbedPage,{type TabConfig} from './TabbedPage';
import {Home,Settings} from 'lucide-react';

function Location(){return <output aria-label="当前位置">{useLocation().pathname}</output>;}
const tabs: TabConfig[]=[
  {id:'home',label:'首页',path:'/base',icon:Home,component:async()=>({default:()=> <p>首页内容</p>})},
  {id:'settings',label:'设置',path:'/base/settings',icon:Settings,component:async()=>({default:()=> <p>设置内容</p>})},
];
function page(path='/base',entries=tabs){return render(<MemoryRouter initialEntries={[path]}><Location/><TabbedPage tabs={entries} basePath="/base" /></MemoryRouter>);}

describe('页签与真实Router、懒加载组合',()=>{
  it('点击后URL、当前内容与高亮同步改变，原页面退出',async()=>{
    page();expect(await screen.findByText('首页内容')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'设置'}));
    expect(await screen.findByText('设置内容')).toBeInTheDocument();
    expect(screen.getByLabelText('当前位置')).toHaveTextContent('/base/settings');
    expect(screen.queryByText('首页内容')).not.toBeInTheDocument();
    expect(screen.getByRole('button',{name:'设置'})).toHaveClass('bg-slate-700');
    expect(screen.getByRole('button',{name:'首页'})).not.toHaveClass('bg-slate-700');
  });
  it('深链接优先选择最长匹配路径，不能被前面的父路径吞掉',async()=>{
    page('/base/settings/advanced');
    expect(await screen.findByText('设置内容')).toBeInTheDocument();
    expect(screen.queryByText('首页内容')).not.toBeInTheDocument();
  });
  it('路径必须按段匹配，相似前缀不能选中设置',async()=>{
    page('/base/settings-other');
    expect(await screen.findByText('首页内容')).toBeInTheDocument();
    expect(screen.queryByText('设置内容')).not.toBeInTheDocument();
  });
  it('未知URL回退第一个页签并实际渲染该页',async()=>{
    page('/unknown');expect(await screen.findByText('首页内容')).toBeInTheDocument();
    expect(screen.getByRole('button',{name:'首页'})).toHaveClass('bg-slate-700');
  });
  it('等待模块期间显示loading，解析后显示返回页面',async()=>{
    let resolve!: (value:{default:()=>React.ReactElement})=>void;
    const pending=new Promise<{default:()=>React.ReactElement}>(r=>{resolve=r;});
    page('/base',[{...tabs[0],component:()=>pending}]);
    expect(screen.getByText('Loading...')).toBeInTheDocument();
    await act(async()=>resolve({default:()=> <p>延迟加载真实内容</p>}));
    expect(await screen.findByText('延迟加载真实内容')).toBeInTheDocument();
    expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
  });
  it('空配置不产生按钮或内容加载',()=>{
    page('/base',[]);expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
  });
});
