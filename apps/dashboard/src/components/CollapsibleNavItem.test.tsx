import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { Circle } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';
import CollapsibleNavItem from './CollapsibleNavItem';
import type { NavItem } from '../config/navigation.config';

vi.mock('react-router-dom', () => ({
  Link: ({ to, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) => (
    <a href={to} {...props}>{children}</a>
  ),
}));

const workbenchItem: NavItem = {
  path: '/workbench',
  icon: Circle,
  label: 'Workbench',
  featureKey: 'workbench',
  children: [
    {
      path: '/workbench/overview',
      icon: Circle,
      label: 'Overview',
      featureKey: 'workbench',
    },
    {
      path: '/workbench/inbox',
      icon: Circle,
      label: 'Inbox',
      featureKey: 'workbench',
    },
    {
      path: '/workbench/tasks',
      icon: Circle,
      label: 'Tasks',
      featureKey: 'workbench',
    },
    {
      path: '/workbench/activity',
      icon: Circle,
      label: 'Activity',
      featureKey: 'workbench',
    },
    {
      path: '/workbench/projections',
      icon: Circle,
      label: 'Projections',
      featureKey: 'workbench',
    },
  ],
};

function CollapsedNavigationHarness() {
  const [collapsed, setCollapsed] = useState(true);

  return (
    <>
      <CollapsibleNavItem
        item={workbenchItem}
        collapsed={collapsed}
        isCore
        currentPath="/reports"
        onExpandSidebar={() => setCollapsed(false)}
      />
    </>
  );
}

describe('CollapsibleNavItem', () => {
  it('点击折叠的父入口时展开子页面并保留当前路由', () => {
    render(<CollapsedNavigationHarness />);

    const collapsedParent = screen.getByTitle('Workbench');
    expect(collapsedParent.tagName).toBe('BUTTON');

    fireEvent.click(collapsedParent);

    expect(screen.getByRole('link', { name: 'Overview' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Inbox' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Tasks' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Activity' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Projections' })).toBeVisible();
  });
});
