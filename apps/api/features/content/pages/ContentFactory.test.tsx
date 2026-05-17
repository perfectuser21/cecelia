import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ContentFactory from './ContentFactory';

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

function renderWithRouter() {
  return render(
    <MemoryRouter>
      <ContentFactory />
    </MemoryRouter>
  );
}

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
    renderWithRouter();
    expect(screen.getByText('内容工厂')).toBeInTheDocument();
  });

  it('renders form section', async () => {
    renderWithRouter();
    expect(screen.getByText('启动新 Pipeline')).toBeInTheDocument();
  });

  it('renders pipeline list section', async () => {
    renderWithRouter();
    expect(screen.getByText('Pipeline 列表')).toBeInTheDocument();
  });

  it('renders submit button', async () => {
    renderWithRouter();
    expect(screen.getByText('启动 Pipeline')).toBeInTheDocument();
  });

  it('renders refresh button', async () => {
    renderWithRouter();
    expect(screen.getByText('刷新')).toBeInTheDocument();
  });

  it('pipeline 列表条目渲染为指向 /content-factory/:id 的链接', async () => {
    const mockPipeline = {
      id: 'abc-123',
      title: '[内容工厂] 测试 (solo-company-case)',
      status: 'completed',
      priority: 'P1',
      payload: { keyword: '测试', content_type: 'solo-company-case' },
      created_at: '2026-03-30T10:00:00.000Z',
    };
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/pipelines')) {
        return Promise.resolve({ ok: true, json: async () => [mockPipeline] });
      }
      return Promise.resolve({ ok: true, json: async () => [] });
    });
    renderWithRouter();
    const link = await screen.findByRole('link', { name: /测试/ });
    expect(link).toHaveAttribute('href', '/content-factory/abc-123');
  });
});
