import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { afterEach, expect, it } from 'vitest';
import planning from '@features/core/planning';
import gtd from '@features/core/gtd';
import work from '@features/core/work';
import knowledge from '@features/core/knowledge';
import system from '@features/core/system-hub';

const manifests = [planning, gtd, work, knowledge, system];
afterEach(cleanup);
it.each(['/okr', '/work/okr', '/gtd/okr', '/okr/tree', '/work/okr/area/example', '/okr-roadmap', '/knowledge/strategy-tree'])('旧展示地址 %s 不再注册为产品页面或重定向', path => {
  render(<MemoryRouter initialEntries={[path]}><Routes>{manifests.flatMap(m => m.routes).map((route, i) => <Route key={i} path={route.path} element={<div>旧入口仍注册</div>} />)}<Route path="*" element={<div>入口已退役</div>} /></Routes></MemoryRouter>);
  expect(screen.getByText('入口已退役')).toBeInTheDocument();
});
it('导航保留执行与证据及GTD领域项目任务，不再发布旧OKR入口', () => {
  const nav = manifests.flatMap(m => m.routes).flatMap(r => r.navItem ? [r.navItem] : []);
  expect(planning.routes.find(r => r.path === '/map')?.navItem?.label).toBe('执行与证据');
  const children = nav.flatMap(n => n.children ?? []);
  expect(children.some(n => ['/gtd/okr', '/okr-roadmap'].includes(n.path))).toBe(false);
  for (const path of ['/gtd/area', '/gtd/projects', '/gtd/tasks']) expect(children.some(n => n.path === path)).toBe(true);
});
