# Content Clipper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/clips` content management page to Cecelia Dashboard backed by Brain API, enabling capture of Douyin/XHS URLs via xian-m1 content-service with full status tracking.

**Architecture:** Brain API at `/api/brain/clips` stores clip records (pending→done/failed); `clips-extractor.js` calls content-service proxy at `38.23.47.81:7786` with `callback_url: http://38.23.47.81:5221/api/brain/clips/:id/callback`; Dashboard `/clips` page is config-driven via system-hub.

**Tech Stack:** Node.js ESM, Express Router, PostgreSQL (pool.query), React+TypeScript, Vitest+Supertest, Tailwind CSS

**Working directory:** `/Users/administrator/worktrees/cecelia/content-clipper` (branch `cp-0520195056-content-clipper`)

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `database/migrations/010-content-clips.sql` | Create | DB schema: clips table + indexes |
| `packages/brain/src/routes/clips.js` | Create | REST API: POST/GET/retry/callback/webhook |
| `packages/brain/src/clips-extractor.js` | Create | Async caller to content-service + callback handler |
| `packages/brain/src/routes/__tests__/clips.test.js` | Create | Supertest unit tests (mock db + extractor) |
| `packages/brain/server.js` | Modify | Add import + `app.use('/api/brain/clips', clipsRoutes)` |
| `apps/api/features/system-hub/index.ts` | Modify | Nav item + routes + pageComponents entries |
| `apps/dashboard/src/pages/clips/ContentClipsPage.tsx` | Create | List page with filters + table |
| `apps/dashboard/src/pages/clips/ContentClipDetailPage.tsx` | Create | Detail page with transcript + images |
| `cp-0520195056-content-clipper.dod.md` | Create | DoD with [BEHAVIOR] items |
| `docs/learnings/cp-052019-content-clipper.md` | Create | Learning doc (required before first push) |

---

## Task 1: DB Migration + Failing Route Test

**Files:**
- Create: `database/migrations/010-content-clips.sql`
- Create: `packages/brain/src/routes/__tests__/clips.test.js`

### TDD Step 1: Write the migration

- [ ] **Step 1.1: Create migration file**

```sql
-- database/migrations/010-content-clips.sql
-- Migration 010: Content Clips 采集表

CREATE TABLE clips (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  url           TEXT        NOT NULL,
  platform      TEXT        NOT NULL CHECK (platform IN ('douyin', 'xiaohongshu')),
  status        TEXT        NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'processing', 'done', 'failed')),
  title         TEXT,
  author        TEXT,
  author_id     TEXT,
  like_count    INTEGER,
  comment_count INTEGER,
  share_count   INTEGER,
  cover_url     TEXT,
  video_url     TEXT,
  transcript    TEXT,
  images        JSONB       DEFAULT '[]',
  raw_response  JSONB,
  error_msg     TEXT,
  requested_by  TEXT,
  retry_count   INTEGER     DEFAULT 0,
  metadata      JSONB       DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at  TIMESTAMPTZ
);

CREATE UNIQUE INDEX idx_clips_url             ON clips (url);
CREATE INDEX idx_clips_platform_status        ON clips (platform, status, created_at DESC);
CREATE INDEX idx_clips_created_at             ON clips (created_at DESC);
```

- [ ] **Step 1.2: Write failing test**

Create `packages/brain/src/routes/__tests__/clips.test.js`:

```js
/**
 * routes/__tests__/clips.test.js
 * Unit tests for clips route — POST/GET/retry/callback/webhook
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../db.js', () => ({
  default: { query: vi.fn() },
}));
vi.mock('../../clips-extractor.js', () => ({
  extractClip: vi.fn().mockResolvedValue(undefined),
}));

import pool from '../../db.js';
import { extractClip } from '../../clips-extractor.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  // Dynamic import so the mock is set up before the module loads
  return app;
}

describe('clips router — exports', () => {
  it('exports an express router function', async () => {
    const { default: router } = await import('../clips.js');
    expect(router).toBeDefined();
    expect(typeof router).toBe('function');
  });
});

describe('POST /api/brain/clips — create clip', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 201 with id and status=pending on success', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 'uuid-1', status: 'pending', created_at: '2026-05-20T00:00:00Z' }],
    });
    const { default: router } = await import('../clips.js');
    const app = makeApp();
    app.use('/api/brain/clips', router);

    const res = await request(app)
      .post('/api/brain/clips')
      .send({ url: 'https://v.douyin.com/xxx' });

    expect(res.status).toBe(201);
    expect(res.body.id).toBe('uuid-1');
    expect(res.body.status).toBe('pending');
  });

  it('returns 400 if url is missing', async () => {
    const { default: router } = await import('../clips.js');
    const app = makeApp();
    app.use('/api/brain/clips', router);

    const res = await request(app).post('/api/brain/clips').send({});
    expect(res.status).toBe(400);
  });

  it('returns 409 if url already exists (unique constraint)', async () => {
    const err = new Error('duplicate key value violates unique constraint');
    err.code = '23505';
    pool.query.mockRejectedValueOnce(err);
    const { default: router } = await import('../clips.js');
    const app = makeApp();
    app.use('/api/brain/clips', router);

    const res = await request(app)
      .post('/api/brain/clips')
      .send({ url: 'https://v.douyin.com/duplicate' });
    expect(res.status).toBe(409);
  });
});

describe('GET /api/brain/clips — list', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 200 with data array', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 'uuid-1', url: 'https://v.douyin.com/xxx', platform: 'douyin', status: 'done' }] })
      .mockResolvedValueOnce({ rows: [{ count: '1' }] });
    const { default: router } = await import('../clips.js');
    const app = makeApp();
    app.use('/api/brain/clips', router);

    const res = await request(app).get('/api/brain/clips');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.total).toBe(1);
  });
});

describe('POST /api/brain/clips/:id/callback — content-service result', () => {
  beforeEach(() => vi.clearAllMocks());

  it('updates clip to done and returns 200', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 'uuid-1', status: 'done' }] });
    const { default: router } = await import('../clips.js');
    const app = makeApp();
    app.use('/api/brain/clips', router);

    const res = await request(app)
      .post('/api/brain/clips/uuid-1/callback')
      .send({ success: true, title: 'Test Video', transcript: 'hello world', platform: 'douyin' });

    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 1.3: Run test to verify it fails**

```bash
cd /Users/administrator/worktrees/cecelia/content-clipper
npx vitest run packages/brain/src/routes/__tests__/clips.test.js 2>&1 | tail -20
```

Expected output: `FAIL ... Cannot find module '../clips.js'`

- [ ] **Step 1.4: Commit failing test + migration**

```bash
git add database/migrations/010-content-clips.sql \
        packages/brain/src/routes/__tests__/clips.test.js
git commit -m "test(clips): failing unit tests + DB migration 010"
```

---

## Task 2: clips.js Route Implementation

**Files:**
- Create: `packages/brain/src/routes/clips.js`
- Modify: `packages/brain/server.js`

- [ ] **Step 2.1: Create clips.js**

```js
// packages/brain/src/routes/clips.js
import { Router } from 'express';
import pool from '../db.js';
import { extractClip } from '../clips-extractor.js';

const router = Router();

/** POST /webhook — external webhook from n8n (accepts same payload as callback) */
router.post('/webhook', async (req, res) => {
  try {
    const secret = process.env.CLIPS_WEBHOOK_SECRET;
    if (secret && req.headers['x-webhook-secret'] !== secret) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    const { url, platform, title, transcript, text, images, note } = req.body;
    if (!url) return res.status(400).json({ error: 'url required' });

    // Upsert: if URL exists, update fields; otherwise insert
    const { rows } = await pool.query(
      `INSERT INTO clips (url, platform, title, transcript, images, status, processed_at)
       VALUES ($1, $2, $3, $4, $5, 'done', NOW())
       ON CONFLICT (url) DO UPDATE SET
         title = EXCLUDED.title,
         transcript = EXCLUDED.transcript,
         images = EXCLUDED.images,
         status = 'done',
         processed_at = NOW(),
         updated_at = NOW()
       RETURNING id, status`,
      [url, platform || detectPlatform(url), title || null, transcript || text || null, JSON.stringify(images || [])]
    );
    res.json({ success: true, id: rows[0].id });
  } catch (err) {
    console.error('[clips] POST /webhook error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** POST /:id/retry — reset failed clip to pending and re-trigger */
router.post('/:id/retry', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE clips SET status='pending', retry_count=retry_count+1, error_msg=NULL, updated_at=NOW()
       WHERE id=$1 RETURNING id, status, url`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'not found' });
    // Re-trigger extraction (non-blocking)
    extractClip(rows[0].id, rows[0].url).catch(e =>
      console.error('[clips] retry extractClip error:', e.message)
    );
    res.json({ id: rows[0].id, status: rows[0].status });
  } catch (err) {
    console.error('[clips] POST /:id/retry error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** POST /:id/callback — internal: content-service posts result here */
router.post('/:id/callback', async (req, res) => {
  try {
    const { success, title, transcript, images, platform, author, author_id,
            like_count, comment_count, share_count, cover_url, video_url,
            raw_response, error } = req.body;

    if (success === false || success === 'false') {
      await pool.query(
        `UPDATE clips SET status='failed', error_msg=$2, updated_at=NOW() WHERE id=$1`,
        [req.params.id, error || 'content-service reported failure']
      );
      return res.json({ ok: true, status: 'failed' });
    }

    const { rows } = await pool.query(
      `UPDATE clips SET
         status='done', title=$2, transcript=$3, images=$4,
         author=$5, author_id=$6,
         like_count=$7, comment_count=$8, share_count=$9,
         cover_url=$10, video_url=$11,
         raw_response=$12, processed_at=NOW(), updated_at=NOW()
       WHERE id=$1 RETURNING id, status`,
      [
        req.params.id,
        title || null,
        transcript || null,
        JSON.stringify(images || []),
        author || null, author_id || null,
        like_count || null, comment_count || null, share_count || null,
        cover_url || null, video_url || null,
        raw_response ? JSON.stringify(raw_response) : null,
      ]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'clip not found' });
    res.json({ ok: true, status: 'done' });
  } catch (err) {
    console.error('[clips] POST /:id/callback error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** POST / — submit URL, create pending record, trigger extraction */
router.post('/', async (req, res) => {
  try {
    const { url, requested_by, metadata } = req.body;
    if (!url || typeof url !== 'string' || !url.startsWith('http')) {
      return res.status(400).json({ error: 'url required (must start with http)' });
    }

    const platform = detectPlatform(url);
    const { rows } = await pool.query(
      `INSERT INTO clips (url, platform, requested_by, metadata)
       VALUES ($1, $2, $3, $4)
       RETURNING id, status, created_at`,
      [url.trim(), platform, requested_by || null, JSON.stringify(metadata || {})]
    );

    // Trigger extraction non-blocking
    extractClip(rows[0].id, url).catch(e =>
      console.error('[clips] extractClip error for', rows[0].id, e.message)
    );

    res.status(201).json({ id: rows[0].id, status: rows[0].status, created_at: rows[0].created_at });
  } catch (err) {
    if (err.code === '23505') {
      // Unique constraint violation — URL already exists
      const existing = await pool.query('SELECT id, status FROM clips WHERE url=$1', [req.body.url]);
      return res.status(409).json({ error: 'already_exists', id: existing.rows[0]?.id });
    }
    console.error('[clips] POST / error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** GET / — list with optional filters */
router.get('/', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = parseInt(req.query.offset) || 0;
    const params = [limit, offset];
    const conditions = [];

    if (req.query.platform) {
      params.push(req.query.platform);
      conditions.push(`platform = $${params.length}`);
    }
    if (req.query.status) {
      params.push(req.query.status);
      conditions.push(`status = $${params.length}`);
    }
    if (req.query.since) {
      params.push(req.query.since);
      conditions.push(`created_at >= $${params.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const { rows } = await pool.query(
      `SELECT id, url, platform, status, title, author, like_count, comment_count,
              cover_url, retry_count, requested_by, created_at, processed_at, error_msg
       FROM clips ${where}
       ORDER BY created_at DESC
       LIMIT $1 OFFSET $2`,
      params
    );

    const countParams = conditions.length ? params.slice(2) : [];
    const { rows: countRows } = await pool.query(
      `SELECT count(*) FROM clips ${where}`,
      countParams
    );

    res.json({ success: true, data: rows, total: parseInt(countRows[0].count) });
  } catch (err) {
    console.error('[clips] GET / error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/** GET /:id — full detail */
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM clips WHERE id=$1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'not found' });
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('[clips] GET /:id error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

function detectPlatform(url) {
  if (url.includes('douyin.com') || url.includes('v.douyin.com')) return 'douyin';
  if (url.includes('xiaohongshu.com') || url.includes('xhslink.com')) return 'xiaohongshu';
  return 'douyin'; // fallback
}

export default router;
```

- [ ] **Step 2.2: Create clips-extractor.js (stub — full impl in Task 3)**

```js
// packages/brain/src/clips-extractor.js
const PROXY_URL = process.env.CONTENT_SERVICE_PROXY_URL || 'http://38.23.47.81:7786';
const BRAIN_PUBLIC_URL = process.env.BRAIN_PUBLIC_URL || 'http://38.23.47.81:5221';

/**
 * Trigger async extraction via content-service proxy.
 * The proxy POSTs results back to Brain's /api/brain/clips/:id/callback.
 */
export async function extractClip(clipId, url) {
  const callbackUrl = `${BRAIN_PUBLIC_URL}/api/brain/clips/${clipId}/callback`;
  const resp = await fetch(PROXY_URL + '/transcribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, callback_url: callbackUrl }),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`content-service error ${resp.status}: ${text}`);
  }
}
```

- [ ] **Step 2.3: Register in server.js**

In `packages/brain/server.js`, find the block of imports (around line 40) and add after the last import:

```js
import clipsRoutes from './src/routes/clips.js';
```

Then find the last `app.use('/api/brain/...', ...)` line (around line 305) and add:

```js
app.use('/api/brain/clips', clipsRoutes);
```

- [ ] **Step 2.4: Run tests to verify they pass**

```bash
cd /Users/administrator/worktrees/cecelia/content-clipper
npx vitest run packages/brain/src/routes/__tests__/clips.test.js 2>&1 | tail -20
```

Expected: `✓ clips router — exports > exports an express router function`, all 5 tests pass.

- [ ] **Step 2.5: Commit implementation**

```bash
git add packages/brain/src/routes/clips.js \
        packages/brain/src/clips-extractor.js \
        packages/brain/server.js
git commit -m "feat(clips): Brain API routes + clips-extractor stub"
```

---

## Task 3: clips-extractor.js Failing Test + Full Implementation

**Files:**
- Create: `packages/brain/src/routes/__tests__/clips-extractor.test.js`

Note: The extractor is in `src/` not `src/routes/` but CI lint-test-pairing checks `routes/__tests__/` for route files. The extractor is a utility so its test can live in `src/__tests__/`.

- [ ] **Step 3.1: Write failing test for extractor**

Create `packages/brain/src/__tests__/clips-extractor.test.js`:

```js
/**
 * __tests__/clips-extractor.test.js
 * Tests the extractClip function
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock global fetch
global.fetch = vi.fn();

describe('extractClip', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls content-service proxy with url and callback_url', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ queued: true }),
    });

    const { extractClip } = await import('../clips-extractor.js');
    await extractClip('test-uuid', 'https://v.douyin.com/abc123');

    expect(global.fetch).toHaveBeenCalledOnce();
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toContain('/transcribe');
    const body = JSON.parse(opts.body);
    expect(body.url).toBe('https://v.douyin.com/abc123');
    expect(body.callback_url).toContain('test-uuid');
  });

  it('throws if content-service returns non-ok response', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      text: async () => 'Service Unavailable',
    });

    const { extractClip } = await import('../clips-extractor.js');
    await expect(extractClip('id-2', 'https://v.douyin.com/xyz')).rejects.toThrow('503');
  });
});
```

- [ ] **Step 3.2: Run test to verify it passes** (extractor stub already created in Task 2)

```bash
cd /Users/administrator/worktrees/cecelia/content-clipper
npx vitest run packages/brain/src/__tests__/clips-extractor.test.js 2>&1 | tail -15
```

Expected: Both tests pass.

- [ ] **Step 3.3: Commit extractor test**

```bash
git add packages/brain/src/__tests__/clips-extractor.test.js
git commit -m "test(clips): extractClip unit tests"
```

---

## Task 4: Dashboard — system-hub Registration + Page Components

**Files:**
- Modify: `apps/api/features/system-hub/index.ts`
- Create: `apps/dashboard/src/pages/clips/ContentClipsPage.tsx`
- Create: `apps/dashboard/src/pages/clips/ContentClipDetailPage.tsx`

- [ ] **Step 4.1: Update system-hub/index.ts**

In `apps/api/features/system-hub/index.ts`, make 3 changes:

**Change 1** — Add nav child (find the children array inside SystemTabbed navItem, after the `/reports` entry):
```ts
// Find this line:
          { path: '/reports', label: 'Reports', icon: 'FileText', order: 14 },
// Add after it:
          { path: '/clips', label: 'Content Clips', icon: 'Scissors', order: 17 },
```

**Change 2** — Add routes (find the routes array, after `/viral-analysis` route):
```ts
// Find this line:
    { path: '/viral-analysis', component: 'ViralAnalysisPage' },
// Add after it:
    { path: '/clips', component: 'ContentClipsPage' },
    { path: '/clips/:id', component: 'ContentClipDetailPage' },
```

**Change 3** — Add pageComponents (find the components object, after `ViralAnalysisPage` entry):
```ts
// Find this line:
    ViralAnalysisPage: () => import('../../../dashboard/src/pages/viral-analysis/ViralAnalysisPage'),
// Add after it:
    ContentClipsPage: () => import('../../../dashboard/src/pages/clips/ContentClipsPage'),
    ContentClipDetailPage: () => import('../../../dashboard/src/pages/clips/ContentClipDetailPage'),
```

- [ ] **Step 4.2: Create ContentClipsPage.tsx**

```bash
mkdir -p /Users/administrator/worktrees/cecelia/content-clipper/apps/dashboard/src/pages/clips
```

Create `apps/dashboard/src/pages/clips/ContentClipsPage.tsx`:

```tsx
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Scissors, RefreshCw, ExternalLink } from 'lucide-react';

interface Clip {
  id: string;
  url: string;
  platform: 'douyin' | 'xiaohongshu';
  status: 'pending' | 'processing' | 'done' | 'failed';
  title: string | null;
  author: string | null;
  like_count: number | null;
  cover_url: string | null;
  retry_count: number;
  requested_by: string | null;
  created_at: string;
  processed_at: string | null;
  error_msg: string | null;
}

interface ClipsResponse {
  success: boolean;
  data: Clip[];
  total: number;
}

const PLATFORM_LABELS: Record<string, string> = {
  douyin: '抖音',
  xiaohongshu: '小红书',
};

const STATUS_COLORS: Record<string, string> = {
  pending:    'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  processing: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  done:       'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  failed:     'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
};

export default function ContentClipsPage() {
  const navigate = useNavigate();
  const [clips, setClips] = useState<Clip[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [platform, setPlatform] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(0);
  const pageSize = 20;

  const fetchClips = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: String(pageSize), offset: String(page * pageSize) });
      if (platform) params.set('platform', platform);
      if (status) params.set('status', status);
      const resp = await fetch(`/api/brain/clips?${params}`);
      const data: ClipsResponse = await resp.json();
      setClips(data.data || []);
      setTotal(data.total || 0);
    } catch (e) {
      console.error('Failed to load clips:', e);
    } finally {
      setLoading(false);
    }
  }, [platform, status, page]);

  useEffect(() => { fetchClips(); }, [fetchClips]);

  const handleRetry = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await fetch(`/api/brain/clips/${id}/retry`, { method: 'POST' });
    fetchClips();
  };

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Scissors className="w-6 h-6 text-blue-500" />
          <h1 className="text-xl font-semibold text-gray-900 dark:text-white">Content Clips</h1>
          <span className="text-sm text-gray-500 dark:text-gray-400 ml-1">({total} 条)</span>
        </div>
        <button
          onClick={fetchClips}
          className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
        >
          <RefreshCw className="w-4 h-4" /> 刷新
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-4">
        <select
          value={platform}
          onChange={e => { setPlatform(e.target.value); setPage(0); }}
          className="text-sm border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 bg-white dark:bg-slate-800 text-gray-700 dark:text-gray-300"
        >
          <option value="">全部平台</option>
          <option value="douyin">抖音</option>
          <option value="xiaohongshu">小红书</option>
        </select>
        <select
          value={status}
          onChange={e => { setStatus(e.target.value); setPage(0); }}
          className="text-sm border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 bg-white dark:bg-slate-800 text-gray-700 dark:text-gray-300"
        >
          <option value="">全部状态</option>
          <option value="pending">待处理</option>
          <option value="processing">处理中</option>
          <option value="done">完成</option>
          <option value="failed">失败</option>
        </select>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : clips.length === 0 ? (
        <div className="text-center py-16 text-gray-400 dark:text-gray-500">
          <Scissors className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="text-base">还没有采集记录</p>
          <p className="text-sm mt-1">通过 API 提交第一个链接开始采集</p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-slate-800/50">
                <tr>
                  {['平台', '标题', '状态', '作者', '采集时间', '操作'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {clips.map(clip => (
                  <tr
                    key={clip.id}
                    onClick={() => navigate(`/clips/${clip.id}`)}
                    className="hover:bg-gray-50 dark:hover:bg-slate-800/30 cursor-pointer"
                  >
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="font-medium text-gray-700 dark:text-gray-300">
                        {PLATFORM_LABELS[clip.platform] || clip.platform}
                      </span>
                    </td>
                    <td className="px-4 py-3 max-w-xs">
                      <span className="text-gray-900 dark:text-white line-clamp-1">
                        {clip.title || <span className="text-gray-400">-</span>}
                      </span>
                      <span className="text-xs text-gray-400 truncate block max-w-[240px]">{clip.url}</span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[clip.status]}`}>
                        {clip.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{clip.author || '-'}</td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400 whitespace-nowrap text-xs">
                      {formatDate(clip.created_at)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <a
                          href={clip.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={e => e.stopPropagation()}
                          className="text-blue-500 hover:text-blue-700"
                        >
                          <ExternalLink className="w-4 h-4" />
                        </a>
                        {clip.status === 'failed' && (
                          <button
                            onClick={e => handleRetry(clip.id, e)}
                            className="text-xs text-orange-500 hover:text-orange-700 font-medium"
                          >
                            重试
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {total > pageSize && (
            <div className="flex items-center justify-between mt-4">
              <span className="text-sm text-gray-500">共 {total} 条</span>
              <div className="flex gap-2">
                <button
                  disabled={page === 0}
                  onClick={() => setPage(p => p - 1)}
                  className="px-3 py-1 text-sm rounded border border-gray-200 dark:border-gray-700 disabled:opacity-40"
                >上一页</button>
                <button
                  disabled={(page + 1) * pageSize >= total}
                  onClick={() => setPage(p => p + 1)}
                  className="px-3 py-1 text-sm rounded border border-gray-200 dark:border-gray-700 disabled:opacity-40"
                >下一页</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 4.3: Create ContentClipDetailPage.tsx**

Create `apps/dashboard/src/pages/clips/ContentClipDetailPage.tsx`:

```tsx
import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, ExternalLink, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';

interface ClipDetail {
  id: string;
  url: string;
  platform: string;
  status: string;
  title: string | null;
  author: string | null;
  author_id: string | null;
  like_count: number | null;
  comment_count: number | null;
  share_count: number | null;
  cover_url: string | null;
  video_url: string | null;
  transcript: string | null;
  images: string[];
  raw_response: Record<string, unknown> | null;
  error_msg: string | null;
  retry_count: number;
  requested_by: string | null;
  created_at: string;
  processed_at: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  pending:    'bg-yellow-100 text-yellow-700',
  processing: 'bg-blue-100 text-blue-700',
  done:       'bg-green-100 text-green-700',
  failed:     'bg-red-100 text-red-700',
};

export default function ContentClipDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [clip, setClip] = useState<ClipDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [transcriptExpanded, setTranscriptExpanded] = useState(false);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    fetch(`/api/brain/clips/${id}`)
      .then(r => r.json())
      .then(d => setClip(d.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [id]);

  const handleRetry = async () => {
    setRetrying(true);
    await fetch(`/api/brain/clips/${id}/retry`, { method: 'POST' });
    const r = await fetch(`/api/brain/clips/${id}`);
    const d = await r.json();
    setClip(d.data);
    setRetrying(false);
  };

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!clip) {
    return (
      <div className="p-6 text-center">
        <p className="text-gray-500">未找到该记录</p>
        <button onClick={() => navigate('/clips')} className="mt-4 text-blue-500">返回列表</button>
      </div>
    );
  }

  const images: string[] = Array.isArray(clip.images) ? clip.images : [];

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Back */}
      <button
        onClick={() => navigate('/clips')}
        className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 mb-4"
      >
        <ArrowLeft className="w-4 h-4" /> 返回列表
      </button>

      {/* Info Card */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 mb-4">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">
              {clip.title || '(无标题)'}
            </h1>
            <a
              href={clip.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-blue-500 hover:underline flex items-center gap-1"
            >
              {clip.url} <ExternalLink className="w-3 h-3" />
            </a>
          </div>
          <span className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[clip.status] || ''}`}>
            {clip.status}
          </span>
        </div>

        <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <Stat label="平台" value={clip.platform} />
          <Stat label="作者" value={clip.author || '-'} />
          <Stat label="点赞" value={clip.like_count?.toLocaleString() || '-'} />
          <Stat label="评论" value={clip.comment_count?.toLocaleString() || '-'} />
          <Stat label="采集时间" value={formatDate(clip.created_at)} />
          {clip.processed_at && <Stat label="完成时间" value={formatDate(clip.processed_at)} />}
          {clip.requested_by && <Stat label="提交方" value={clip.requested_by} />}
          <Stat label="重试次数" value={String(clip.retry_count)} />
        </div>

        {clip.status === 'failed' && (
          <div className="mt-3 p-3 bg-red-50 dark:bg-red-900/20 rounded-lg text-sm text-red-700 dark:text-red-400">
            错误：{clip.error_msg || '未知错误'}
            <button
              onClick={handleRetry}
              disabled={retrying}
              className="ml-3 inline-flex items-center gap-1 text-orange-600 hover:text-orange-800 font-medium"
            >
              <RefreshCw className={`w-3 h-3 ${retrying ? 'animate-spin' : ''}`} />
              {retrying ? '重试中...' : '重试'}
            </button>
          </div>
        )}
      </div>

      {/* Transcript */}
      {clip.transcript && (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 mb-4">
          <div
            className="flex items-center justify-between cursor-pointer"
            onClick={() => setTranscriptExpanded(e => !e)}
          >
            <h2 className="font-medium text-gray-900 dark:text-white">转写文案</h2>
            <div className="flex items-center gap-1 text-gray-400 text-xs">
              {clip.transcript.length} 字
              {transcriptExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </div>
          </div>
          <div className={`mt-3 text-sm text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap ${
            !transcriptExpanded && clip.transcript.length > 500 ? 'line-clamp-6' : ''
          }`}>
            {clip.transcript}
          </div>
          {clip.transcript.length > 500 && (
            <button
              onClick={() => setTranscriptExpanded(e => !e)}
              className="mt-2 text-xs text-blue-500 hover:underline"
            >
              {transcriptExpanded ? '收起' : '展开全文'}
            </button>
          )}
        </div>
      )}

      {/* Images */}
      {images.length > 0 && (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 mb-4">
          <h2 className="font-medium text-gray-900 dark:text-white mb-3">图片 ({images.length})</h2>
          <div className="grid grid-cols-3 gap-2">
            {images.slice(0, 9).map((src, i) => (
              <a key={i} href={src} target="_blank" rel="noopener noreferrer">
                <img src={src} alt={`图片 ${i + 1}`} className="w-full h-32 object-cover rounded-lg" />
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-gray-400 mb-0.5">{label}</p>
      <p className="text-gray-800 dark:text-gray-200 font-medium">{value}</p>
    </div>
  );
}
```

- [ ] **Step 4.4: Verify TypeScript compiles**

```bash
cd /Users/administrator/worktrees/cecelia/content-clipper
npx tsc --noEmit -p apps/dashboard/tsconfig.json 2>&1 | head -30
```

Expected: No errors (or only pre-existing errors unrelated to clips pages).

- [ ] **Step 4.5: Commit dashboard changes**

```bash
git add apps/api/features/system-hub/index.ts \
        apps/dashboard/src/pages/clips/ContentClipsPage.tsx \
        apps/dashboard/src/pages/clips/ContentClipDetailPage.tsx
git commit -m "feat(clips): Dashboard /clips page + system-hub registration"
```

---

## Task 5: DoD + Learning Doc

**Files:**
- Create: `cp-0520195056-content-clipper.dod.md` (worktree root)
- Create: `docs/learnings/cp-052019-content-clipper.md`

- [ ] **Step 5.1: Create DoD file**

Create `cp-0520195056-content-clipper.dod.md` in the worktree root:

```markdown
# DoD: Content Clipper — Brain API + Dashboard /clips

- [ ] [BEHAVIOR] POST /api/brain/clips 创建 pending 记录并返回 201
  Test: packages/brain/src/routes/__tests__/clips.test.js

- [ ] [BEHAVIOR] GET /api/brain/clips 返回列表，支持 platform/status 过滤
  Test: packages/brain/src/routes/__tests__/clips.test.js

- [ ] [BEHAVIOR] 重复 URL 提交返回 409 already_exists
  Test: packages/brain/src/routes/__tests__/clips.test.js

- [ ] [BEHAVIOR] POST /api/brain/clips/:id/callback 将状态更新为 done
  Test: packages/brain/src/routes/__tests__/clips.test.js

- [ ] [BEHAVIOR] extractClip 调用 content-service proxy 并传递 callback_url
  Test: packages/brain/src/__tests__/clips-extractor.test.js

- [x] [ARTIFACT] migration 010-content-clips.sql 存在
  Test: manual:node -e "require('fs').accessSync('database/migrations/010-content-clips.sql')"

- [x] [ARTIFACT] packages/brain/src/routes/clips.js 存在
  Test: manual:node -e "require('fs').accessSync('packages/brain/src/routes/clips.js')"

- [x] [ARTIFACT] ContentClipsPage.tsx 存在
  Test: manual:node -e "require('fs').accessSync('apps/dashboard/src/pages/clips/ContentClipsPage.tsx')"
```

- [ ] **Step 5.2: Run Brain tests to verify all DoD [BEHAVIOR] items pass**

```bash
cd /Users/administrator/worktrees/cecelia/content-clipper
npx vitest run packages/brain/src/routes/__tests__/clips.test.js \
               packages/brain/src/__tests__/clips-extractor.test.js 2>&1 | tail -20
```

Expected: All tests pass.

- [ ] **Step 5.3: Check all DoD items, update to [x]**

Once tests pass, update all `- [ ]` to `- [x]` in the DoD file.

- [ ] **Step 5.4: Create Learning doc**

Create `docs/learnings/cp-052019-content-clipper.md`:

```markdown
# Learning: cp-0520195056-content-clipper

**PR**: Content Clipper — Brain API + Dashboard

### 根本原因

首次添加内容采集功能到 Brain，需要清晰定义 Brain 如何作为回调目标（callback receiver）。
xian-m1 content-service 需要一个公开可达的 URL 来 POST 结果回来。Brain 运行在 38.23.47.81:5221，
公网可访问，因此 callback_url 可以直接指向 `http://38.23.47.81:5221/api/brain/clips/:id/callback`。

### 下次预防

- [ ] 新增需要外部 callback 的功能时，优先确认 Brain 端口是否对 xian-m1 可达（curl 测试）
- [ ] clips webhook 端点需要 `CLIPS_WEBHOOK_SECRET` env var；部署时通过 launchd plist 设置
- [ ] 重复 URL 使用 INSERT ... ON CONFLICT DO UPDATE（upsert），而非先查后插，避免竞态
- [ ] extractClip 调用失败不能阻塞 HTTP 响应（non-blocking，catch error separately）
```

- [ ] **Step 5.5: Commit DoD + Learning**

```bash
git add cp-0520195056-content-clipper.dod.md \
        docs/learnings/cp-052019-content-clipper.md
git commit -m "docs: DoD + learning for content-clipper"
```

---

## Task 6: Apply DB Migration + Verify E2E

- [ ] **Step 6.1: Apply migration to local DB**

```bash
psql cecelia -f /Users/administrator/worktrees/cecelia/content-clipper/database/migrations/010-content-clips.sql
```

Expected: `CREATE TABLE`, `CREATE INDEX` (no errors)

- [ ] **Step 6.2: Restart Brain**

```bash
brew services restart cecelia-brain 2>/dev/null || \
  (pkill -f "node.*brain/server.js" && sleep 2 && \
   cd /Users/administrator/perfect21/cecelia && node packages/brain/server.js &)
```

Wait 3 seconds, then verify:

```bash
curl -s http://localhost:5221/api/brain/clips | head -c 100
```

Expected: `{"success":true,"data":[],"total":0}`

- [ ] **Step 6.3: Submit a test clip**

```bash
curl -s -X POST http://localhost:5221/api/brain/clips \
  -H "Content-Type: application/json" \
  -d '{"url":"https://v.douyin.com/CnxE8SnPFSo/","requested_by":"alex-test"}' | python3 -m json.tool
```

Expected: `{ "id": "...", "status": "pending", "created_at": "..." }`

- [ ] **Step 6.4: Check Dashboard renders without error**

Visit `http://perfect21:5211/clips` in browser.

Expected: Page loads, shows empty state or pending clip row.

- [ ] **Step 6.5: Push + PR**

```bash
cd /Users/administrator/worktrees/cecelia/content-clipper
git push -u origin cp-0520195056-content-clipper
gh pr create \
  --title "feat(clips): Content Clipper — Brain API + Dashboard /clips page" \
  --body "$(cat <<'EOF'
## Summary
- New Brain API at \`/api/brain/clips\` (POST/GET/retry/callback/webhook)
- DB migration 010: clips table with UNIQUE url constraint
- async extraction via xian-m1 content-service (38.23.47.81:7786)
- Dashboard \`/clips\` list page + detail page via system-hub config
- n8n \`/webhook\` endpoint for existing Douyin Done Handler integration

## Test plan
- [ ] \`npx vitest run packages/brain/src/routes/__tests__/clips.test.js\` — 5 tests pass
- [ ] \`npx vitest run packages/brain/src/__tests__/clips-extractor.test.js\` — 2 tests pass
- [ ] Visit \`http://perfect21:5211/clips\` — page renders, no 500
- [ ] POST \`/api/brain/clips\` with a douyin URL → 201 + pending record in DB

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review Checklist

**Spec coverage:**
- ✅ POST /api/brain/clips → Task 2
- ✅ GET /api/brain/clips (list + filter) → Task 2
- ✅ GET /api/brain/clips/:id → Task 2
- ✅ POST /api/brain/clips/:id/retry → Task 2
- ✅ POST /api/brain/clips/:id/callback → Task 2
- ✅ POST /api/brain/clips/webhook → Task 2
- ✅ DB migration 010 → Task 1
- ✅ clips-extractor async caller → Task 2+3
- ✅ system-hub nav + routes + components → Task 4
- ✅ ContentClipsPage → Task 4
- ✅ ContentClipDetailPage → Task 4
- ✅ Same URL = 409 → Task 2 (clips.js) + test
- ✅ DoD + Learning → Task 5

**No placeholders:** All code blocks are complete. No TBD/TODO in implementation steps.

**Type consistency:**
- `extractClip(clipId, url)` — used consistently in clips.js and tested in extractor test
- `pool.query` with `$1, $2...` params — consistent throughout clips.js
- `ContentClipsPage` / `ContentClipDetailPage` — names match system-hub registrations
