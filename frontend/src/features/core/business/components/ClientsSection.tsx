/**
 * ClientsSection - Client project delivery (placeholder)
 */

import { FolderKanban, Clock, AlertCircle } from 'lucide-react';

interface Props {
  loading: boolean;
}

export default function ClientsSection({ loading }: Props) {
  if (loading) {
    return (
      <div className="h-32 bg-slate-100 dark:bg-slate-700/50 rounded-xl animate-pulse" />
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-4">
        <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 text-center">
          <FolderKanban className="w-5 h-5 text-emerald-500 mx-auto mb-2" />
          <p className="text-2xl font-bold text-emerald-500">-</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">Active</p>
        </div>
        <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-900/20 text-center">
          <Clock className="w-5 h-5 text-amber-500 mx-auto mb-2" />
          <p className="text-2xl font-bold text-amber-500">-</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">Due Soon</p>
        </div>
        <div className="p-4 rounded-xl bg-red-50 dark:bg-red-900/20 text-center">
          <AlertCircle className="w-5 h-5 text-red-500 mx-auto mb-2" />
          <p className="text-2xl font-bold text-red-500">-</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">At Risk</p>
        </div>
      </div>
      <p className="text-xs text-slate-400 dark:text-slate-500 text-center">
        Connect Notion to see client projects
      </p>
    </div>
  );
}
