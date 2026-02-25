import { Calendar } from 'lucide-react';
import { useApi } from '../../shared/hooks/useApi';
import { SkeletonRow } from '../../shared/components/LoadingState';

interface Task {
  id: string;
  title: string;
  status: string;
  priority: string;
}

export default function TodayView() {
  const { data: tasks, loading } = useApi<Task[]>('/api/tasks/tasks?status=in_progress', {
    initialData: [],
    staleTime: 30_000,
  });

  const today = new Date().toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  });

  return (
    <div style={{ padding: '24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
        <Calendar size={24} />
        <h1 style={{ fontSize: '24px', fontWeight: 600, margin: 0 }}>Daily Setup</h1>
      </div>
      <p style={{ color: '#64748b', fontSize: '14px', marginBottom: '24px' }}>{today}</p>

      <h2 style={{ fontSize: '16px', fontWeight: 500, marginBottom: '12px' }}>进行中的任务</h2>

      {loading && !tasks?.length ? (
        <div>
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </div>
      ) : !tasks?.length ? (
        <p style={{ color: '#64748b', fontSize: '14px' }}>暂无进行中的任务</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {tasks.map(task => (
            <div
              key={task.id}
              style={{
                padding: '12px 16px',
                borderRadius: '8px',
                border: '1px solid rgba(148, 163, 184, 0.2)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <span style={{ fontSize: '14px' }}>{task.title}</span>
              <span style={{
                fontSize: '12px',
                padding: '2px 8px',
                borderRadius: '4px',
                background: task.priority === 'P0' ? 'rgba(239,68,68,0.1)' : 'rgba(148,163,184,0.1)',
                color: task.priority === 'P0' ? '#ef4444' : '#94a3b8',
              }}>
                {task.priority}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
