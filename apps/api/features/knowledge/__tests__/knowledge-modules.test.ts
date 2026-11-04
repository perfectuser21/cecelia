import { createElement, type ComponentType } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import manifest from '../index';

const notionUrl = 'https://app.notion.com/p/770c40c2ba6383ea86d001eba832c218';
const selectedComponents = new Set(['KnowledgeHome', 'KnowledgeModules', 'KnowledgeModuleDetail']);
const legacyData = {
  meta: { total: 86, done: 76, last_updated: '2026-03-17' },
  groups: [{ id: 'brain', label: 'Brain 后端', items: [{
    id: 'brain-tick-loop', title: '旧Tick知识页', desc: '旧生成清单', priority: 'P0',
    status: 'done', completed: '2026-03-17', source_files: ['packages/brain/src/tick.js'],
    output_url: 'knowledge/brain/tick-loop.html',
  }] }],
};

async function renderRegisteredPage(url: string) {
  // 路由及组件loader均来自生产manifest，不复制导航数组或组件实现。
  const routes = await Promise.all(manifest.routes.filter(route =>
    route.component && selectedComponents.has(route.component)
  ).map(async route => {
    const loader = manifest.components![route.component!];
    const Page = (await loader()).default as ComponentType;
    return createElement(Route, { key: route.path, path: route.path, element: createElement(Page) });
  }));
  const view = render(createElement(MemoryRouter, { initialEntries: [url] },
    createElement(Routes, null, routes)));
  // 真实mount与effect均执行；不能用SSR不运行effect来冒充零fetch。
  await act(async () => { await Promise.resolve(); });
  return view;
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => legacyData })));
  vi.spyOn(window, 'open').mockImplementation(() => null);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function expectRetiredNotice(container: HTMLElement) {
  expect(screen.getByRole('heading', { name: '旧知识生成进度已退役' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: '前往 Notion 知识库' })).toHaveAttribute('href', notionUrl);
  expect(container.textContent).not.toMatch(/86|76|已完成|待生成|已生成|Codex/);
  expect(container.innerHTML).not.toContain('38.23.47.81');
  expect(fetch).not.toHaveBeenCalled();
  expect(window.open).not.toHaveBeenCalled();
}

describe('旧知识生成面退役，真实页面与导航保留诚实入口', () => {
  it.each(['/knowledge/modules', '/knowledge/modules/brain/brain-tick-loop', '/knowledge/modules/unknown/unknown'])
  ('真实注册路由%s只显示退役说明，不读取旧生成清单', async url => {
    const { container } = await renderRegisteredPage(url);
    expectRetiredNotice(container);
  });

  it('首页现有卡片仍导航到退役说明，不再宣称86个当前模块', async () => {
    const { container } = await renderRegisteredPage('/knowledge');
    expect(container.textContent).not.toContain('86');
    fireEvent.click(screen.getByRole('button', { name: /深度知识页/ }));
    await act(async () => { await Promise.resolve(); });
    expectRetiredNotice(container);
    expect(manifest.routes.find(route => route.path === '/knowledge/modules')?.navItem).toMatchObject({
      group: 'knowledge-docs',
    });
  });
});
