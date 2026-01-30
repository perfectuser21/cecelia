import { FeatureManifest } from '../types';

const manifest: FeatureManifest = {
  id: 'planner',
  name: 'Task Intelligence',
  version: '1.1.0',
  source: 'core',
  instances: ['core'],

  routes: [
    { path: '/ops/planner', component: 'PlannerOverview' },
    { path: '/ops/planning', component: 'PlanningDashboard' },
    { path: '/ops/scheduler', component: 'Scheduler' },
    { path: '/ops/today', component: 'TodayPlan' },
  ],

  components: {
    PlannerOverview: () => import('./pages/PlannerOverview'),
    PlanningDashboard: () => import('./pages/PlanningDashboard'),
    Scheduler: () => import('./pages/Scheduler'),
    TodayPlan: () => import('./components/TodayPlan'),
  },
};

export default manifest;
