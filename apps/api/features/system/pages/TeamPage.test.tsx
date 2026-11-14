import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import TeamPage from './TeamPage';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('员工目录及能力详情只读取员工信息，不依赖模型或账号配置接口', async () => {
  const worker = {
    id: 'reviewer', name: '审查员', role: '代码审查', description: '核对交付证据',
    skill: '/review', abilities: [{ id: 'inspect', name: '核验', description: '独立检查真实结果' }],
    model: { provider: 'openai', name: 'configured-runtime-model', credentials_file: null, full_map: {} },
  };
  const fetchMock = vi.fn(async (url: string) => {
    if (url !== '/api/brain/staff') throw new Error(`员工目录不应请求 ${url}`);
    return { ok: true, json: async () => ({ teams: [{ id: 'core', name: '核心团队', area: 'cecelia', workers: [worker] }], total_workers: 1 }) };
  });
  vi.stubGlobal('fetch', fetchMock);
  render(<TeamPage />);
  fireEvent.click(await screen.findByRole('button', { name: '核心团队' }));
  fireEvent.click(await screen.findByRole('button', { name: /审查员/ }));
  expect(screen.getByText('独立检查真实结果')).toBeVisible();
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  expect(fetchMock.mock.calls.every(([url]) => url === '/api/brain/staff')).toBe(true);
});
