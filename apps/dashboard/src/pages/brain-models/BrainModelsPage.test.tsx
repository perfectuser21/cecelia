/**
 * BrainModelsPage 基础测试
 * 验证组件可渲染，不抛出错误
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import BrainModelsPage from './BrainModelsPage';

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
    render(
      <MemoryRouter>
        <BrainModelsPage />
      </MemoryRouter>
    );
    expect(screen.getByText(/大脑模型配置/)).toBeTruthy();
  });

  it('渲染 Profile 切换区域标题', () => {
    render(
      <MemoryRouter>
        <BrainModelsPage />
      </MemoryRouter>
    );
    expect(screen.getByText(/Profile 一键切换/i)).toBeTruthy();
  });

  it('渲染 Organ 模型展示区域标题', () => {
    render(
      <MemoryRouter>
        <BrainModelsPage />
      </MemoryRouter>
    );
    expect(screen.getByText(/当前各 Organ 模型/i)).toBeTruthy();
  });
});
