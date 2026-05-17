import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import ContentTypeConfigPage from '../ContentTypeConfigPage';

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('ContentTypeConfigPage', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    // 默认返回空 content types 列表
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ content_types: [] }),
    });
  });

  it('应该渲染页面标题', async () => {
    render(<ContentTypeConfigPage />);
    await waitFor(() => {
      expect(screen.getByText(/内容类型配置/i)).toBeInTheDocument();
    });
  });

  it('应该在加载时调用 API 获取 content types', async () => {
    render(<ContentTypeConfigPage />);
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/brain/content-types'),
      );
    });
  });

  it('API 失败时不应崩溃', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));
    const { container } = render(<ContentTypeConfigPage />);
    await waitFor(() => {
      expect(container).toBeTruthy();
    });
  });
});
