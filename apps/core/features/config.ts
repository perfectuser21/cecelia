/**
 * Core Instance Configuration
 *
 * Defines theme and instance-specific settings for the Core repository.
 * This allows Core to be self-contained without modifying Autopilot code.
 */

import type { ThemeConfig, InstanceConfig } from './types';

export const coreTheme: ThemeConfig = {
  logo: '/logo-white.png',
  logoCollapsed: 'P',
  primaryColor: '#94a3b8',  // slate-400 冷灰
  secondaryColor: '#cbd5e1', // slate-300
  sidebarGradient: 'linear-gradient(180deg, rgba(15,23,42,0.95) 0%, rgba(30,41,59,0.9) 50%, rgba(51,65,85,0.85) 100%)',
};

export const coreInstanceConfig: InstanceConfig = {
  instance: 'core',
  name: 'Perfect21',
  theme: coreTheme,
};
