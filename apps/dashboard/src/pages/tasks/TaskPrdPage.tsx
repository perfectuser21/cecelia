/**
 * Task PRD Viewer
 *
 * 用户从 PR body 的 "📋 PRD: <link>" 点进来，看任务的 PRD 全文。
 * 数据来源：GET /api/brain/tasks/:id（已有 endpoint，复用 vite proxy）。
 *
 * Day 2 Epic A — A1（PRD SSOT 第一步）。
 */

import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

interface Task {
  id: string;
  title: string;
  status: string;
  priority: string;
  task_type: string;
  description: string | null;
  prd_content: string | null;
  pr_url: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  payload: { prd_summary?: string } | null;
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string; status?: number }
  | { kind: 'loaded'; task: Task };

function statusColor(status: string): string {
  switch (status) {
    case 'completed': return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
    case 'in_progress': return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200';
    case 'queued': return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200';
    case 'failed':
    case 'canceled':
    case 'cancelled': return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200';
    default: return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200';
  }
}

function priorityColor(priority: string): string {
  switch (priority) {
    case 'P0': return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200';
    case 'P1': return 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200';
    case 'P2': return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200';
    default: return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200';
  }
}

function pickPrdContent(task: Task): string {
  return task.description || task.prd_content || task.payload?.prd_summary || '';
}

export default function TaskPrdPage() {
  const { id } = useParams<{ id: string }>();
  const [state, setState] = useState<LoadState>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    if (!id) {
      setState({ kind: 'error', message: 'Missing task id in URL' });
      return;
    }
    (async () => {
      try {
        const res = await fetch(`/api/brain/tasks/${encodeURIComponent(id)}`);
        if (!res.ok) {
          if (cancelled) return;
          if (res.status === 404) {
            setState({ kind: 'error', message: `Task ${id} not found`, status: 404 });
          } else {
            setState({
              kind: 'error',
              message: `Failed to fetch task: HTTP ${res.status}`,
              status: res.status,
            });
          }
          return;
        }
        const task = (await res.json()) as Task;
        if (cancelled) return;
        setState({ kind: 'loaded', task });
      } catch (err) {
        if (cancelled) return;
        setState({
          kind: 'error',
          message: err instanceof Error ? err.message : 'Network error',
        });
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  if (state.kind === 'loading') {
    return (
      <div className="max-w-4xl mx-auto py-12 text-center text-gray-500 dark:text-gray-400">
        Loading task PRD…
      </div>
    );
  }

  if (state.kind === 'error') {
    const isNotFound = state.status === 404;
    return (
      <div className="max-w-4xl mx-auto py-12">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-white mb-3">
          {isNotFound ? 'Task not found' : 'Failed to load task PRD'}
        </h1>
        <p className="text-gray-600 dark:text-gray-400 mb-4">{state.message}</p>
        <p className="text-sm text-gray-500 dark:text-gray-500">
          请确认 task id 正确，且 Brain（http://localhost:5221）正在运行。
        </p>
      </div>
    );
  }

  const { task } = state;
  const prd = pickPrdContent(task);

  return (
    <div className="max-w-4xl mx-auto py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-white mb-3">
          {task.title}
        </h1>
        <div className="flex flex-wrap gap-2 text-xs">
          <span className={`px-2 py-1 rounded ${statusColor(task.status)}`}>
            {task.status}
          </span>
          <span className={`px-2 py-1 rounded ${priorityColor(task.priority)}`}>
            {task.priority}
          </span>
          <span className="px-2 py-1 rounded bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200">
            {task.task_type}
          </span>
          {task.pr_url && (
            <a
              href={task.pr_url}
              target="_blank"
              rel="noopener noreferrer"
              className="px-2 py-1 rounded bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200 hover:underline"
            >
              View PR ↗
            </a>
          )}
        </div>
        <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
          Created {task.created_at} · Updated {task.updated_at}
          {task.completed_at && ` · Completed ${task.completed_at}`}
        </div>
      </div>

      <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
        <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2 uppercase tracking-wide">
          PRD
        </h2>
        {prd ? (
          <pre className="whitespace-pre-wrap break-words font-mono text-sm leading-relaxed text-gray-800 dark:text-gray-100 bg-gray-50 dark:bg-gray-900 p-4 rounded border border-gray-200 dark:border-gray-700">
            {prd}
          </pre>
        ) : (
          <p className="text-gray-500 italic">
            (No PRD content — this task was created without a description / prd_content / payload.prd_summary.)
          </p>
        )}
      </div>
    </div>
  );
}
