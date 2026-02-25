import { FeatureManifest, RegisteredFeature, NavItem, InstanceType } from './types';

class FeatureRegistry {
  private features: Map<string, RegisteredFeature> = new Map();
  private currentInstance: InstanceType = 'core';

  setInstance(instance: InstanceType) {
    this.currentInstance = instance;
  }

  getInstance(): InstanceType {
    return this.currentInstance;
  }

  register(manifest: FeatureManifest) {
    const feature: RegisteredFeature = {
      ...manifest,
      loaded: true,
    };
    this.features.set(manifest.id, feature);
  }

  registerAll(manifests: FeatureManifest[]) {
    manifests.forEach(m => this.register(m));
  }

  get(id: string): RegisteredFeature | undefined {
    return this.features.get(id);
  }

  getAll(): RegisteredFeature[] {
    return Array.from(this.features.values());
  }

  // Get features visible for current instance
  getVisible(): RegisteredFeature[] {
    return this.getAll().filter(f => {
      if (!f.instances) return true;
      return f.instances.includes(this.currentInstance);
    });
  }

  // Build navigation structure from visible features
  buildNavigation(): NavItem[] {
    const features = this.getVisible();
    const navGroups: Map<string, NavItem> = new Map();
    const topLevelItems: NavItem[] = [];

    // First pass: collect nav groups
    features.forEach(feature => {
      feature.navGroups?.forEach(group => {
        if (!navGroups.has(group.id)) {
          navGroups.set(group.id, {
            id: group.id,
            label: group.label,
            icon: group.icon,
            order: group.order,
            children: [],
          });
        }
      });
    });

    // Second pass: add routes to groups or top level
    features.forEach(feature => {
      feature.routes.forEach(route => {
        if (!route.navItem) return;

        const navItem: NavItem = {
          id: `${feature.id}-${route.path}`,
          label: route.navItem.label,
          path: route.path,
          icon: route.navItem.icon,
          order: route.navItem.order,
          featureId: feature.id,
        };

        if (route.navItem.group) {
          const group = navGroups.get(route.navItem.group);
          if (group) {
            group.children = group.children || [];
            group.children.push(navItem);
          } else {
            topLevelItems.push(navItem);
          }
        } else {
          topLevelItems.push(navItem);
        }
      });
    });

    // Sort children within groups
    navGroups.forEach(group => {
      group.children?.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    });

    // Combine groups and top-level items, sorted by order
    const result = [
      ...Array.from(navGroups.values()),
      ...topLevelItems,
    ].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    return result;
  }

  // Get route configurations for router
  getRoutes() {
    const features = this.getVisible();
    return features.flatMap(feature =>
      feature.routes.map(route => ({
        path: route.path,
        componentKey: route.component,
        featureId: feature.id,
        loader: feature.components[route.component],
      }))
    );
  }

  // Get component loader by feature and key
  getComponent(featureId: string, componentKey: string) {
    const feature = this.features.get(featureId);
    return feature?.components[componentKey];
  }
}

// Singleton instance
export const featureRegistry = new FeatureRegistry();

// Detect instance from hostname
export function detectInstance(): InstanceType {
  if (typeof window === 'undefined') return 'core';

  const hostname = window.location.hostname;
  if (hostname.startsWith('dashboard.')) return 'dashboard';
  if (hostname.includes('core.')) return 'core';  // Matches both 'core.' and 'dev-core.'

  // Default based on port for development
  const port = window.location.port;
  if (port === '5211' || port === '5212') return 'core';

  return 'core';
}

// Initialize registry with instance detection
export function initRegistry() {
  const instance = detectInstance();
  featureRegistry.setInstance(instance);
  return instance;
}
