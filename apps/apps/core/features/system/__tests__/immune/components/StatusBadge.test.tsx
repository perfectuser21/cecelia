/**
 * Policy Status Badge Tests
 *
 * 测试策略状态徽章组件
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PolicyStatusBadge } from '../../../pages/immune/components/StatusBadge';

describe('PolicyStatusBadge', () => {
  it('should render active status correctly', () => {
    render(<PolicyStatusBadge status="active" />);
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('should render probation status correctly', () => {
    render(<PolicyStatusBadge status="probation" />);
    expect(screen.getByText('Probation')).toBeInTheDocument();
  });

  it('should render draft status correctly', () => {
    render(<PolicyStatusBadge status="draft" />);
    expect(screen.getByText('Draft')).toBeInTheDocument();
  });

  it('should render disabled status correctly', () => {
    render(<PolicyStatusBadge status="disabled" />);
    expect(screen.getByText('Disabled')).toBeInTheDocument();
  });

  it('should render dot when showDot is true', () => {
    const { container } = render(<PolicyStatusBadge status="active" showDot />);
    const dot = container.querySelector('.rounded-full');
    expect(dot).toBeInTheDocument();
  });
});
