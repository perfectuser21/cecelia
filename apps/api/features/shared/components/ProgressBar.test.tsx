import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import ProgressBar from './ProgressBar';

describe('ProgressBar', () => {
  it('renders progress bar with correct width', () => {
    const { container } = render(<ProgressBar progress={50} />);
    const progressBar = container.querySelector('[style*="width"]');
    expect(progressBar?.getAttribute('style')).toContain('width: 50%');
  });

  it('applies correct color for different progress ranges', () => {
    const { rerender, container } = render(<ProgressBar progress={90} />);
    let bar = container.querySelector('[style*="width"]');
    expect(bar?.className).toContain('bg-emerald-500');

    rerender(<ProgressBar progress={65} />);
    bar = container.querySelector('[style*="width"]');
    expect(bar?.className).toContain('bg-blue-500');

    rerender(<ProgressBar progress={30} />);
    bar = container.querySelector('[style*="width"]');
    expect(bar?.className).toContain('bg-amber-500');

    rerender(<ProgressBar progress={0} />);
    bar = container.querySelector('[style*="width"]');
    expect(bar?.className).toContain('bg-slate-300');
  });

  it('handles boundary values correctly', () => {
    const { rerender, container } = render(<ProgressBar progress={80} />);
    let bar = container.querySelector('[style*="width"]');
    expect(bar?.className).toContain('bg-emerald-500');

    rerender(<ProgressBar progress={79} />);
    bar = container.querySelector('[style*="width"]');
    expect(bar?.className).toContain('bg-blue-500');

    rerender(<ProgressBar progress={50} />);
    bar = container.querySelector('[style*="width"]');
    expect(bar?.className).toContain('bg-blue-500');

    rerender(<ProgressBar progress={49} />);
    bar = container.querySelector('[style*="width"]');
    expect(bar?.className).toContain('bg-amber-500');

    rerender(<ProgressBar progress={1} />);
    bar = container.querySelector('[style*="width"]');
    expect(bar?.className).toContain('bg-amber-500');
  });

  it('applies correct size classes', () => {
    const { rerender, container } = render(<ProgressBar progress={50} size="sm" />);
    let wrapper = container.firstChild;
    let bar = container.querySelector('[style*="width"]');
    expect(wrapper?.className).toContain('h-1.5');
    expect(bar?.className).toContain('h-1.5');

    rerender(<ProgressBar progress={50} size="md" />);
    wrapper = container.firstChild;
    bar = container.querySelector('[style*="width"]');
    expect(wrapper?.className).toContain('h-2');
    expect(bar?.className).toContain('h-2');
  });

  it('defaults to md size when not specified', () => {
    const { container } = render(<ProgressBar progress={50} />);
    const wrapper = container.firstChild;
    expect(wrapper?.className).toContain('h-2');
  });

  it('handles 0% progress correctly', () => {
    const { container } = render(<ProgressBar progress={0} />);
    const bar = container.querySelector('[style*="width"]');
    expect(bar?.getAttribute('style')).toContain('width: 0%');
  });

  it('handles 100% progress correctly', () => {
    const { container } = render(<ProgressBar progress={100} />);
    const bar = container.querySelector('[style*="width"]');
    expect(bar?.getAttribute('style')).toContain('width: 100%');
    expect(bar?.className).toContain('bg-emerald-500');
  });

  it('includes transition animation classes', () => {
    const { container } = render(<ProgressBar progress={50} />);
    const bar = container.querySelector('[style*="width"]');
    expect(bar?.className).toContain('transition-all');
    expect(bar?.className).toContain('duration-500');
  });

  it('has rounded corners', () => {
    const { container } = render(<ProgressBar progress={50} />);
    const wrapper = container.firstChild;
    const bar = container.querySelector('[style*="width"]');
    expect(wrapper?.className).toContain('rounded-full');
    expect(bar?.className).toContain('rounded-full');
  });
});