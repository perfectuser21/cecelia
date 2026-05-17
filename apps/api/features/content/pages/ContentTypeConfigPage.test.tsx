import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ContentTypeConfigPage from './ContentTypeConfigPage';

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

function renderPage() {
  return render(
    <MemoryRouter>
      <ContentTypeConfigPage />
    </MemoryRouter>
  );
}

describe('ContentTypeConfigPage', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => [],
    });
  });

  it('renders page header', async () => {
    renderPage();
    expect(screen.getByText('内容类型配置')).toBeInTheDocument();
  });

  it('renders subtitle', async () => {
    renderPage();
    expect(screen.getByText(/NotebookLM ID/i)).toBeInTheDocument();
  });

  it('renders content type list section', async () => {
    renderPage();
    expect(screen.getByText('内容类型列表')).toBeInTheDocument();
  });

  it('shows empty state when no types', async () => {
    renderPage();
    // Waits for fetch to resolve, list becomes visible
    const emptyMsg = await screen.findByText('暂无内容类型');
    expect(emptyMsg).toBeInTheDocument();
  });

  it('renders link back to content factory', async () => {
    renderPage();
    expect(screen.getByText('内容工厂')).toBeInTheDocument();
  });
});
