import { CheckCircle2, Clock, AlertCircle } from 'lucide-react';

interface StatusIconProps {
  status: string;
  size?: 'sm' | 'md';
}

export default function StatusIcon({ status, size = 'md' }: StatusIconProps) {
  const sizeClass = size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4';

  switch (status) {
    case 'completed':
      return <CheckCircle2 className={`${sizeClass} text-emerald-500`} />;
    case 'in_progress':
      return <Clock className={`${sizeClass} text-blue-500`} />;
    case 'cancelled':
      return <AlertCircle className={`${sizeClass} text-red-500`} />;
    default:
      return <Clock className={`${sizeClass} text-slate-400`} />;
  }
}
