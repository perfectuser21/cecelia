import { useEffect } from 'react';
import { CheckCircle, XCircle, AlertTriangle, Info, X } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

interface ToastProps {
  message: string;
  type: ToastType;
  onClose: () => void;
  duration?: number;
}

export default function Toast({ message, type, onClose, duration = 5000 }: ToastProps) {
  useEffect(() => {
    if (duration > 0) {
      const timer = setTimeout(onClose, duration);
      return () => clearTimeout(timer);
    }
  }, [duration, onClose]);

  const config = {
    success: {
      icon: CheckCircle,
      bg: 'bg-emerald-600',
      border: 'border-emerald-500',
    },
    error: {
      icon: XCircle,
      bg: 'bg-red-600',
      border: 'border-red-500',
    },
    warning: {
      icon: AlertTriangle,
      bg: 'bg-yellow-600',
      border: 'border-yellow-500',
    },
    info: {
      icon: Info,
      bg: 'bg-blue-600',
      border: 'border-blue-500',
    },
  };

  const { icon: Icon, bg, border } = config[type];

  return (
    <div className={`fixed bottom-4 right-4 z-50 ${bg} border ${border} rounded-lg shadow-lg p-4 flex items-center gap-3 min-w-[300px] max-w-md`}>
      <Icon className="w-5 h-5 text-white flex-shrink-0" />
      <p className="text-white text-sm flex-1">{message}</p>
      <button
        onClick={onClose}
        className="text-white/80 hover:text-white p-1 rounded hover:bg-white/10 transition flex-shrink-0"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
