/**
 * BrainModelsPage 基础测试
 * 验证组件可渲染，不抛出错误
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import BrainModelsPage from './BrainModelsPage';

// Mock react-router-dom 避免 React 18/19 双实例冲突
vi.mock('react-router-dom', () => ({
  MemoryRouter: ({ children }: any) => children,
  useNavigate: () => vi.fn(),
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

const mockProfiles = {
  success: true,
  profiles: [
    {
      id: 'profile-minimax',
      name: 'MiniMax 主力',
      config: {
        thalamus: { model: 'MiniMax-M2.5-highspeed', provider: 'minimax' },
        cortex: { model: 'claude-opus-4-6', provider: 'anthropic' },
      },
      is_active: false,
      updated_at: '2026-03-18T00:00:00Z',
    },
    {
      id: 'profile-anthropic',
      name: 'Anthropic 主力',
      config: {
        thalamus: { model: 'MiniMax-M2.5-highspeed', provider: 'minimax' },
        cortex: { model: 'claude-opus-4-6', provider: 'anthropic' },
        mouth: { model: 'claude-sonnet-4-6', provider: 'anthropic' },
        memory: { model: 'claude-sonnet-4-6', provider: 'anthropic' },
      },
      is_active: true,
      updated_at: '2026-03-18T00:00:00Z',
    },
  ],
};

const mockActive = {
  success: true,
  profile: mockProfiles.profiles[1],
};

const mockModels = {
  success: true,
  models: [
    { id: 'MiniMax-M2.5-highspeed', name: 'M2.5 Fast', provider: 'minimax', tier: 'standard' },
    { id: 'claude-sonnet-4-6', name: 'Sonnet 4.6', provider: 'anthropic', tier: 'standard' },
    { id: 'claude-opus-4-6', name: 'Opus 4.6', provider: 'anthropic', tier: 'premium' },
  ],
};

function makeResponse(data: object) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve(data),
  } as Response);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFetch.mockImplementation((url: string) => {
    if (url.includes('/model-profiles/active')) return makeResponse(mockActive);
    if (url.includes('/model-profiles/models')) return makeResponse(mockModels);
    if (url.includes('/model-profiles')) return makeResponse(mockProfiles);
    return makeResponse({});
  });
});

describe('BrainModelsPage', () => {
  it('渲染页面标题', () => {
    render(<BrainModelsPage />);
    expect(screen.getByText(/大脑模型配置/)).toBeTruthy();
  });

  it('渲染 Profile 切换区域标题', () => {
    render(<BrainModelsPage />);
    expect(screen.getByText(/Profile 一键切换/i)).toBeTruthy();
  });

  it('渲染 Organ 模型展示区域标题', () => {
    render(<BrainModelsPage />);
    expect(screen.getByText(/当前各 Organ 模型/i)).toBeTruthy();
  });
});


async function editThalamus() {
  await screen.findAllByText('调整');
  fireEvent.click(screen.getAllByText('调整')[0]);
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'claude-sonnet-4-6' } });
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
}

const receipt = {
  id: 'change-001', verified: true, actor: 'dashboard', verified_at: '2026-10-02T01:00:00Z',
  previous: { model: 'MiniMax-M2.5-highspeed', provider: 'minimax' },
  current: { model: 'claude-sonnet-4-6', provider: 'anthropic' },
};

function mockChange(options: { readBackMatches?: boolean; receipt?: object; readBackFails?: boolean; readBackProvider?: string; patchFails?: boolean }) {
  let changed = false;
  mockFetch.mockImplementation((url: string, init?: RequestInit) => {
    if (init?.method === 'PATCH') {
      changed = true;
      if (options.patchFails) return Promise.resolve({ ok: false, json: async () => ({ success: true, error: '保存失败：服务不可用' }) });
      return makeResponse({ success: true, receipt: options.receipt });
    }
    if (url.endsWith('/active')) {
      if (changed && options.readBackFails) return Promise.resolve({ ok: false, json: async () => ({ error: 'Unavailable' }) });
      if (changed && options.readBackMatches) return makeResponse({ success: true, profile: {
        ...mockActive.profile, config: { ...mockActive.profile.config, thalamus: { ...receipt.current, provider: options.readBackProvider ?? receipt.current.provider } },
      } });
      return makeResponse(mockActive);
    }
    if (url.endsWith('/models')) return makeResponse(mockModels);
    return makeResponse(mockProfiles);
  });
}

describe('单个 Agent 模型修改验收', () => {
  it('保存响应成功但读回旧模型时不报告已生效', async () => {
    mockChange({ receipt });
    render(<BrainModelsPage />);
    await editThalamus();
    expect(await screen.findByText(/未确认生效/)).toBeTruthy();
    expect(screen.queryByText(/已生效/)).toBeNull();
  });

  it('读取失败时保留未确认状态', async () => {
    mockChange({ receipt, readBackFails: true });
    render(<BrainModelsPage />);
    await editThalamus();
    expect(await screen.findByText(/未确认生效/)).toBeTruthy();
  });

  it('缺少后台变更凭证即使读回一致也不报告成功', async () => {
    mockChange({ readBackMatches: true });
    render(<BrainModelsPage />);
    await editThalamus();
    expect(await screen.findByText(/未确认生效/)).toBeTruthy();
  });

  it('读回一致且后台留痕后展示已生效、前后模型及凭证', async () => {
    mockChange({ receipt, readBackMatches: true });
    render(<BrainModelsPage />);
    await editThalamus();
    await waitFor(() => expect(screen.getByText(/变更记录：change-001/)).toBeTruthy());
    expect(screen.getAllByText(/已生效/).length).toBeGreaterThan(0);
    expect(screen.getByText(/MiniMax-M2.5-highspeed → claude-sonnet-4-6/)).toBeTruthy();
    expect(screen.getByText(/执行来源：dashboard/)).toBeTruthy();
  });
});


describe('模型修改拒绝不完整证据', () => {
  it('模型相同但服务商不同时不报告生效', async () => {
    mockChange({ receipt, readBackMatches: true, readBackProvider: 'anthropic-api' });
    render(<BrainModelsPage />);
    await editThalamus();
    expect(await screen.findByText(/未确认生效/)).toBeTruthy();
  });

  it('后台凭证记录了另一个模型时不报告生效', async () => {
    mockChange({ readBackMatches: true, receipt: { ...receipt, current: receipt.previous } });
    render(<BrainModelsPage />);
    await editThalamus();
    expect(await screen.findByText(/未确认生效/)).toBeTruthy();
  });

  it('HTTP失败即使响应含success也报告保存失败', async () => {
    mockChange({ patchFails: true });
    render(<BrainModelsPage />);
    await editThalamus();
    expect(await screen.findByText(/保存失败：服务不可用/)).toBeTruthy();
    expect(screen.queryByText(/已生效/)).toBeNull();
  });

  it('当前配置读取返回失败时明确展示加载错误', async () => {
    mockFetch.mockImplementation(() => makeResponse({ success: false }));
    render(<BrainModelsPage />);
    expect(await screen.findByText(/配置读取失败/)).toBeTruthy();
  });
});
