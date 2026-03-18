import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import ContentFactory from './ContentFactory';

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('ContentFactory', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    // Default: content-types returns empty, pipelines returns empty
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => [],
    });
  });

  it('renders page header', async () => {
    render(<ContentFactory />);
    expect(screen.getByText('内容工厂')).toBeInTheDocument();
  });

  it('renders form section', async () => {
    render(<ContentFactory />);
    expect(screen.getByText('启动新 Pipeline')).toBeInTheDocument();
  });

  it('renders pipeline list section', async () => {
    render(<ContentFactory />);
    expect(screen.getByText('Pipeline 列表')).toBeInTheDocument();
  });

  it('renders submit button', async () => {
    render(<ContentFactory />);
    expect(screen.getByText('启动 Pipeline')).toBeInTheDocument();
  });

  it('renders refresh button', async () => {
    render(<ContentFactory />);
    expect(screen.getByText('刷新')).toBeInTheDocument();
  });
});
