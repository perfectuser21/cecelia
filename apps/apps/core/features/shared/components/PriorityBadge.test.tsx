import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import PriorityBadge from './PriorityBadge';

describe('PriorityBadge', () => {
  it('renders priority text', () => {
    render(<PriorityBadge priority="P0" />);
    expect(screen.getByText('P0')).toBeInTheDocument();
  });

  it('applies correct color for P0 priority', () => {
    render(<PriorityBadge priority="P0" />);
    const badge = screen.getByText('P0');
    expect(badge.className).toContain('bg-red-100');
    expect(badge.className).toContain('text-red-700');
  });

  it('applies correct color for P1 priority', () => {
    render(<PriorityBadge priority="P1" />);
    const badge = screen.getByText('P1');
    expect(badge.className).toContain('bg-amber-100');
    expect(badge.className).toContain('text-amber-700');
  });

  it('applies default color for P2 and other priorities', () => {
    const { rerender } = render(<PriorityBadge priority="P2" />);
    let badge = screen.getByText('P2');
    expect(badge.className).toContain('bg-slate-100');
    expect(badge.className).toContain('text-slate-700');

    rerender(<PriorityBadge priority="P3" />);
    badge = screen.getByText('P3');
    expect(badge.className).toContain('bg-slate-100');
    expect(badge.className).toContain('text-slate-700');

    rerender(<PriorityBadge priority="Custom" />);
    badge = screen.getByText('Custom');
    expect(badge.className).toContain('bg-slate-100');
    expect(badge.className).toContain('text-slate-700');
  });

  it('applies correct size classes for sm size', () => {
    render(<PriorityBadge priority="P0" size="sm" />);
    const badge = screen.getByText('P0');
    expect(badge.className).toContain('px-1.5');
    expect(badge.className).toContain('py-0.5');
    expect(badge.className).toContain('text-[10px]');
  });

  it('applies correct size classes for md size', () => {
    render(<PriorityBadge priority="P0" size="md" />);
    const badge = screen.getByText('P0');
    expect(badge.className).toContain('px-2');
    expect(badge.className).toContain('py-0.5');
    expect(badge.className).toContain('text-xs');
  });

  it('defaults to md size when not specified', () => {
    render(<PriorityBadge priority="P1" />);
    const badge = screen.getByText('P1');
    expect(badge.className).toContain('px-2');
    expect(badge.className).toContain('text-xs');
  });

  it('has rounded corners', () => {
    render(<PriorityBadge priority="P0" />);
    const badge = screen.getByText('P0');
    expect(badge.className).toContain('rounded');
  });

  it('has font-medium class', () => {
    render(<PriorityBadge priority="P1" />);
    const badge = screen.getByText('P1');
    expect(badge.className).toContain('font-medium');
  });
});