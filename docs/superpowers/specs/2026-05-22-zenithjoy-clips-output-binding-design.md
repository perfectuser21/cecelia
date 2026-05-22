# ZenithJoy Content Clipper 输出绑定改版 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标仓库：** `/Users/administrator/perfect21/zenithjoy`

**Goal:** 将 Content Clipper 从共享全局 API Key 模式改为用户级输出绑定，每位用户自行连接飞书 OAuth 或手动填写 Notion Token；无绑定时内容保留在平台（剪贴板模式）。

**Architecture:**
- DB：`user_clip_settings` 新增 6 列存 per-user 凭据（notion_token、feishu_user_token、feishu_refresh_token、feishu_user_id、feishu_user_name、feishu_token_expires_at）
- Backend：新增 5 个端点处理 OAuth callback + token 管理；`clip-output.service.ts` 改为读用户 token、自动 refresh、无绑定跳过
- Frontend：Settings Tab 重构为分区式绑定 UI（飞书 OAuth 按钮 + 绑定状态；Notion token 输入框 + 状态）
- 兼容性：无绑定用户的历史 clips 不受影响，output_status 统一为 'skipped'

**Tech Stack:** PostgreSQL (zenithjoy schema) + raw pg + Express + React 18 + TanStack Query v5 + Better-auth session

---

## 测试策略

| 测试类型 | 覆盖内容 |
|---------|---------|
| unit | `parseFeishuOAuthState`、`detectOutputType`、token refresh 逻辑（mock fetch） |
| integration | `/api/clips/auth/feishu/callback` 端到端（mock Feishu API）、`clip-output.service.ts` 读用户 token |
| E2E (windows_cloud) | Settings tab 绑定状态展示、Notion token 保存成功/失败提示 |

---

## 文件结构

**新建：**
- `apps/api/db/migrations/20260522_130000_user_clip_oauth.sql`
- `apps/api/src/services/clips-auth.service.ts` — Feishu OAuth 流程（换 token、refresh）
- `apps/api/src/routes/clips-auth.ts` — OAuth 路由 GET /auth/feishu, /auth/feishu/callback
- `apps/api/src/services/clips-auth.service.test.ts`

**修改：**
- `apps/api/src/services/clip-output.service.ts` — 读 per-user token，无绑定跳过
- `apps/api/src/services/clips.service.ts` — getSettings / upsertSettings 新增字段
- `apps/api/src/controllers/clips.controller.ts` — 新增 PUT /settings/notion-token、DELETE /settings/feishu、DELETE /settings/notion
- `apps/api/src/routes/clips.ts` — 挂载新路由
- `apps/api/src/app.ts` — 挂载 clips-auth 路由
- `apps/dashboard/src/api/content-clipper.api.ts` — 新增 saveNotionToken、deleteFeishuBinding、deleteNotionBinding
- `apps/dashboard/src/pages/ContentClipperPage.tsx` — 重构 Settings Tab

---

## Task 1: DB Migration — 新增 user_clip_settings OAuth 字段

**Files:**
- Create: `apps/api/db/migrations/20260522_130000_user_clip_oauth.sql`

- [ ] **Step 1: 写失败测试（验证新列不存在时 migration 未跑）**

```sql
-- 测试：在 psql 里确认这 6 列当前不存在
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'zenithjoy' AND table_name = 'user_clip_settings'
  AND column_name IN ('notion_token','feishu_user_token','feishu_refresh_token',
                      'feishu_user_id','feishu_user_name','feishu_token_expires_at');
-- 期望：0 rows
```

- [ ] **Step 2: 写 migration 文件**

```sql
-- apps/api/db/migrations/20260522_130000_user_clip_oauth.sql
ALTER TABLE zenithjoy.user_clip_settings
  ADD COLUMN IF NOT EXISTS notion_token            TEXT,
  ADD COLUMN IF NOT EXISTS feishu_user_token       TEXT,
  ADD COLUMN IF NOT EXISTS feishu_refresh_token    TEXT,
  ADD COLUMN IF NOT EXISTS feishu_user_id          TEXT,
  ADD COLUMN IF NOT EXISTS feishu_user_name        TEXT,
  ADD COLUMN IF NOT EXISTS feishu_token_expires_at TIMESTAMPTZ;

COMMENT ON COLUMN zenithjoy.user_clip_settings.notion_token
  IS 'Notion Integration Token (用户自填，明文存储)';
COMMENT ON COLUMN zenithjoy.user_clip_settings.feishu_user_token
  IS 'Feishu user_access_token (OAuth, 12h TTL)';
COMMENT ON COLUMN zenithjoy.user_clip_settings.feishu_refresh_token
  IS 'Feishu refresh_token (30d TTL)';
```

- [ ] **Step 3: 查看 migration runner 用法并跑 migration**

```bash
# 查看现有 migration 命令
grep -r "migrate\|migration" /Users/administrator/perfect21/zenithjoy/apps/api/package.json
# 跑 migration（根据实际命令）
cd /Users/administrator/perfect21/zenithjoy && npm run migrate --workspace=apps/api
# 或直接 psql
psql $DATABASE_URL -f apps/api/db/migrations/20260522_130000_user_clip_oauth.sql
```

- [ ] **Step 4: 验证列已存在**

```bash
psql $DATABASE_URL -c "SELECT column_name FROM information_schema.columns WHERE table_schema='zenithjoy' AND table_name='user_clip_settings' AND column_name LIKE 'feishu%' OR column_name='notion_token';"
# 期望：6 rows
```

- [ ] **Step 5: Commit**

```bash
cd /Users/administrator/perfect21/zenithjoy
git add apps/api/db/migrations/20260522_130000_user_clip_oauth.sql
git commit -m "feat(clips): add per-user OAuth token columns to user_clip_settings

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 2: Backend — clips-auth.service.ts（Feishu OAuth + Notion token 验证）

**Files:**
- Create: `apps/api/src/services/clips-auth.service.ts`
- Create: `apps/api/src/services/clips-auth.service.test.ts`

- [ ] **Step 1: 写失败 unit 测试**

```typescript
// apps/api/src/services/clips-auth.service.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildFeishuOAuthUrl, parseFeishuTokenResponse, validateNotionToken } from './clips-auth.service';

describe('buildFeishuOAuthUrl', () => {
  it('包含 app_id、redirect_uri、scope=bitable:app、state', () => {
    process.env.FEISHU_APP_ID = 'test_app_id';
    process.env.API_PUBLIC_URL = 'https://example.com';
    const url = buildFeishuOAuthUrl('user123');
    expect(url).toContain('app_id=test_app_id');
    expect(url).toContain('scope=bitable%3Aapp');
    expect(url).toContain('redirect_uri=');
    expect(url).toContain('state=');
  });
});

describe('parseFeishuTokenResponse', () => {
  it('提取 access_token、refresh_token、open_id、expires_in', () => {
    const raw = {
      access_token: 'tok123',
      refresh_token: 'ref456',
      open_id: 'ou_abc',
      expires_in: 43200,
      name: '张三',
    };
    const result = parseFeishuTokenResponse(raw);
    expect(result.userToken).toBe('tok123');
    expect(result.refreshToken).toBe('ref456');
    expect(result.userId).toBe('ou_abc');
    expect(result.userName).toBe('张三');
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });
});

describe('validateNotionToken', () => {
  it('token 有效时返回 true', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true } as any);
    const result = await validateNotionToken('ntn_validtoken');
    expect(result).toBe(true);
  });

  it('token 无效时返回 false', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false } as any);
    const result = await validateNotionToken('ntn_badtoken');
    expect(result).toBe(false);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd /Users/administrator/perfect21/zenithjoy
npx vitest run apps/api/src/services/clips-auth.service.test.ts 2>&1 | tail -20
# 期望：FAIL（clips-auth.service 不存在）
```

- [ ] **Step 3: 实现 clips-auth.service.ts**

```typescript
// apps/api/src/services/clips-auth.service.ts
import crypto from 'crypto';

const FEISHU_AUTHORIZE_URL = 'https://open.feishu.cn/open-apis/authen/v1/authorize';
const FEISHU_TOKEN_URL = 'https://open.feishu.cn/open-apis/authen/v1/access_token';
const FEISHU_REFRESH_URL = 'https://open.feishu.cn/open-apis/authen/v1/refresh_access_token';
const FEISHU_USERINFO_URL = 'https://open.feishu.cn/open-apis/authen/v1/user_info';
const STATE_SECRET = process.env.FEISHU_STATE_SECRET || process.env.FEISHU_APP_SECRET || 'fallback';

export function buildFeishuOAuthUrl(userId: string): string {
  const appId = process.env.FEISHU_APP_ID;
  const apiPublicUrl = process.env.API_PUBLIC_URL;
  if (!appId || !apiPublicUrl) throw new Error('FEISHU_APP_ID / API_PUBLIC_URL 未配置');

  const timestamp = Date.now();
  const state = crypto
    .createHmac('sha256', STATE_SECRET)
    .update(`${userId}:${timestamp}`)
    .digest('hex')
    .slice(0, 16) + ':' + timestamp + ':' + userId;

  const redirectUri = `${apiPublicUrl}/api/clips/auth/feishu/callback`;
  const url = new URL(FEISHU_AUTHORIZE_URL);
  url.searchParams.set('app_id', appId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', 'bitable:app');
  url.searchParams.set('state', state);
  return url.toString();
}

export function parseFeishuState(state: string): { userId: string; timestamp: number } | null {
  try {
    const parts = state.split(':');
    if (parts.length < 3) return null;
    const [, timestamp, userId] = parts;
    const ts = parseInt(timestamp, 10);
    if (Date.now() - ts > 10 * 60 * 1000) return null; // 10分钟窗口
    return { userId, timestamp: ts };
  } catch {
    return null;
  }
}

export interface FeishuTokenResult {
  userToken: string;
  refreshToken: string;
  userId: string;
  userName: string;
  expiresAt: Date;
}

export function parseFeishuTokenResponse(raw: any): FeishuTokenResult {
  return {
    userToken: raw.access_token,
    refreshToken: raw.refresh_token,
    userId: raw.open_id,
    userName: raw.name || raw.en_name || '',
    expiresAt: new Date(Date.now() + (raw.expires_in - 300) * 1000), // 提前5分钟
  };
}

export async function exchangeFeishuCode(code: string): Promise<FeishuTokenResult> {
  const appId = process.env.FEISHU_APP_ID!;
  const appSecret = process.env.FEISHU_APP_SECRET!;
  const res = await fetch(FEISHU_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'authorization_code', code, app_id: appId, app_secret: appSecret }),
  });
  const json = await res.json() as any;
  if (json.code !== 0) throw new Error(`Feishu token exchange failed: ${json.msg}`);
  return parseFeishuTokenResponse(json.data);
}

export async function refreshFeishuToken(refreshToken: string): Promise<FeishuTokenResult> {
  const appId = process.env.FEISHU_APP_ID!;
  const appSecret = process.env.FEISHU_APP_SECRET!;
  const res = await fetch(FEISHU_REFRESH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: refreshToken, app_id: appId, app_secret: appSecret }),
  });
  const json = await res.json() as any;
  if (json.code !== 0) throw new Error(`Feishu token refresh failed: ${json.msg}`);
  return parseFeishuTokenResponse(json.data);
}

export async function validateNotionToken(token: string): Promise<boolean> {
  const res = await fetch('https://api.notion.com/v1/users/me', {
    headers: {
      Authorization: `Bearer ${token}`,
      'Notion-Version': '2022-06-28',
    },
  });
  return res.ok;
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
cd /Users/administrator/perfect21/zenithjoy
npx vitest run apps/api/src/services/clips-auth.service.test.ts 2>&1 | tail -20
# 期望：PASS (4 tests)
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/clips-auth.service.ts apps/api/src/services/clips-auth.service.test.ts
git commit -m "feat(clips): clips-auth.service — Feishu OAuth + Notion token validation

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 3: Backend — clips-auth 路由 + controller 端点

**Files:**
- Create: `apps/api/src/routes/clips-auth.ts`
- Modify: `apps/api/src/controllers/clips.controller.ts` (新增 3 个方法)
- Modify: `apps/api/src/routes/clips.ts` (新增 3 条路由)
- Modify: `apps/api/src/app.ts` (挂载 clips-auth router)

- [ ] **Step 1: 先查看现有 clips.controller.ts 结构**

```bash
cat /Users/administrator/perfect21/zenithjoy/apps/api/src/controllers/clips.controller.ts | head -60
cat /Users/administrator/perfect21/zenithjoy/apps/api/src/routes/clips.ts
cat /Users/administrator/perfect21/zenithjoy/apps/api/src/app.ts | grep -A2 clips
```

- [ ] **Step 2: 新增 clips-auth.ts 路由（OAuth callback）**

```typescript
// apps/api/src/routes/clips-auth.ts
import { Router, Request, Response } from 'express';
import { auth } from '../lib/auth';
import { fromNodeHeaders } from 'better-auth/node';
import { buildFeishuOAuthUrl, exchangeFeishuCode, parseFeishuState } from '../services/clips-auth.service';
import { upsertFeishuBinding } from '../services/clips.service';

const router = Router();

// GET /api/clips/auth/feishu → 重定向飞书 OAuth
router.get('/feishu', async (req: Request, res: Response) => {
  const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
  if (!session) return res.status(401).json({ error: 'unauthorized' });

  try {
    const oauthUrl = buildFeishuOAuthUrl(session.user.id);
    return res.redirect(oauthUrl);
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// GET /api/clips/auth/feishu/callback → 换 token 存 DB
router.get('/feishu/callback', async (req: Request, res: Response) => {
  const { code, state } = req.query as { code: string; state: string };
  const dashboardUrl = process.env.DASHBOARD_URL || 'https://autopilot.zenjoymedia.media';

  if (!code || !state) return res.redirect(`${dashboardUrl}/clips?tab=settings&error=invalid_callback`);

  const parsed = parseFeishuState(state);
  if (!parsed) return res.redirect(`${dashboardUrl}/clips?tab=settings&error=invalid_state`);

  try {
    const tokenResult = await exchangeFeishuCode(code);
    await upsertFeishuBinding(parsed.userId, tokenResult);
    return res.redirect(`${dashboardUrl}/clips?tab=settings&feishu=bound`);
  } catch (e: any) {
    console.error('[clips-auth] feishu callback error:', e.message);
    return res.redirect(`${dashboardUrl}/clips?tab=settings&error=feishu_failed`);
  }
});

export default router;
```

- [ ] **Step 3: 在 clips.controller.ts 新增 3 个方法**

在现有 controller 末尾添加（不改动已有方法）：

```typescript
// 在 clips.controller.ts 末尾追加（同时在文件顶部 import 区加）：
// import { validateNotionToken } from '../services/clips-auth.service';
// import { upsertNotionToken, clearFeishuBinding, clearNotionToken } from '../services/clips.service';

export async function saveNotionToken(req: Request, res: Response) {
  const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
  if (!session) return res.status(401).json({ error: 'unauthorized' });
  const { token } = req.body as { token: string };
  if (!token?.startsWith('ntn_') && !token?.startsWith('secret_')) {
    return res.status(400).json({ error: 'invalid_token_format' });
  }
  const valid = await validateNotionToken(token);
  if (!valid) return res.status(400).json({ error: 'notion_token_invalid' });
  await upsertNotionToken(session.user.id, token);
  return res.json({ success: true });
}

export async function deleteFeishuBinding(req: Request, res: Response) {
  const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
  if (!session) return res.status(401).json({ error: 'unauthorized' });
  await clearFeishuBinding(session.user.id);
  return res.json({ success: true });
}

export async function deleteNotionBinding(req: Request, res: Response) {
  const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
  if (!session) return res.status(401).json({ error: 'unauthorized' });
  await clearNotionToken(session.user.id);
  return res.json({ success: true });
}
```

- [ ] **Step 4: 在 clips.service.ts 新增 4 个辅助函数**

```typescript
// 追加到 clips.service.ts

export async function upsertFeishuBinding(userId: string, tokenResult: FeishuTokenResult) {
  await pool.query(
    `INSERT INTO zenithjoy.user_clip_settings (user_id, feishu_user_token, feishu_refresh_token, feishu_user_id, feishu_user_name, feishu_token_expires_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       feishu_user_token = EXCLUDED.feishu_user_token,
       feishu_refresh_token = EXCLUDED.feishu_refresh_token,
       feishu_user_id = EXCLUDED.feishu_user_id,
       feishu_user_name = EXCLUDED.feishu_user_name,
       feishu_token_expires_at = EXCLUDED.feishu_token_expires_at,
       updated_at = NOW()`,
    [userId, tokenResult.userToken, tokenResult.refreshToken, tokenResult.userId, tokenResult.userName, tokenResult.expiresAt]
  );
}

export async function upsertNotionToken(userId: string, token: string) {
  await pool.query(
    `INSERT INTO zenithjoy.user_clip_settings (user_id, notion_token, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (user_id) DO UPDATE SET notion_token = EXCLUDED.notion_token, updated_at = NOW()`,
    [userId, token]
  );
}

export async function clearFeishuBinding(userId: string) {
  await pool.query(
    `UPDATE zenithjoy.user_clip_settings
     SET feishu_user_token=NULL, feishu_refresh_token=NULL, feishu_user_id=NULL,
         feishu_user_name=NULL, feishu_token_expires_at=NULL, updated_at=NOW()
     WHERE user_id=$1`,
    [userId]
  );
}

export async function clearNotionToken(userId: string) {
  await pool.query(
    `UPDATE zenithjoy.user_clip_settings SET notion_token=NULL, updated_at=NOW() WHERE user_id=$1`,
    [userId]
  );
}
```

- [ ] **Step 5: 在 clips.ts 路由添加 3 条新路由**

```typescript
// 在 clips.ts 现有路由末尾追加
router.put('/settings/notion-token', saveNotionToken);
router.delete('/settings/feishu', deleteFeishuBinding);
router.delete('/settings/notion', deleteNotionBinding);
```

- [ ] **Step 6: 在 app.ts 挂载 clips-auth 路由**

```typescript
import clipsAuthRouter from './routes/clips-auth';
app.use('/api/clips/auth', clipsAuthRouter);
```

- [ ] **Step 7: 确认 TypeScript 编译无错**

```bash
cd /Users/administrator/perfect21/zenithjoy/apps/api
npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/routes/clips-auth.ts apps/api/src/controllers/clips.controller.ts \
        apps/api/src/services/clips.service.ts apps/api/src/routes/clips.ts apps/api/src/app.ts
git commit -m "feat(clips): OAuth routes + controller endpoints for per-user binding

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 4: Backend — clip-output.service.ts 改造（读用户 token）

**Files:**
- Modify: `apps/api/src/services/clip-output.service.ts`

- [ ] **Step 1: 阅读现有 clip-output.service.ts**

```bash
cat /Users/administrator/perfect21/zenithjoy/apps/api/src/services/clip-output.service.ts
```

- [ ] **Step 2: 重写核心推送逻辑**

将 `pushClipOutput(clipId, userId)` 函数改为：
1. 从 `user_clip_settings` 读 `notion_token`、`feishu_user_token`、`feishu_token_expires_at`、`feishu_refresh_token`
2. 若 feishu token 将在 5 分钟内过期 → 调 `refreshFeishuToken()` → 更新 DB
3. 根据 clip 的 `output_type` 选择推送渠道：
   - `notion` → 用 user 的 `notion_token`（替代全局 env）
   - `feishu` → 用 user 的 `feishu_user_token`（替代 tenant_access_token）
   - 无 token → `output_status = 'skipped'`，直接返回

```typescript
// clip-output.service.ts 关键改动
// 在文件顶部新增 import（替换原有的 NOTION_API_KEY / getValidToken 引用）：
import { FeishuTokenResult, refreshFeishuToken } from './clips-auth.service';
import { getSettings, getClipById, updateOutputStatus, upsertFeishuBinding } from './clips.service';
// 注：getClipById 和 updateOutputStatus 需确认在 clips.service.ts 中已导出（Step 1 阅读后确认）

export async function pushClipOutput(clipId: string, userId: string): Promise<void> {
  // 1. 查 clip 信息
  const clip = await getClipById(clipId, userId);
  if (!clip || !clip.output_url || !clip.output_type) {
    await updateOutputStatus(clipId, 'skipped');
    return;
  }

  // 2. 查用户绑定
  const settings = await getSettings(userId);

  if (clip.output_type === 'notion') {
    const token = settings?.notion_token;
    if (!token) { await updateOutputStatus(clipId, 'skipped'); return; }
    await pushToNotion(clip, token);
  } else if (clip.output_type === 'feishu') {
    let token = settings?.feishu_user_token;
    if (!token) { await updateOutputStatus(clipId, 'skipped'); return; }

    // 自动 refresh
    if (settings?.feishu_token_expires_at && new Date(settings.feishu_token_expires_at) < new Date(Date.now() + 5 * 60 * 1000)) {
      try {
        const refreshed = await refreshFeishuToken(settings.feishu_refresh_token!);
        await upsertFeishuBinding(userId, refreshed);
        token = refreshed.userToken;
      } catch (e) {
        console.warn('[clip-output] feishu refresh failed, skip push');
        await updateOutputStatus(clipId, 'skipped');
        return;
      }
    }
    await pushToFeishu(clip, token);
  }
}

// pushToNotion 改造：接受 token 参数而非读 env
async function pushToNotion(clip: Clip, notionToken: string): Promise<void> {
  // ... 现有逻辑，将 process.env.NOTION_API_KEY 替换为 notionToken 参数
}

// pushToFeishu 改造：接受 userToken 参数而非 tenant_access_token
async function pushToFeishu(clip: Clip, userToken: string): Promise<void> {
  // ... 现有 Feishu Bitable 写入逻辑，将 getValidToken() 替换为 userToken 参数
}
```

- [ ] **Step 3: 确认 TypeScript 编译通过**

```bash
cd /Users/administrator/perfect21/zenithjoy/apps/api && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/services/clip-output.service.ts
git commit -m "feat(clips): clip-output reads per-user tokens, skips if unbound

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 5: Frontend — content-clipper.api.ts 新增绑定 API

**Files:**
- Modify: `apps/dashboard/src/api/content-clipper.api.ts`

- [ ] **Step 1: 查看现有 API 文件**

```bash
cat /Users/administrator/perfect21/zenithjoy/apps/dashboard/src/api/content-clipper.api.ts
```

- [ ] **Step 2: 追加 3 个新函数**

```typescript
// 追加到 content-clipper.api.ts

export async function initiateFeishuOAuth(): Promise<void> {
  // 重定向到 /api/clips/auth/feishu（浏览器全页跳转）
  window.location.href = '/api/clips/auth/feishu';
}

export async function saveNotionToken(token: string): Promise<void> {
  const res = await fetch('/api/clips/settings/notion-token', {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'failed');
  }
}

export async function deleteFeishuBinding(): Promise<void> {
  await fetch('/api/clips/settings/feishu', { method: 'DELETE', credentials: 'include' });
}

export async function deleteNotionBinding(): Promise<void> {
  await fetch('/api/clips/settings/notion', { method: 'DELETE', credentials: 'include' });
}
```

- [ ] **Step 3: 更新 getClipSettings 返回类型**

在 `ClipSettings` 类型中加入新字段（只读，不发送）：
```typescript
export interface ClipSettings {
  defaultOutputUrl?: string;
  defaultOutputType?: 'notion' | 'feishu';
  notionBound: boolean;          // ← 新增（后端返回是否已绑定）
  feishuBound: boolean;          // ← 新增
  feishuUserName?: string;       // ← 新增（已绑定时展示用户名）
}
```

同时更新后端 `getSettings()` 返回：
```typescript
// clips.service.ts getSettings 函数追加返回字段
return {
  defaultOutputUrl: row.default_output_url,
  defaultOutputType: row.default_output_type,
  notionBound: !!row.notion_token,
  feishuBound: !!row.feishu_user_token,
  feishuUserName: row.feishu_user_name || undefined,
};
```

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/api/content-clipper.api.ts apps/api/src/services/clips.service.ts
git commit -m "feat(clips): frontend API helpers for OAuth binding management

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 6: Frontend — ContentClipperPage Settings Tab 重构

**Files:**
- Modify: `apps/dashboard/src/pages/ContentClipperPage.tsx`

- [ ] **Step 1: 查看现有 ContentClipperPage.tsx settings tab 部分**

```bash
grep -n "settings\|Settings\|输出\|binding\|feishu\|notion" \
  /Users/administrator/perfect21/zenithjoy/apps/dashboard/src/pages/ContentClipperPage.tsx | head -40
```

- [ ] **Step 2: 重构 Settings Tab**

找到 Settings Tab 的 JSX 段落，替换为以下结构。

**在文件顶部 import 区补充（如未已导入）：**
```typescript
import { initiateFeishuOAuth, saveNotionToken, deleteFeishuBinding, deleteNotionBinding } from '../api/content-clipper.api';
```

```tsx
// Settings Tab 新 UI
function SettingsTab({ settings, refetch }: { settings: ClipSettings | null; refetch: () => void }) {
  const [notionInput, setNotionInput] = useState('');
  const [notionSaving, setNotionSaving] = useState(false);
  const [notionError, setNotionError] = useState('');

  // 读取 URL 参数（飞书 OAuth 回调后带 feishu=bound 或 error=xxx）
  const searchParams = new URLSearchParams(window.location.search);
  const feishuResult = searchParams.get('feishu');
  const oauthError = searchParams.get('error');

  return (
    <div className="space-y-6 max-w-lg">
      {/* 飞书 Bitable */}
      <div className="border rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-medium">飞书 Bitable</h3>
          {settings?.feishuBound ? (
            <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded">
              已绑定：{settings.feishuUserName || '飞书用户'}
            </span>
          ) : (
            <span className="text-xs bg-gray-100 text-gray-500 px-2 py-1 rounded">未绑定</span>
          )}
        </div>
        {feishuResult === 'bound' && (
          <p className="text-sm text-green-600 mb-2">飞书账号绑定成功</p>
        )}
        {oauthError && (
          <p className="text-sm text-red-500 mb-2">绑定失败，请重试</p>
        )}
        <div className="flex gap-2">
          <button
            onClick={initiateFeishuOAuth}
            className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            {settings?.feishuBound ? '重新绑定' : '绑定飞书'}
          </button>
          {settings?.feishuBound && (
            <button
              onClick={async () => { await deleteFeishuBinding(); refetch(); }}
              className="px-3 py-1.5 text-sm border rounded hover:bg-gray-50"
            >
              解除绑定
            </button>
          )}
        </div>
      </div>

      {/* Notion */}
      <div className="border rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-medium">Notion</h3>
          {settings?.notionBound ? (
            <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded">已绑定</span>
          ) : (
            <span className="text-xs bg-gray-100 text-gray-500 px-2 py-1 rounded">未绑定</span>
          )}
        </div>
        <p className="text-xs text-gray-500 mb-2">
          在 <a href="https://www.notion.so/profile/integrations" target="_blank" className="underline">Notion 集成设置</a> 创建 Integration 并复制 Token
        </p>
        <div className="flex gap-2">
          <input
            type="password"
            placeholder="ntn_xxxx..."
            value={notionInput}
            onChange={e => setNotionInput(e.target.value)}
            className="flex-1 text-sm border rounded px-2 py-1.5"
          />
          <button
            disabled={!notionInput || notionSaving}
            onClick={async () => {
              setNotionSaving(true); setNotionError('');
              try { await saveNotionToken(notionInput); setNotionInput(''); refetch(); }
              catch (e: any) { setNotionError(e.message === 'notion_token_invalid' ? 'Token 无效' : '保存失败'); }
              finally { setNotionSaving(false); }
            }}
            className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {notionSaving ? '验证中...' : '保存'}
          </button>
          {settings?.notionBound && (
            <button
              onClick={async () => { await deleteNotionBinding(); refetch(); }}
              className="px-3 py-1.5 text-sm border rounded hover:bg-gray-50"
            >
              删除
            </button>
          )}
        </div>
        {notionError && <p className="text-sm text-red-500 mt-1">{notionError}</p>}
      </div>

      {/* 默认输出链接（已绑定才展示） */}
      {(settings?.feishuBound || settings?.notionBound) && (
        <DefaultOutputUrlSection settings={settings} refetch={refetch} />
      )}
    </div>
  );
}
```

（`DefaultOutputUrlSection` 是现有默认输出链接输入框的抽取，保持原逻辑不变。）

- [ ] **Step 3: 确认 TypeScript 编译通过**

```bash
cd /Users/administrator/perfect21/zenithjoy/apps/dashboard && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 4: 本地启动验证 UI**

```bash
cd /Users/administrator/perfect21/zenithjoy
# 启动 API（端口 5200）
cd apps/api && npm run dev &
# 启动 Dashboard（端口 3001 或 5173）
cd apps/dashboard && npm run dev &
# 打开 http://localhost:3001/clips?tab=settings 验证绑定 UI
```

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/pages/ContentClipperPage.tsx
git commit -m "feat(clips): Settings tab redesign — per-user Feishu OAuth + Notion token binding

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 7: E2E 测试更新 + PR 创建

**Files:**
- Modify: `apps/dashboard/e2e/content-clipper.spec.ts`
- Create: PR in ZenithJoy repo

- [ ] **Step 1: 更新 E2E 测试的 settings tab 验证**

在现有 E2E test 中，将 "设置 tab" 测试用例改为验证新 UI：

```typescript
test('设置 tab → 显示飞书和 Notion 绑定区块', async ({ page }) => {
  await page.goto('/clips?tab=settings');
  await expect(page.locator('h3', { hasText: '飞书 Bitable' })).toBeVisible();
  await expect(page.locator('h3', { hasText: 'Notion' })).toBeVisible();
  await expect(page.locator('button', { hasText: '绑定飞书' })).toBeVisible();
  await expect(page.locator('input[placeholder*="ntn_"]')).toBeVisible();
});
```

- [ ] **Step 2: 验证所有 mock 响应包含新字段**

在 `page.route('/api/clips/settings', ...)` mock 中加入：
```typescript
await page.route('/api/clips/settings', async route => {
  await route.fulfill({
    json: {
      defaultOutputUrl: null,
      defaultOutputType: null,
      notionBound: false,
      feishuBound: false,
      feishuUserName: null,
    }
  });
});
```

- [ ] **Step 3: 在 ZenithJoy 创建 PR**

```bash
cd /Users/administrator/perfect21/zenithjoy
git push origin HEAD
gh pr create \
  --title "feat(clips): per-user output binding — Feishu OAuth + Notion token + clipboard mode" \
  --body "$(cat <<'EOF'
## Summary
- DB: 6 new columns in user_clip_settings for per-user OAuth tokens
- Backend: Feishu OAuth flow (GET /auth/feishu → callback → store user_access_token)
- Backend: Notion token save/validate/delete endpoints
- Backend: clip-output.service reads per-user tokens; auto-refreshes Feishu; skips push if unbound (clipboard mode)
- Frontend: Settings tab redesigned with binding status badges, OAuth button, token input

## Test plan
- [ ] 飞书 OAuth 授权后 settings 显示"已绑定"
- [ ] Notion token 输入无效 token 显示"Token 无效"
- [ ] 无绑定时提交 clip → output_status='skipped' 无报错
- [ ] Windows E2E CI 通过

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: 等待 CI 通过后 merge**

```bash
gh pr checks --watch
```

---

## Verification

1. 访问 `/clips?tab=settings` → 看到飞书 Bitable 和 Notion 两个绑定区块（均显示"未绑定"）
2. 点击"绑定飞书" → 跳转飞书授权页 → 授权后 redirect 回 `/clips?tab=settings&feishu=bound` → 显示"已绑定：用户名"
3. 填入无效 Notion Token → 点保存 → 显示"Token 无效"
4. 填入有效 Notion Token → 显示"已绑定"
5. 提交一条抖音链接（不设置输出链接）→ clip status 变 done，output_status = 'skipped'
6. 提交同一链接并设置输出链接 → 成功推送到对应平台
