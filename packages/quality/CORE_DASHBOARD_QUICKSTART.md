# Core Dashboard - 3 Step Quick Integration

> Get Cecelia Quality Dashboard running in Core website in 3 steps

---

## Step 1: Start the API (1 minute)

```bash
cd /home/xx/dev/cecelia-quality
bash scripts/start-all.sh
```

**Verify**:
```bash
curl http://localhost:5681/api/health | jq .
# Output: {"status":"ok","timestamp":"..."}
```

---

## Step 2: Add Environment Variable (30 seconds)

In your Core website project, add to `.env.local`:

```bash
NEXT_PUBLIC_CECELIA_API_URL=http://localhost:5681
```

---

## Step 3: Create Minimal Dashboard Page (2 minutes)

Create `app/quality/page.tsx`:

```typescript
import { headers } from 'next/headers';

async function getSystemState() {
  const API_BASE = process.env.NEXT_PUBLIC_CECELIA_API_URL;
  const res = await fetch(`${API_BASE}/api/state`, { 
    next: { revalidate: 30 } 
  });
  return res.json();
}

export default async function QualityPage() {
  const state = await getSystemState();

  return (
    <div className="container mx-auto p-6">
      <h1 className="text-3xl font-bold mb-6">Quality Dashboard</h1>
      
      {/* Health Card */}
      <div className={`p-6 rounded-lg ${
        state.derivedHealth === 'green' ? 'bg-green-100' :
        state.derivedHealth === 'yellow' ? 'bg-yellow-100' : 'bg-red-100'
      }`}>
        <div className="text-6xl mb-2">
          {state.derivedHealth === 'green' ? '✅' :
           state.derivedHealth === 'yellow' ? '⚠️' : '❌'}
        </div>
        <h2 className="text-2xl font-bold">System {state.health.toUpperCase()}</h2>
        <p className="text-gray-600 mt-2">
          Queue: {state.queueLength} | 
          Success Rate: {(state.stats.successRate * 100).toFixed(1)}%
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-3 gap-4 mt-6">
        <div className="bg-white p-4 rounded-lg shadow">
          <div className="text-3xl font-bold">{state.stats.totalTasks}</div>
          <div className="text-sm text-gray-600">Total Tasks</div>
        </div>
        
        <div className="bg-white p-4 rounded-lg shadow">
          <div className="text-3xl font-bold">{state.systemHealth.done_count}</div>
          <div className="text-sm text-gray-600">Completed</div>
        </div>
        
        <div className="bg-white p-4 rounded-lg shadow">
          <div className="text-3xl font-bold text-red-600">
            {state.systemHealth.failed_24h}
          </div>
          <div className="text-sm text-gray-600">Failed (24h)</div>
        </div>
      </div>
    </div>
  );
}
```

---

## Done! 🎉

Visit: `http://localhost:3000/quality`

---

## Next Steps

### Add More Endpoints

```typescript
// Queue status
const queue = await fetch(`${API_BASE}/api/queue?limit=5`).then(r => r.json());

// Recent runs
const runs = await fetch(`${API_BASE}/api/runs?limit=10`).then(r => r.json());

// Recent failures
const failures = await fetch(`${API_BASE}/api/failures?limit=5`).then(r => r.json());
```

### Add Auto-Refresh

```typescript
'use client';

import { useEffect, useState } from 'react';

export default function QualityPage() {
  const [state, setState] = useState(null);

  useEffect(() => {
    async function fetchState() {
      const res = await fetch('/api/cecelia/state');
      setState(await res.json());
    }

    fetchState();
    const interval = setInterval(fetchState, 30000); // Refresh every 30s

    return () => clearInterval(interval);
  }, []);

  if (!state) return <div>Loading...</div>;

  return (/* ... */);
}
```

### Create API Route for Server-Side Caching

Create `app/api/cecelia/state/route.ts`:

```typescript
import { NextResponse } from 'next/server';

const API_BASE = process.env.NEXT_PUBLIC_CECELIA_API_URL || 'http://localhost:5681';

export async function GET() {
  const res = await fetch(`${API_BASE}/api/state`, {
    next: { revalidate: 30 }, // Cache for 30 seconds
  });

  const data = await res.json();
  return NextResponse.json(data);
}
```

---

## Common Issues

### API not responding

```bash
# Check if API is running
curl http://localhost:5681/api/health

# Restart API
cd /home/xx/dev/cecelia-quality
bash scripts/stop-all.sh
bash scripts/start-all.sh
```

### CORS error in browser

Update `api/server.js` to allow your domain:

```javascript
app.use(cors({
  origin: ['http://localhost:3000', 'https://core.zenjoymedia.media'],
}));
```

Then restart API:
```bash
bash scripts/stop-all.sh && bash scripts/start-all.sh
```

### Empty data returned

Initialize state files:
```bash
cd /home/xx/dev/cecelia-quality
bash scripts/start-all.sh
```

---

## Full Documentation

For complete integration guide with TypeScript types, advanced examples, and troubleshooting:

📚 See: `docs/CORE_DASHBOARD_INTEGRATION.md`

---

**Version**: 1.0.0  
**Last Updated**: 2026-01-28
