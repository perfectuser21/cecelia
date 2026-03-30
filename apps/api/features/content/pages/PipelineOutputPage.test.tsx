import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import PipelineOutputPage from './PipelineOutputPage';

const mockFetch = vi.fn();
global.fetch = mockFetch;

function renderWithRoute(id: string) {
  return render(
    <MemoryRouter initialEntries={[`/content-factory/${id}`]}>
      <Routes>
        <Route path="/content-factory/:id" element={<PipelineOutputPage />} />
      </Routes>
    </MemoryRouter>
  );
}

const mockPipeline = {
  id: 'test-id',
  title: '[内容工厂] 测试关键词 (solo-company-case)',
  status: 'completed',
  priority: 'P1',
  payload: { keyword: '测试关键词', content_type: 'solo-company-case' },
  created_at: '2026-03-30T10:00:00.000Z',
  completed_at: '2026-03-30T10:05:00.000Z',
};

const mockOutput = {
  pipeline_id: 'test-id',
  output: {
    keyword: '测试关键词',
    status: 'completed',
    article_text: '这是测试文章文案内容',
    cards_text: '这是测试卡片文案内容',
    image_urls: [],
  },
};

const mockStages = {
  pipeline_id: 'test-id',
  stages: {
    'content-research': { status: 'completed', started_at: '2026-03-30T10:00:00.000Z', completed_at: '2026-03-30T10:01:00.000Z' },
    'content-copywriting': { status: 'completed', started_at: '2026-03-30T10:01:00.000Z', completed_at: '2026-03-30T10:03:00.000Z' },
  },
};

describe('PipelineOutputPage', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/output')) {
        return Promise.resolve({ ok: true, json: async () => mockOutput });
      }
      if (url.includes('/stages')) {
        return Promise.resolve({ ok: true, json: async () => mockStages });
      }
      // Pipeline base info
      return Promise.resolve({ ok: true, json: async () => mockPipeline });
    });
  });

  it('加载时显示 spinner', () => {
    mockFetch.mockImplementation(() => new Promise(() => {})); // 永不 resolve
    renderWithRoute('test-id');
    // spinner 存在于 DOM
    expect(document.querySelector('.animate-spin')).toBeTruthy();
  });

  it('加载成功后渲染四个 Tab', async () => {
    renderWithRoute('test-id');
    expect(await screen.findByText('Summary')).toBeInTheDocument();
    expect(screen.getByText('生成记录')).toBeInTheDocument();
    expect(screen.getByText('发布记录')).toBeInTheDocument();
    expect(screen.getByText('数据记录')).toBeInTheDocument();
  });

  it('默认激活 Summary Tab', async () => {
    renderWithRoute('test-id');
    await screen.findByText('Summary');
    expect(screen.getByText('总曝光')).toBeInTheDocument();
    expect(screen.getByText('总互动')).toBeInTheDocument();
    expect(screen.getByText('已发布平台')).toBeInTheDocument();
    expect(screen.getByText('互动率')).toBeInTheDocument();
  });

  it('包含返回内容工厂的链接', async () => {
    renderWithRoute('test-id');
    await screen.findByText('Summary');
    const backLink = screen.getByText('内容工厂');
    expect(backLink.closest('a')).toHaveAttribute('href', '/content-factory');
  });

  it('API 失败时显示错误状态', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 404, json: async () => ({}) });
    renderWithRoute('nonexistent-id');
    // 显示具体 HTTP 错误信息
    expect(await screen.findByText('HTTP 404')).toBeInTheDocument();
  });

  it('发布记录 Tab 显示 8 个平台', async () => {
    renderWithRoute('test-id');
    await screen.findByText('Summary');
    screen.getByText('发布记录').click();
    expect(await screen.findByText('抖音')).toBeInTheDocument();
    expect(screen.getByText('小红书')).toBeInTheDocument();
    expect(screen.getByText('微信公众号')).toBeInTheDocument();
    expect(screen.getByText('微博')).toBeInTheDocument();
    expect(screen.getByText('知乎')).toBeInTheDocument();
    expect(screen.getByText('今日头条')).toBeInTheDocument();
    expect(screen.getByText('快手')).toBeInTheDocument();
    expect(screen.getByText('B站')).toBeInTheDocument();
  });
});
