import React from 'react';
import { useApi } from '../../shared/hooks/useApi';

interface PendingActionsResponse {
  success: boolean;
  count: number;
  actions: unknown[];
}

export default function InboxBadge(): React.ReactElement | null {
  const { data } = useApi<PendingActionsResponse>('/api/brain/pending-actions', {
    pollInterval: 30000,
    staleTime: 15000,
  });

  const count = data?.count || 0;
  if (count === 0) return null;

  return (
    <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] flex items-center justify-center bg-red-500 text-white text-[10px] font-bold rounded-full px-1 leading-none">
      {count > 99 ? '99+' : count}
    </span>
  );
}
