import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import StatusIcon from './StatusIcon';

describe('StatusIcon', () => {
  it('renders check icon for completed status', () => {
    const { container } = render(<StatusIcon status="completed" />);
    const icon = container.querySelector('svg');
    expect(icon).toBeInTheDocument();
    expect(icon?.className).toContain('text-emerald-500');
  });

  it('renders clock icon for in_progress status', () => {
    const { container } = render(<StatusIcon status="in_progress" />);
    const icon = container.querySelector('svg');
    expect(icon).toBeInTheDocument();
    expect(icon?.className).toContain('text-blue-500');
  });

  it('renders alert icon for cancelled status', () => {
    const { container } = render(<StatusIcon status="cancelled" />);
    const icon = container.querySelector('svg');
    expect(icon).toBeInTheDocument();
    expect(icon?.className).toContain('text-red-500');
  });

  it('renders default clock icon for unknown status', () => {
    const { container } = render(<StatusIcon status="unknown" />);
    const icon = container.querySelector('svg');
    expect(icon).toBeInTheDocument();
    expect(icon?.className).toContain('text-slate-400');
  });

  it('applies small size class when size is sm', () => {
    const { container } = render(<StatusIcon status="completed" size="sm" />);
    const icon = container.querySelector('svg');
    expect(icon?.className).toContain('w-3.5');
    expect(icon?.className).toContain('h-3.5');
  });

  it('applies medium size class when size is md', () => {
    const { container } = render(<StatusIcon status="completed" size="md" />);
    const icon = container.querySelector('svg');
    expect(icon?.className).toContain('w-4');
    expect(icon?.className).toContain('h-4');
  });

  it('defaults to md size when not specified', () => {
    const { container } = render(<StatusIcon status="completed" />);
    const icon = container.querySelector('svg');
    expect(icon?.className).toContain('w-4');
    expect(icon?.className).toContain('h-4');
  });

  it('handles empty status string', () => {
    const { container } = render(<StatusIcon status="" />);
    const icon = container.querySelector('svg');
    expect(icon).toBeInTheDocument();
    expect(icon?.className).toContain('text-slate-400');
  });

  it('handles case sensitivity in status', () => {
    const { container } = render(<StatusIcon status="COMPLETED" />);
    const icon = container.querySelector('svg');
    // Should not match due to case sensitivity, so should render default
    expect(icon?.className).toContain('text-slate-400');
  });
});