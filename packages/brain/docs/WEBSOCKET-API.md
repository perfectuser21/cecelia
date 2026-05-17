# WebSocket API Documentation

## Overview

Brain provides a WebSocket endpoint for real-time task execution status updates. When a task's status changes (queued → running → completed/failed), all connected WebSocket clients receive an immediate push notification.

## Connection

### Endpoint

```
ws://localhost:5221/ws
```

### Connection Example

**Using JavaScript (Browser)**

```javascript
const ws = new WebSocket('ws://localhost:5221/ws');

ws.onopen = () => {
  console.log('Connected to Brain WebSocket');
};

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  console.log('Received:', message);
};

ws.onerror = (error) => {
  console.error('WebSocket error:', error);
};

ws.onclose = () => {
  console.log('WebSocket connection closed');
};
```

**Using wscat (CLI)**

```bash
npm install -g wscat
wscat -c ws://localhost:5221/ws
```

## Message Format

All WebSocket messages follow this JSON structure:

```typescript
interface WSMessage {
  type: 'run_update' | 'run_complete' | 'run_failed' | 'connected' | 'echo';
  data: {
    id?: string;
    status?: 'queued' | 'in_progress' | 'completed' | 'failed';
    progress?: number;
    task_id?: string;
    agent?: string;
    started_at?: string;  // ISO 8601
    completed_at?: string; // ISO 8601
    error?: string;
    message?: string; // For system messages
  };
  timestamp: string; // ISO 8601
}
```

## Message Types

### 1. Connected (Server → Client)

Sent immediately after connection is established.

```json
{
  "type": "connected",
  "data": {
    "message": "Connected to Cecelia Brain"
  },
  "timestamp": "2026-02-06T01:30:00.000Z"
}
```

### 2. Run Update (Server → Client)

Sent when a task's status or progress changes.

```json
{
  "type": "run_update",
  "data": {
    "id": "task-123",
    "status": "in_progress",
    "progress": 5,
    "task_id": "task-123",
    "agent": "dev",
    "started_at": "2026-02-06T01:30:00.000Z",
    "completed_at": null,
    "error": null
  },
  "timestamp": "2026-02-06T01:30:15.000Z"
}
```

### 3. Run Complete (Server → Client)

Sent when a task completes successfully.

```json
{
  "type": "run_complete",
  "data": {
    "id": "task-123",
    "status": "completed",
    "progress": 11,
    "task_id": "task-123",
    "agent": "dev",
    "started_at": "2026-02-06T01:30:00.000Z",
    "completed_at": "2026-02-06T01:45:00.000Z",
    "error": null
  },
  "timestamp": "2026-02-06T01:45:00.000Z"
}
```

### 4. Run Failed (Server → Client)

Sent when a task fails.

```json
{
  "type": "run_failed",
  "data": {
    "id": "task-123",
    "status": "failed",
    "progress": 7,
    "task_id": "task-123",
    "agent": "dev",
    "started_at": "2026-02-06T01:30:00.000Z",
    "completed_at": null,
    "error": "Build failed: TypeScript compilation error"
  },
  "timestamp": "2026-02-06T01:35:00.000Z"
}
```

### 5. Echo (Bidirectional)

Clients can send messages to test the connection. The server will echo them back.

**Client → Server:**

```json
{
  "test": "Hello Brain"
}
```

**Server → Client:**

```json
{
  "type": "echo",
  "data": {
    "test": "Hello Brain"
  },
  "timestamp": "2026-02-06T01:30:00.000Z"
}
```

## HTTP Status Endpoint

Check WebSocket service status via HTTP:

```bash
curl http://localhost:5221/api/brain/status/ws
```

**Response:**

```json
{
  "success": true,
  "websocket": {
    "active": true,
    "connected_clients": 2,
    "endpoint": "/ws"
  }
}
```

## Integration Guide

### Frontend React Example

```typescript
import { useEffect, useState } from 'react';

interface TaskUpdate {
  id: string;
  status: string;
  progress: number;
}

export function useTaskUpdates() {
  const [tasks, setTasks] = useState<Map<string, TaskUpdate>>(new Map());

  useEffect(() => {
    const ws = new WebSocket('ws://localhost:5221/ws');

    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);

      if (['run_update', 'run_complete', 'run_failed'].includes(message.type)) {
        setTasks(prev => {
          const next = new Map(prev);
          next.set(message.data.id, message.data);
          return next;
        });
      }
    };

    ws.onerror = (error) => {
      console.error('[WS] Error:', error);
    };

    return () => {
      ws.close();
    };
  }, []);

  return Array.from(tasks.values());
}
```

### Backend Integration

To broadcast updates from your code:

```javascript
import { updateTaskStatus, updateTaskProgress } from './task-updater.js';

// Update task status (automatically broadcasts to WebSocket clients)
await updateTaskStatus(taskId, 'completed', {
  payload: { result: 'Success' }
});

// Update task progress only
await updateTaskProgress(taskId, {
  current_step: 5,
  step_name: 'Writing code'
});
```

## Error Handling

### Client Disconnection

If a client disconnects, the server automatically cleans up the connection. No manual cleanup is required.

### Server Restart

If the server restarts, clients should implement reconnection logic:

```javascript
function connectWithRetry(url, maxRetries = 5) {
  let retries = 0;

  function connect() {
    const ws = new WebSocket(url);

    ws.onclose = () => {
      if (retries < maxRetries) {
        retries++;
        console.log(`Reconnecting... (${retries}/${maxRetries})`);
        setTimeout(connect, 2000 * retries); // Exponential backoff
      }
    };

    return ws;
  }

  return connect();
}

const ws = connectWithRetry('ws://localhost:5221/ws');
```

## Security Notes

- **Current Version**: No authentication (internal network only)
- **Future Version**: Will support JWT authentication
- **Network**: Only accessible on localhost or internal network IPs

## Troubleshooting

### Connection Refused

```bash
# Check if Brain is running
curl http://localhost:5221/

# Check WebSocket status
curl http://localhost:5221/api/brain/status/ws
```

### No Messages Received

1. Check task status is actually changing:
   ```bash
   psql -h localhost -U cecelia cecelia -c "SELECT id, status FROM tasks WHERE status != 'completed' LIMIT 5"
   ```

2. Manually trigger a status update:
   ```bash
   psql -h localhost -U cecelia cecelia -c "UPDATE tasks SET status='running' WHERE id='<task-id>'"
   ```

3. Check WebSocket clients:
   ```bash
   curl http://localhost:5221/api/brain/status/ws
   ```

## Performance

- **Max Clients**: No hard limit (limited by system resources)
- **Message Rate**: No rate limiting (broadcasts on every status change)
- **Memory**: ~1KB per connected client
- **CPU**: Negligible (<0.1% per 100 clients)

## Testing

### Manual Test with wscat

```bash
# Terminal 1: Connect to WebSocket
wscat -c ws://localhost:5221/ws

# Terminal 2: Trigger a task update
psql -h localhost -U cecelia cecelia -c "UPDATE tasks SET status='running', updated_at=NOW() WHERE id='<task-id>'"

# Terminal 1: You should see the update message
```

### Automated Test

```bash
cd brain
npm test -- websocket.test.js
```
