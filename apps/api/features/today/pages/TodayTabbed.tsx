import { CalendarDays, CalendarClock, ListTodo } from 'lucide-react';
import TabbedPage from '../../shared/components/TabbedPage';
import type { TabConfig } from '../../shared/components/TabbedPage';

const tabs: TabConfig[] = [
  {
    id: 'daily',
    label: 'Daily',
    icon: CalendarDays,
    path: '/today',
    component: () => import('../../daily/pages/TodayView'),
  },
  {
    id: 'schedule',
    label: 'Schedule',
    icon: ListTodo,
    path: '/today/schedule',
    component: () => import('../../planning/pages/Tasks'),
  },
  {
    id: 'queue',
    label: 'Queue',
    icon: CalendarClock,
    path: '/today/queue',
    component: () => import('../../planning/pages/Scheduler'),
  },
];

export default function TodayTabbed() {
  return <TabbedPage tabs={tabs} basePath="/today" />;
}
