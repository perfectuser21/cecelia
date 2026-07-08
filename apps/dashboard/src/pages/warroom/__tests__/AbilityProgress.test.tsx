import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AbilityProgress } from '../AbilityProgress';
import { AdvancementItem } from '../advancement-util';

const items: AdvancementItem[] = [
  { id: 'a', title: '做完的项', status: 'done' },
  { id: 'b', title: '在做的项', status: 'doing' },
  { id: 'c', title: '待做的项', status: 'todo' },
  { id: 'd', title: '另一待做', status: 'todo' },
];

describe('AbilityProgress', () => {
  it('渲染进度条宽度=pct 且三栏计数正确', () => {
    render(<AbilityProgress abilityName="测试能力" items={items} />);
    expect(screen.getByTestId('col-done-count').textContent).toBe('1');
    expect(screen.getByTestId('col-doing-count').textContent).toBe('1');
    expect(screen.getByTestId('col-todo-count').textContent).toBe('2');
    const bar = screen.getByTestId('progress-fill');
    expect(bar.style.width).toBe('25%');
    expect(screen.getByText('做完的项')).toBeInTheDocument();
    expect(screen.getByText('待做的项')).toBeInTheDocument();
  });

  it('空列表 pct=0 不白屏', () => {
    render(<AbilityProgress abilityName="空能力" items={[]} />);
    expect(screen.getByTestId('progress-fill').style.width).toBe('0%');
    expect(screen.getByTestId('col-todo-count').textContent).toBe('0');
  });
});
