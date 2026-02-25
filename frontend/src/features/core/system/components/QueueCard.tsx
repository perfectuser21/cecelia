import { useState, useEffect } from 'react';
import { Inbox, AlertTriangle } from 'lucide-react';

export default function QueueCard() {
  const [queueLength, setQueueLength] = useState(0);

  useEffect(() => {
    const fetchQueue = async () => {
      try {
        const res = await fetch('/api/quality/queue');
        if (res.ok) {
          const tasks = await res.json();
          setQueueLength(tasks.length);
        }
      } catch (err) {
        console.error('Failed to fetch queue:', err);
      }
    };

    fetchQueue();
    const interval = setInterval(fetchQueue, 5000);
    return () => clearInterval(interval);
  }, []);

  const isHigh = queueLength > 5;

  return (
    <div className={`${
      isHigh ? 'bg-red-900/30 border border-red-700' : 'bg-slate-800'
    } rounded-lg p-6 text-white`}>
      {isHigh ? (
        <AlertTriangle className="w-8 h-8 mb-2 text-red-400" />
      ) : (
        <Inbox className="w-8 h-8 mb-2 text-slate-400" />
      )}
      <p className="text-sm opacity-90">Queue Length</p>
      <p className={`text-2xl font-bold mt-1 ${isHigh ? 'text-red-400' : ''}`}>
        {queueLength}
      </p>
    </div>
  );
}
