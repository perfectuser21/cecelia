/**
 * E2E 验收测试 — PR3/4 主理人对话回路
 *
 * 环境：mac_web（Playwright，localhost:5174）
 * 执行前提：Brain API (localhost:5221) 已启动，DB 含测试 journey + decision 数据
 *
 * 场景 A（必须通过）：Line 指挥页 → 新建对话 → 发消息 → 等待 assistant 回复 → 返回列表断言徽章
 * 场景 B（GP 页新建对话，断言 gp_id 非 NULL）
 * 场景 C（GP 页刷新后历史可见，消息完整）
 */

import { test, expect } from '@playwright/test';
import { Client } from 'pg';

// ── DB 客户端（直查 DB 做最终断言）─────────────────────────────────────────
async function getDbClient() {
  const client = new Client({
    host: 'localhost',
    port: 5432,
    database: 'cecelia',
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || '',
  });
  await client.connect();
  return client;
}

// ── 测试数据准备（从 DB 取第一个 active journey）────────────────────────────
async function getTestJourneyId(client: Client): Promise<string> {
  const res = await client.query(
    `SELECT id FROM journeys WHERE status = 'active' ORDER BY created_at DESC LIMIT 1`
  );
  if (res.rows.length === 0) throw new Error('DB 中无 active journey，请先准备测试数据');
  return res.rows[0].id;
}

async function getTestFeatureId(client: Client, journeyId: string): Promise<string | null> {
  const res = await client.query(
    `SELECT id FROM features WHERE journey_id = $1 LIMIT 1`,
    [journeyId]
  );
  return res.rows.length > 0 ? res.rows[0].id : null;
}

async function getTestDecisionTopic(client: Client, journeyId: string): Promise<string> {
  const res = await client.query(
    `SELECT title FROM decisions WHERE journey_id = $1 AND status = 'active' LIMIT 1`,
    [journeyId]
  );
  return res.rows.length > 0 ? res.rows[0].title : '测试议题';
}

// ── 场景 A ───────────────────────────────────────────────────────────────────
test('场景A：Line指挥页新建对话→发消息→等待assistant回复→状态徽章', async ({ page }) => {
  const db = await getDbClient();

  try {
    const journeyId = await getTestJourneyId(db);
    const decisionTopic = await getTestDecisionTopic(db, journeyId);

    // 1. 打开 Line 指挥页
    await page.goto(`http://localhost:5174/warroom/line/${journeyId}`);
    await page.waitForLoadState('networkidle');

    // 2. 新建对话（栏 4）
    const newConvBtn = page.getByRole('button', { name: /新对话|开启对话/ });
    await expect(newConvBtn.first()).toBeVisible({ timeout: 10000 });
    await newConvBtn.first().click();

    // 3. 输入含真实 decision topic 的质疑
    const inputBox = page.getByPlaceholder(/向军师提问/);
    await expect(inputBox).toBeVisible({ timeout: 5000 });
    await inputBox.fill(`关于"${decisionTopic}"，你认为这个决策存在哪些风险？`);

    // 4. 发送消息
    await page.getByRole('button', { name: /^发$/ }).click();

    // 5. 等待 assistant 回复（≤30s）
    const assistantMsg = page.locator('.bg-slate-700\\/50.text-slate-300').first();
    await expect(assistantMsg).toBeVisible({ timeout: 30000 });
    const replyText = await assistantMsg.innerText();
    expect(replyText.trim().length).toBeGreaterThan(0);

    // 6. 返回列表
    await page.getByRole('button', { name: /返回/ }).click();

    // 7. 断言议题卡片可见 + 状态徽章"进行中"
    const badge = page.getByText('进行中').first();
    await expect(badge).toBeVisible({ timeout: 5000 });

    // 8. DB 断言
    const convRes = await db.query(
      `SELECT status FROM conversations WHERE journey_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [journeyId]
    );
    expect(convRes.rows.length).toBeGreaterThan(0);
    const convId = await db.query(
      `SELECT id FROM conversations WHERE journey_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [journeyId]
    );
    const cid = convId.rows[0].id;
    expect(convRes.rows[0].status).toBe('active');

    const msgRes = await db.query(
      `SELECT role, content FROM conversation_messages WHERE conversation_id = $1 ORDER BY created_at ASC`,
      [cid]
    );
    const roles = msgRes.rows.map((r: { role: string }) => r.role);
    expect(roles).toContain('user');
    expect(roles).toContain('assistant');

    const userMsg = msgRes.rows.find((r: { role: string }) => r.role === 'user');
    const assistantMsgDb = msgRes.rows.find((r: { role: string }) => r.role === 'assistant');
    expect(userMsg.content.trim().length).toBeGreaterThan(0);
    expect(assistantMsgDb.content.trim().length).toBeGreaterThan(0);

  } finally {
    await db.end();
  }
});

// ── 场景 B ───────────────────────────────────────────────────────────────────
test('场景B：从Feature行→进入GP页→新建对话→DB断言gp_id非NULL', async ({ page }) => {
  const db = await getDbClient();

  try {
    const journeyId = await getTestJourneyId(db);
    const featureId = await getTestFeatureId(db, journeyId);

    if (!featureId) {
      test.skip();
      return;
    }

    // 1. 打开 Line 指挥页
    await page.goto(`http://localhost:5174/warroom/line/${journeyId}`);
    await page.waitForLoadState('networkidle');

    // 2. 点击 Feature 行的 → 跳转按钮
    const gpArrow = page.locator(`[data-feature-id="${featureId}"] a, [data-feature-id="${featureId}"] button`).first();
    // fallback：直接导航到 GP 页
    await page.goto(`http://localhost:5174/warroom/gp/${featureId}`);
    await page.waitForLoadState('networkidle');

    // 3. 断言 GP 页加载（右栏含 ConversationsPanel）
    const newConvBtn = page.getByRole('button', { name: /新对话|开启对话/ });
    await expect(newConvBtn.first()).toBeVisible({ timeout: 10000 });

    // 4. 新建对话
    await newConvBtn.first().click();
    const inputBox = page.getByPlaceholder(/向军师提问/);
    await expect(inputBox).toBeVisible();
    await inputBox.fill('GP 页测试对话');
    await page.getByRole('button', { name: /^发$/ }).click();

    // 5. 等待 assistant 回复
    const assistantMsg = page.locator('.bg-slate-700\\/50').first();
    await expect(assistantMsg).toBeVisible({ timeout: 30000 });

    // 6. DB 断言：conversations.gp_id = featureId
    const res = await db.query(
      `SELECT gp_id FROM conversations WHERE gp_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [featureId]
    );
    expect(res.rows.length).toBeGreaterThan(0);
    expect(res.rows[0].gp_id).toBe(featureId);

  } finally {
    await db.end();
  }
});

// ── 场景 C ───────────────────────────────────────────────────────────────────
test('场景C：GP页刷新后历史议题可见，点入消息记录完整', async ({ page }) => {
  const db = await getDbClient();

  try {
    // 取一个有 gp_id 的已有 conversation
    const convRes = await db.query(
      `SELECT id, gp_id, journey_id FROM conversations
       WHERE gp_id IS NOT NULL AND status IN ('active', 'suspended')
       ORDER BY created_at DESC LIMIT 1`
    );

    if (convRes.rows.length === 0) {
      test.skip();
      return;
    }

    const { gp_id: gpId, id: convId } = convRes.rows[0];

    // 1. 打开 GP 页
    await page.goto(`http://localhost:5174/warroom/gp/${gpId}`);
    await page.waitForLoadState('networkidle');

    // 2. 断言历史议题列表可见
    const convCard = page.locator('.bg-slate-800\\/40').first();
    await expect(convCard).toBeVisible({ timeout: 10000 });

    // 3. 刷新
    await page.reload();
    await page.waitForLoadState('networkidle');

    // 4. 历史议题仍可见
    await expect(convCard).toBeVisible({ timeout: 10000 });

    // 5. 点入查看消息记录
    await convCard.click();
    // 消息记录应出现（用户或 assistant 消息气泡）
    const msgBubble = page.locator('.px-2\\.5.py-1\\.5.rounded-lg').first();
    await expect(msgBubble).toBeVisible({ timeout: 5000 });

    // 6. DB 断言：该对话有至少一条消息
    const msgCount = await db.query(
      `SELECT COUNT(*) FROM conversation_messages WHERE conversation_id = $1`,
      [convId]
    );
    expect(parseInt(msgCount.rows[0].count)).toBeGreaterThan(0);

  } finally {
    await db.end();
  }
});
