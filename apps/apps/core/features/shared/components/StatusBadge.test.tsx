import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusBadge, StatusDot } from './StatusBadge';

// Mock the helper functions
vi.mock('../utils/statusHelpers', () => ({
  getStatusColor: vi.fn((status: string) => {
    const s = status.toLowerCase();
    if (s.includes('success') || s.includes('completed')) return 'bg-green-100 text-green-800';
    if (s.includes('error') || s.includes('failed')) return 'bg-red-100 text-red-800';
    if (s.includes('running') || s.includes('in_progress')) return 'bg-blue-100 text-blue-800';
    if (s.includes('warning') || s.includes('pending')) return 'bg-yellow-100 text-yellow-800';
    return 'bg-gray-100 text-gray-800';
  }),
  getStatusIcon: vi.fn((status: string, size: string) => {
    const s = status.toLowerCase();
    if (s.includes('success')) return <span className={size} data-testid="icon-check">✓</span>;
    if (s.includes('error')) return <span className={size} data-testid="icon-x">✗</span>;
    if (s.includes('running')) return <span className={size} data-testid="icon-spinner">↻</span>;
    return null;
  }),
  getStatusLabel: vi.fn((status: string) => {
    return status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, ' ');
  }),
  getStatusTextColor: vi.fn((status: string) => {
    const s = status.toLowerCase();
    if (s.includes('success')) return 'text-green-600';
    if (s.includes('error')) return 'text-red-600';
    if (s.includes('running')) return 'text-blue-600';
    if (s.includes('warning')) return 'text-yellow-600';
    return 'text-gray-600';
  }),
}));

describe('StatusBadge', () => {
  it('renders with basic status text', () => {
    render(<StatusBadge status="success" />);
    expect(screen.getByText('Success')).toBeInTheDocument();
  });

  it('applies correct status colors for different statuses', () => {
    const { rerender } = render(<StatusBadge status="success" />);
    let badge = screen.getByText('Success');
    expect(badge.className).toContain('bg-green-100');
    expect(badge.className).toContain('text-green-800');

    rerender(<StatusBadge status="error" />);
    badge = screen.getByText('Error');
    expect(badge.className).toContain('bg-red-100');
    expect(badge.className).toContain('text-red-800');

    rerender(<StatusBadge status="running" />);
    badge = screen.getByText('Running');
    expect(badge.className).toContain('bg-blue-100');
    expect(badge.className).toContain('text-blue-800');

    rerender(<StatusBadge status="pending" />);
    badge = screen.getByText('Pending');
    expect(badge.className).toContain('bg-yellow-100');
    expect(badge.className).toContain('text-yellow-800');
  });

  it('shows icon when showIcon is true', () => {
    render(<StatusBadge status="success" showIcon={true} />);
    expect(screen.getByTestId('icon-check')).toBeInTheDocument();
  });

  it('hides label when showLabel is false', () => {
    render(<StatusBadge status="success" showLabel={false} />);
    expect(screen.queryByText('Success')).not.toBeInTheDocument();
  });

  it('uses custom label when provided', () => {
    render(<StatusBadge status="success" label="Custom Label" />);
    expect(screen.getByText('Custom Label')).toBeInTheDocument();
    expect(screen.queryByText('Success')).not.toBeInTheDocument();
  });

  it('applies different size classes', () => {
    const { rerender } = render(<StatusBadge status="active" size="sm" />);
    let badge = screen.getByText('Active');
    expect(badge.className).toContain('text-xs');
    expect(badge.className).toContain('px-2');

    rerender(<StatusBadge status="active" size="md" />);
    badge = screen.getByText('Active');
    expect(badge.className).toContain('text-sm');
    expect(badge.className).toContain('px-2.5');

    rerender(<StatusBadge status="active" size="lg" />);
    badge = screen.getByText('Active');
    expect(badge.className).toContain('text-base');
    expect(badge.className).toContain('px-3');
  });

  it('renders dot variant correctly', () => {
    render(<StatusBadge status="online" variant="dot" />);

    // Check for dot element
    const dot = document.querySelector('.w-2.h-2.rounded-full');
    expect(dot).toBeInTheDocument();
    expect(dot?.className).toContain('bg-green-500');
  });

  it('renders outline variant correctly', () => {
    render(<StatusBadge status="warning" variant="outline" />);

    const badge = screen.getByText('Warning');
    expect(badge.className).toContain('border');
    expect(badge.className).toContain('border-current/30');
  });

  it('applies custom className', () => {
    render(<StatusBadge status="custom" className="custom-badge-class" />);

    const badge = screen.getByText('Custom');
    expect(badge.className).toContain('custom-badge-class');
  });

  it('shows both icon and label when both are enabled', () => {
    render(<StatusBadge status="success" showIcon={true} showLabel={true} />);

    expect(screen.getByTestId('icon-check')).toBeInTheDocument();
    expect(screen.getByText('Success')).toBeInTheDocument();
  });
});

describe('StatusDot', () => {
  it('renders green dot when online', () => {
    const { container } = render(<StatusDot online={true} />);
    const dot = container.querySelector('.bg-green-500');
    expect(dot).toBeInTheDocument();
    expect(dot?.className).toContain('rounded-full');
    expect(dot?.className).toContain('w-2');
    expect(dot?.className).toContain('h-2');
  });

  it('renders red dot when offline', () => {
    const { container } = render(<StatusDot online={false} />);
    const dot = container.querySelector('.bg-red-500');
    expect(dot).toBeInTheDocument();
  });

  it('applies custom className', () => {
    const { container } = render(<StatusDot online={true} className="custom-dot" />);
    const dot = container.querySelector('.bg-green-500');
    expect(dot?.className).toContain('custom-dot');
  });
});