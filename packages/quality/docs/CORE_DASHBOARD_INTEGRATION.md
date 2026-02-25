# Core Dashboard Integration Guide

> How to integrate Cecelia Quality Platform API into Core website (Next.js)

---

## Overview

This guide shows how to integrate the Cecelia Quality Platform Dashboard API into the Core website to display real-time quality metrics, task queues, run history, and failure reports.

---

## Architecture

```
Core Website (Next.js)
    ↓ fetch
Dashboard API (Port 5681)
    ↓ read
State / Queue / Runs (File System)
```

---

## Environment Variables

Add these to your Core website's `.env.local`:

```bash
# Cecelia Quality API
NEXT_PUBLIC_CECELIA_API_URL=http://localhost:5681
CECELIA_API_URL_SERVER=http://localhost:5681

# For production (if exposed via Cloudflare Tunnel)
NEXT_PUBLIC_CECELIA_API_URL=https://api-quality.zenjoymedia.media
```

---

## TypeScript Types

Create `lib/cecelia-api-types.ts`:

```typescript
export interface SystemState {
  health: 'ok' | 'degraded' | 'down';
  derivedHealth: 'green' | 'yellow' | 'red';
  queueLength: number;
  priorityCounts: {
    P0: number;
    P1: number;
    P2: number;
  };
  lastRun: {
    taskId: string;
    completedAt: string;
    status: 'succeeded' | 'failed';
  } | null;
  lastHeartbeat: string | null;
  stats: {
    totalTasks: number;
    successRate: number;
  };
  systemHealth: {
    inbox_count: number;
    todo_count: number;
    doing_count: number;
    done_count: number;
    failed_24h: number;
  };
  timestamp: string;
}

export interface QueueTask {
  taskId: string;
  source: 'cloudcode' | 'notion' | 'n8n' | 'webhook' | 'heartbeat';
  intent: 'runQA' | 'fixBug' | 'refactor' | 'review' | 'summarize' | 'optimizeSelf';
  priority: 'P0' | 'P1' | 'P2';
  payload: Record<string, any>;
  createdAt: string;
  age?: number;
}

export interface Run {
  runId: string;
  taskId: string;
  intent: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed';
  startedAt: string;
  completedAt: string | null;
  duration: number | null;
  error?: string;
}

export interface RunDetail extends Run {
  task: QueueTask;
  result?: any;
  evidence?: string[];
  logs?: string;
}
```

---

## API Client Functions

Create `lib/cecelia-api.ts`:

```typescript
import type { SystemState, QueueTask, Run, RunDetail } from './cecelia-api-types';

const API_BASE = process.env.NEXT_PUBLIC_CECELIA_API_URL || 'http://localhost:5681';

async function fetchAPI<T>(endpoint: string): Promise<T> {
  const res = await fetch(`${API_BASE}${endpoint}`, {
    headers: {
      'Content-Type': 'application/json',
    },
    next: { revalidate: 30 }, // Cache for 30 seconds
  });

  if (!res.ok) {
    throw new Error(`API error: ${res.status} ${res.statusText}`);
  }

  return res.json();
}

export async function getSystemState(): Promise<SystemState> {
  return fetchAPI<SystemState>('/api/state');
}

export async function getQueue(limit: number = 10): Promise<QueueTask[]> {
  return fetchAPI<QueueTask[]>(`/api/queue?limit=${limit}`);
}

export async function getRecentRuns(limit: number = 20): Promise<Run[]> {
  return fetchAPI<Run[]>(`/api/runs?limit=${limit}`);
}

export async function getRunDetail(runId: string): Promise<RunDetail> {
  return fetchAPI<RunDetail>(`/api/runs/${runId}`);
}

export async function getFailures(limit: number = 10): Promise<Run[]> {
  return fetchAPI<Run[]>(`/api/failures?limit=${limit}`);
}

export async function getHealth(): Promise<{ status: string; timestamp: string }> {
  return fetchAPI('/api/health');
}

export function getEvidenceURL(runId: string, filename: string): string {
  return `${API_BASE}/api/runs/${runId}/evidence/${filename}`;
}
```

---

## Dashboard Page Example

Create `app/quality/page.tsx`:

```typescript
import { getSystemState, getQueue, getRecentRuns, getFailures } from '@/lib/cecelia-api';

export default async function QualityDashboard() {
  const [state, queue, runs, failures] = await Promise.all([
    getSystemState(),
    getQueue(5),
    getRecentRuns(10),
    getFailures(5),
  ]);

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Global Health */}
      <section className="bg-white rounded-lg shadow p-6">
        <h2 className="text-2xl font-bold mb-4">System Health</h2>
        <div className="grid grid-cols-4 gap-4">
          <div className={`p-4 rounded-lg ${
            state.derivedHealth === 'green' ? 'bg-green-100' :
            state.derivedHealth === 'yellow' ? 'bg-yellow-100' : 'bg-red-100'
          }`}>
            <div className="text-3xl font-bold">
              {state.derivedHealth === 'green' ? '✅' :
               state.derivedHealth === 'yellow' ? '⚠️' : '❌'}
            </div>
            <div className="text-sm text-gray-600">Health</div>
          </div>
          
          <div className="p-4 rounded-lg bg-blue-100">
            <div className="text-3xl font-bold">{state.queueLength}</div>
            <div className="text-sm text-gray-600">Queue Length</div>
          </div>
          
          <div className="p-4 rounded-lg bg-purple-100">
            <div className="text-3xl font-bold">{state.stats.totalTasks}</div>
            <div className="text-sm text-gray-600">Total Tasks</div>
          </div>
          
          <div className="p-4 rounded-lg bg-emerald-100">
            <div className="text-3xl font-bold">
              {(state.stats.successRate * 100).toFixed(1)}%
            </div>
            <div className="text-sm text-gray-600">Success Rate</div>
          </div>
        </div>
      </section>

      {/* Queue */}
      <section className="bg-white rounded-lg shadow p-6">
        <h2 className="text-2xl font-bold mb-4">Queue ({state.queueLength})</h2>
        <div className="space-y-2">
          {queue.map(task => (
            <div key={task.taskId} className="p-3 border rounded flex items-center justify-between">
              <div>
                <span className={`px-2 py-1 rounded text-xs ${
                  task.priority === 'P0' ? 'bg-red-100 text-red-700' :
                  task.priority === 'P1' ? 'bg-yellow-100 text-yellow-700' :
                  'bg-gray-100 text-gray-700'
                }`}>
                  {task.priority}
                </span>
                <span className="ml-2 font-medium">{task.intent}</span>
                <span className="ml-2 text-sm text-gray-500">from {task.source}</span>
              </div>
              <span className="text-sm text-gray-400">{task.age}s ago</span>
            </div>
          ))}
        </div>
      </section>

      {/* Recent Runs */}
      <section className="bg-white rounded-lg shadow p-6">
        <h2 className="text-2xl font-bold mb-4">Recent Runs</h2>
        <div className="space-y-2">
          {runs.map(run => (
            <a
              key={run.runId}
              href={`/quality/runs/${run.runId}`}
              className="block p-3 border rounded hover:bg-gray-50 transition"
            >
              <div className="flex items-center justify-between">
                <div>
                  <span className={`px-2 py-1 rounded text-xs ${
                    run.status === 'succeeded' ? 'bg-green-100 text-green-700' :
                    run.status === 'failed' ? 'bg-red-100 text-red-700' :
                    'bg-blue-100 text-blue-700'
                  }`}>
                    {run.status}
                  </span>
                  <span className="ml-2 font-medium">{run.intent}</span>
                  {run.duration && (
                    <span className="ml-2 text-sm text-gray-500">{run.duration}s</span>
                  )}
                </div>
                <span className="text-sm text-gray-400 font-mono">{run.runId.slice(0, 8)}</span>
              </div>
            </a>
          ))}
        </div>
      </section>

      {/* Top Failures */}
      <section className="bg-white rounded-lg shadow p-6">
        <h2 className="text-2xl font-bold mb-4 text-red-600">Recent Failures</h2>
        <div className="space-y-2">
          {failures.length === 0 ? (
            <div className="text-center text-gray-500 py-8">No failures 🎉</div>
          ) : (
            failures.map(run => (
              <div key={run.runId} className="p-3 border-l-4 border-red-500 bg-red-50 rounded">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-medium">{run.intent}</span>
                    {run.error && (
                      <div className="text-sm text-red-600 mt-1">{run.error}</div>
                    )}
                  </div>
                  <a
                    href={`/quality/runs/${run.runId}`}
                    className="text-sm text-blue-600 hover:underline"
                  >
                    View Details →
                  </a>
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
```

---

## Run Detail Page Example

Create `app/quality/runs/[runId]/page.tsx`:

```typescript
import { getRunDetail, getEvidenceURL } from '@/lib/cecelia-api';

interface Props {
  params: {
    runId: string;
  };
}

export default async function RunDetailPage({ params }: Props) {
  const run = await getRunDetail(params.runId);

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="bg-white rounded-lg shadow p-6">
        <h1 className="text-3xl font-bold mb-4">Run Details</h1>
        
        <dl className="grid grid-cols-2 gap-4">
          <div>
            <dt className="text-sm text-gray-500">Run ID</dt>
            <dd className="font-mono text-sm">{run.runId}</dd>
          </div>
          
          <div>
            <dt className="text-sm text-gray-500">Status</dt>
            <dd className={`inline-block px-2 py-1 rounded text-xs ${
              run.status === 'succeeded' ? 'bg-green-100 text-green-700' :
              run.status === 'failed' ? 'bg-red-100 text-red-700' :
              'bg-blue-100 text-blue-700'
            }`}>
              {run.status}
            </dd>
          </div>
          
          <div>
            <dt className="text-sm text-gray-500">Intent</dt>
            <dd>{run.intent}</dd>
          </div>
          
          <div>
            <dt className="text-sm text-gray-500">Duration</dt>
            <dd>{run.duration}s</dd>
          </div>
          
          <div>
            <dt className="text-sm text-gray-500">Started At</dt>
            <dd>{new Date(run.startedAt).toLocaleString()}</dd>
          </div>
          
          <div>
            <dt className="text-sm text-gray-500">Completed At</dt>
            <dd>{run.completedAt ? new Date(run.completedAt).toLocaleString() : 'N/A'}</dd>
          </div>
        </dl>
      </div>

      {/* Evidence Files */}
      {run.evidence && run.evidence.length > 0 && (
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-bold mb-4">Evidence Files</h2>
          <ul className="space-y-2">
            {run.evidence.map(filename => (
              <li key={filename}>
                <a
                  href={getEvidenceURL(run.runId, filename)}
                  className="text-blue-600 hover:underline"
                  download
                >
                  📎 {filename}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Error Details */}
      {run.error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-6">
          <h2 className="text-xl font-bold text-red-700 mb-4">Error</h2>
          <pre className="text-sm whitespace-pre-wrap text-red-600">{run.error}</pre>
        </div>
      )}
    </div>
  );
}
```

---

## Troubleshooting

### API Connection Failed

1. Check if API is running:
   ```bash
   curl http://localhost:5681/api/health
   ```

2. Check CORS configuration in `api/server.js`:
   ```javascript
   app.use(cors({
     origin: ['http://localhost:3000', 'https://core.zenjoymedia.media'],
   }));
   ```

### Data Not Showing

1. Check if state files exist:
   ```bash
   ls -lh state/state.json queue/queue.jsonl
   ```

2. Initialize state:
   ```bash
   bash scripts/start-all.sh
   ```

### TypeScript Errors

Ensure types are exported correctly in `cecelia-api-types.ts` and imported in `cecelia-api.ts`.

---

**Version**: 1.0.0  
**Last Updated**: 2026-01-28
