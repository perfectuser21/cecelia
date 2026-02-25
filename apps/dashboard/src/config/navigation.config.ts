/**
 * Navigation Config - Shared types and utilities
 *
 * Core navigation is loaded dynamically from InstanceContext.coreConfig.navGroups.
 * This file provides shared type definitions and helper functions.
 */

import type { LucideIcon } from 'lucide-react';

// ============ Type Definitions ============

export interface NavItem {
  path: string;
  icon: LucideIcon;
  label: string;
  featureKey: string;
  requireSuperAdmin?: boolean;
  component?: string;
  redirect?: string;
  children?: NavItem[];
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

export interface RouteConfig {
  path: string;
  component?: string;
  redirect?: string;
  requireAuth?: boolean;
  requireSuperAdmin?: boolean;
}

// ============ Utility Functions ============

/**
 * Filter nav groups by feature flags and permissions
 */
export function filterNavGroups(
  groups: NavGroup[],
  isFeatureEnabled: (key: string) => boolean,
  isSuperAdmin: boolean
): NavGroup[] {
  return groups
    .map(group => ({
      ...group,
      items: group.items
        .filter(item => {
          if (!isFeatureEnabled(item.featureKey)) return false;
          if (item.requireSuperAdmin && !isSuperAdmin) return false;
          return true;
        })
        .map(item => ({
          ...item,
          children: item.children?.filter(child => {
            if (!isFeatureEnabled(child.featureKey)) return false;
            if (child.requireSuperAdmin && !isSuperAdmin) return false;
            return true;
          }),
        })),
    }))
    .filter(group => group.items.length > 0);
}
