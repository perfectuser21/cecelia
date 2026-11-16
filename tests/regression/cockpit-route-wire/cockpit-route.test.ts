import { describe, it, expect } from 'vitest';
import dashboard from '../../../apps/api/features/dashboard';
import workbench from '../../../apps/api/features/workbench';
import OwnerCockpitPage from '../../../apps/dashboard/src/pages/owner-cockpit/OwnerCockpitPage';
import GTDInbox from '../../../apps/api/features/gtd/pages/GTDInbox';

describe('OwnerCockpit 工作台入口', () => {
  it('真实manifest根路由和工作台入口都转入运行诊断', () => {
    expect(dashboard.routes.find(route => route.path === '/')?.redirect).toBe('/system');
    expect(workbench.routes.find(route => route.path === '/workbench')?.redirect).toBe('/system');
  });

  it('Overview与Inbox路由的真实loader分别交付对应页面组件', async () => {
    const overview = workbench.routes.find(route => route.path === '/workbench/overview');
    const inbox = workbench.routes.find(route => route.path === '/workbench/inbox');
    expect(overview?.component).toBe('WorkbenchOverview');
    expect(inbox?.component).toBe('WorkbenchInbox');
    const [overviewModule, inboxModule] = await Promise.all([
      workbench.components![overview!.component!](),
      workbench.components![inbox!.component!](),
    ]);
    expect(overviewModule.default).toBe(OwnerCockpitPage);
    expect(inboxModule.default).toBe(GTDInbox);
  });
});
