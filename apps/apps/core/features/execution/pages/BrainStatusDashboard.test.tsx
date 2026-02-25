import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import BrainStatusDashboard from './BrainStatusDashboard';

describe('BrainStatusDashboard', () => {
  it('should render without crashing', () => {
    const { container } = render(<BrainStatusDashboard />);
    expect(container).toBeDefined();
  });

  it('should render Brain Status Dashboard title', () => {
    const { getByText } = render(<BrainStatusDashboard />);
    expect(getByText('Brain Status Dashboard')).toBeDefined();
  });

  it('should render refresh button', () => {
    const { getByText } = render(<BrainStatusDashboard />);
    expect(getByText('刷新')).toBeDefined();
  });
});
