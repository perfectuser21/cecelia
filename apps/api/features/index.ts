// Feature Registry and Types
export * from './types';
export * from './registry';
export { coreInstanceConfig, coreTheme } from './config';

import type { CoreConfig, CoreRoute, FeatureManifest } from './types';
import { coreInstanceConfig } from './config';
import { buildCoreNavigation } from './navigation';

// Feature manifests - 12 entries
export const coreFeatures = {
  'workbench': () => import('./workbench'),
  'dashboard': () => import('./dashboard'),
  'inbox': () => import('./inbox'),
  'gtd': () => import('./gtd'),
  'planning': () => import('./planning'),
  'today': () => import('./today'),
  'work': () => import('./work'),
  'execution': () => import('./execution'),
  'knowledge': () => import('./knowledge'),
  'system-hub': () => import('./system-hub'),
  'system': () => import('./system'),
  'profile': () => import('./profile'),
  'cecelia': () => import('./cecelia'),
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

  const navGroups = buildCoreNavigation();
  const pageComponents = collectPageComponents(manifests);
  const allRoutes = collectAllRoutes(manifests);

  return {
    instanceConfig: coreInstanceConfig,
    navGroups,
    pageComponents,
    allRoutes,
  };
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
