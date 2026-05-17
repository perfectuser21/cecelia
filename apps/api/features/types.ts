import { ComponentType } from 'react';

// Instance types for feature visibility (simplified to only 'core')
export type InstanceType = 'core';

// Navigation group configuration
export interface FeatureNavGroup {
  id: string;
  label: string;
  icon?: string;
  order?: number;
}

// Route configuration for a feature
export interface FeatureRoute {
  path: string;
  component?: string;  // Component key in manifest.components
  redirect?: string;   // Redirect to another path
  requireAuth?: boolean;
  navItem?: {
    label: string;
    icon?: string;
    group?: string;   // Group ID to nest under
    order?: number;
    children?: Array<{
      path: string;
      label: string;
      icon?: string;
      order?: number;
    }>;
  };
}

// Feature manifest - each feature exports this
export interface FeatureManifest {
  id: string;                   // e.g., 'claude-monitor'
  name: string;                 // e.g., 'Claude Monitor'
  version: string;
  source: 'core' | 'autopilot';

  navGroups?: FeatureNavGroup[];
  routes: FeatureRoute[];

  // Lazy-loaded components
  components: Record<string, () => Promise<{ default: ComponentType<any> }>>;

  // Which instances can see this feature (undefined = all)
  instances?: InstanceType[];
}

// Registered feature with resolved components
export interface RegisteredFeature extends Omit<FeatureManifest, 'components'> {
  components: Record<string, () => Promise<{ default: ComponentType<any> }>>;
  loaded: boolean;
}

// Navigation item for UI rendering
export interface NavItem {
  id: string;
  label: string;
  path?: string;
  icon?: string;
  order?: number;
  children?: NavItem[];
  featureId?: string;
}

// Feature context for components
export interface FeatureContext {
  featureId: string;
  instance: InstanceType;
}

// Theme configuration for an instance
export interface ThemeConfig {
  logo: string;
  logoCollapsed?: string;
  favicon?: string;
  primaryColor: string;
  secondaryColor?: string;
  sidebarGradient?: string;
}

// Instance configuration (theme + identity)
export interface InstanceConfig {
  instance: string;
  name: string;
  theme: ThemeConfig;
}

// Route configuration for DynamicRouter
export interface CoreRoute {
  path: string;
  component?: string;
  redirect?: string;
  requireAuth?: boolean;
}

// Built configuration from Core features
export interface CoreConfig {
  instanceConfig: InstanceConfig;
  navGroups: NavGroup[];
  pageComponents: Record<string, () => Promise<{ default: ComponentType<unknown> }>>;
  allRoutes: CoreRoute[];  // All routes including non-nav routes
}

// Navigation group for UI (matches Autopilot's NavGroup)
export interface NavGroup {
  title: string;
  items: NavGroupItem[];
}

export interface NavGroupItem {
  path: string;
  icon: string;
  label: string;
  featureKey: string;
  component?: string;
  requireSuperAdmin?: boolean;
  children?: NavGroupItem[];
}
