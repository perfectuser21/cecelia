import {describe,it,expect} from 'vitest';
import {render,screen} from '@testing-library/react';
import {StatusBadge,StatusDot} from './StatusBadge';

// 使用现役statusHelpers，不用替身重写状态语义。
describe('状态徽章真实语义组合',()=>{
  it.each([
    ['completed','已完成','bg-green-100','text-green-700','lucide-circle-check'],
    ['in_progress','进行中','bg-blue-100','text-blue-700','lucide-activity'],
    ['failed','失败','bg-red-100','text-red-700','lucide-circle-x'],
    ['queued','排队中','bg-gray-100','text-gray-700','lucide-clock'],
    ['unrecognized','未知','bg-gray-100','text-gray-500','lucide-circle-alert'],
  ])('%s显示实际中文、颜色及对应图形', (status,label,background,color,icon)=>{
    const {container}=render(<StatusBadge status={status} showIcon />);
    const badge=screen.getByText(label);
    expect(badge).toHaveClass(background,color);
    expect(container.querySelector('svg')).toHaveClass(icon);
  });
  it('自定义标签、隐藏标签和图标开关仍由组件控制',()=>{
    const {rerender,container}=render(<StatusBadge status="completed" label="已验收" showIcon />);
    expect(screen.getByText('已验收')).toBeInTheDocument();
    expect(screen.queryByText('已完成')).not.toBeInTheDocument();
    rerender(<StatusBadge status="completed" showLabel={false} showIcon={false} />);
    expect(screen.queryByText('已完成')).not.toBeInTheDocument();
    expect(container.querySelector('svg')).toBeNull();
  });
  it.each([['sm','text-xs','px-2'],['md','text-sm','px-2.5'],['lg','text-base','px-3']] as const)('%s尺寸保留真实语义', (size,text,padding)=>{
    render(<StatusBadge status="completed" size={size} className="extra" />);
    expect(screen.getByText('已完成')).toHaveClass(text,padding,'extra');
  });
  it('outline使用真实失败文字色，dot区分在线与离线',()=>{
    const {rerender,container}=render(<StatusBadge status="failed" variant="outline" />);
    expect(screen.getByText('失败')).toHaveClass('border-current/30','text-red-600');
    rerender(<StatusBadge status="online" variant="dot" />);
    expect(container.querySelector('.rounded-full')).toHaveClass('bg-green-500');
    rerender(<StatusDot online={false} className="extra" />);
    expect(container.firstChild).toHaveClass('bg-red-500','extra');
    rerender(<StatusDot online />);
    expect(container.firstChild).toHaveClass('bg-green-500','w-2','h-2');
  });
});
