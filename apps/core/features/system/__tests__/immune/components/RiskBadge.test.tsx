/**
 * Risk Badge Tests
 *
 * 测试风险等级徽章组件
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RiskBadge } from '../../../pages/immune/components/RiskBadge';

describe('RiskBadge', () => {
  it('should render low risk correctly', () => {
    render(<RiskBadge level="low" />);
    expect(screen.getByText('Low Risk')).toBeInTheDocument();
  });

  it('should render medium risk correctly', () => {
    render(<RiskBadge level="medium" />);
    expect(screen.getByText('Medium Risk')).toBeInTheDocument();
  });

  it('should render high risk correctly', () => {
    render(<RiskBadge level="high" />);
    expect(screen.getByText('High Risk')).toBeInTheDocument();
  });

  it('should apply correct size class for sm', () => {
    const { container } = render(<RiskBadge level="low" size="sm" />);
    expect(container.querySelector('.text-xs')).toBeInTheDocument();
  });

  it('should apply correct size class for md', () => {
    const { container } = render(<RiskBadge level="low" size="md" />);
    expect(container.querySelector('.text-sm')).toBeInTheDocument();
  });
});
