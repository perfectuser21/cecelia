import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import BrainStatusDashboard from './BrainStatusDashboard';

// Mock useApi hook to prevent unhandled fetch rejections in happy-dom
vi.mock('../../shared/hooks/useApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../shared/hooks/useApi')>();
  const mockReturn = { data: null, loading: false, error: null };
  return {
    ...actual,
    useApi: vi.fn().mockReturnValue(mockReturn),
    useApiFn: vi.fn().mockReturnValue(mockReturn),
  };
});

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
