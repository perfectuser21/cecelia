// Feature Registry and Types
export * from './types';
export * from './registry';
export { coreInstanceConfig, coreTheme } from './config';

import type { CoreConfig, CoreRoute, NavGroup, NavGroupItem, FeatureManifest } from './types';
import { coreInstanceConfig } from './config';

// Feature manifests - 5 domains
export const coreFeatures = {
  'planning': () => import('./planning'),
  'execution': () => import('./execution'),
  'business': () => import('./business'),
  'system': () => import('./system'),
  'knowledge': () => import('./knowledge'),
};

// Load all features and register them
export async function loadAllFeatures() {
  const { featureRegistry } = await import('./registry');

  const manifests = await Promise.all(
    Object.values(coreFeatures).map(loader => loader().then(m => m.default))
  );

  featureRegistry.registerAll(manifests);
  return featureRegistry;
}

/**
 * Build complete Core configuration from feature manifests
 * This is the main entry point for Autopilot to load Core config dynamically
 */
export async function buildCoreConfig(): Promise<CoreConfig> {
  const manifests = await Promise.all(
    Object.values(coreFeatures).map(loader => loader().then(m => m.default))
  );

  const navGroups = buildNavGroupsFromManifests(manifests);
  const pageComponents = collectPageComponents(manifests);
  const allRoutes = collectAllRoutes(manifests);

  return {
    instanceConfig: coreInstanceConfig,
    navGroups,
    pageComponents,
    allRoutes,
  };
}

function buildNavGroupsFromManifests(manifests: FeatureManifest[]): NavGroup[] {
  const groupMap = new Map<string, { label: string; icon?: string; order: number; items: NavGroupItem[] }>();

  for (const manifest of manifests) {
    if (manifest.navGroups) {
      for (const group of manifest.navGroups) {
        if (!groupMap.has(group.id)) {
          groupMap.set(group.id, {
            label: group.label,
            icon: group.icon,
            order: group.order ?? 0,
            items: [],
          });
        }
      }
    }
  }

  const topLevelItems: NavGroupItem[] = [];

  for (const manifest of manifests) {
    for (const route of manifest.routes) {
      if (!route.navItem) continue;

      const navItem: NavGroupItem = {
        path: route.path,
        icon: route.navItem.icon || 'Circle',
        label: route.navItem.label,
        featureKey: `${manifest.id}-${route.component}`,
        component: route.component,
      };

      if (route.navItem.group) {
        const group = groupMap.get(route.navItem.group);
        if (group) {
          group.items.push({ ...navItem, order: route.navItem.order } as NavGroupItem & { order?: number });
        } else {
          topLevelItems.push(navItem);
        }
      } else {
        topLevelItems.push({ ...navItem, order: route.navItem.order } as NavGroupItem & { order?: number });
      }
    }
  }

  for (const group of groupMap.values()) {
    group.items.sort((a, b) => ((a as any).order ?? 0) - ((b as any).order ?? 0));
  }

  topLevelItems.sort((a, b) => ((a as any).order ?? 0) - ((b as any).order ?? 0));

  const result: NavGroup[] = [];

  const sortedGroups = Array.from(groupMap.entries())
    .sort((a, b) => a[1].order - b[1].order);

  for (const [, group] of sortedGroups) {
    result.push({
      title: group.label,
      items: group.items,
    });
  }

  if (topLevelItems.length > 0) {
    result.push({
      title: '',
      items: topLevelItems,
    });
  }

  return result;
}

function collectPageComponents(manifests: FeatureManifest[]): Record<string, () => Promise<{ default: any }>> {
  const components: Record<string, () => Promise<{ default: any }>> = {};

  for (const manifest of manifests) {
    for (const [key, loader] of Object.entries(manifest.components)) {
      components[key] = loader;
    }
  }

  return components;
}

function collectAllRoutes(manifests: FeatureManifest[]): CoreRoute[] {
  const routes: CoreRoute[] = [];

  for (const manifest of manifests) {
    for (const route of manifest.routes) {
      if (route.redirect) {
        routes.push({
          path: route.path,
          redirect: route.redirect,
          requireAuth: false,
        });
      } else if (route.component) {
        routes.push({
          path: route.path,
          component: route.component,
          requireAuth: route.requireAuth ?? true,
        });
      }
    }
  }

  return routes;
}
