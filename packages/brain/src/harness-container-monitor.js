/**
 * harness-container-monitor.js — harness 容器健康检查 + 干预任务 dispatch
 *
 * 职责：
 *   1. 检查 harness 相关 Docker 容器状态（exited/unhealthy）
 *   2. 发现异常时创建 harness_intervention task（幂等，30min 时间窗口）
 *   3. 三级降级告警：Bark → 飞书 → cecelia_events（末端不丢）
 *
 * tick-runner.js 每 CONTAINER_MONITOR_INTERVAL_MS（默认 30s）调用一次，
 * MINIMAL_MODE 下仍运行（守护模式）。
 */

import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const BARK_TOKEN = process.env.BARK_TOKEN || '';
const FEISHU_WEBHOOK_URL = process.env.FEISHU_BOT_WEBHOOK || process.env.FEISHU_WEBHOOK || '';
const INTERVENTION_WINDOW_MS = 30 * 60 * 1000; // 30 分钟去重窗口

/**
 * 发送 Bark 推送（第 1 级告警）
 * @returns {Promise<boolean>}
 */
async function sendBark(title, body) {
  if (!BARK_TOKEN) return false;
  try {
    const url = `https://api.day.app/${BARK_TOKEN}/${encodeURIComponent(title)}/${encodeURIComponent(body)}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const result = await resp.json();
    if (result.code !== 200) {
      console.warn('[container-monitor] Bark 推送失败:', result.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[container-monitor] Bark 推送异常 (non-fatal):', err.message);
    return false;
  }
}

/**
 * 发送飞书 Webhook 告警（第 2 级告警）
 * @returns {Promise<boolean>}
 */
async function sendFeishu(text) {
  const webhookUrl = FEISHU_WEBHOOK_URL;
  if (!webhookUrl) return false;
  try {
    const resp = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msg_type: 'text', content: { text } }),
      signal: AbortSignal.timeout(8000),
    });
    const result = await resp.json();
    if (result.code !== 0 && result.StatusCode !== 0) {
      console.warn('[container-monitor] 飞书 lark Webhook 失败:', result.msg || result.StatusMessage);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[container-monitor] 飞书 lark Webhook 异常 (non-fatal):', err.message);
    return false;
  }
}

/**
 * 三级降级告警链：Bark → 飞书 → cecelia_events（intervention_alert_fallback）
 *
 * Bark + 飞书均失败/未配置时，降级写 cecelia_events，确保告警不丢。
 * @param {import('pg').Pool} pool
 * @param {object} info
 */
async function sendAlertWithFallback(pool, info) {
  const text = `[harness-container-monitor] 容器异常: ${info.anomalyType} initiative=${info.initiativeId} reason=${info.reason}`;

  const barkOk = await sendBark('Harness 容器告警', text);
  const feishuOk = await sendFeishu(text);

  // 第 3 级：Bark + 飞书均失败/未配置 → cecelia_events intervention_alert_fallback
  if (!barkOk && !feishuOk) {
    try {
      await pool.query(
        `INSERT INTO cecelia_events (event_type, source, payload) VALUES ($1, $2, $3)`,
        [
          'intervention_alert_fallback',
          'harness-container-monitor',
          JSON.stringify({ ...info, text, fallback: true }),
        ]
      );
    } catch (err) {
      console.warn('[container-monitor] cecelia_events fallback 写入失败 (non-fatal):', err.message);
    }
  }
}

/**
 * 向 DB tasks 表写入 harness_intervention 记录（带时间窗口幂等保护）。
 *
 * 若同 initiativeId 在 INTERVENTION_WINDOW_MS 内已有 in_progress intervention，
 * 直接返回 { skipped: true }。
 *
 * @param {import('pg').Pool} pool
 * @param {{ initiativeId: string, reason: string, anomalyType: string }} opts
 * @returns {Promise<{ id: string, skipped?: boolean }>}
 */
export async function createInterventionTask(pool, { initiativeId, reason, anomalyType }) {
  // 幂等检查：近期同 initiative 是否已有 in_progress harness_intervention
  const existing = await pool.query(
    `SELECT id FROM tasks
     WHERE task_type = $1
       AND status IN ('pending', 'in_progress')
       AND payload::text LIKE $2
       AND created_at > NOW() - INTERVAL '30 minutes'
     LIMIT 1`,
    ['harness_intervention', `%${initiativeId}%`]
  );

  if (existing.rows.length > 0) {
    return { skipped: true, existingId: existing.rows[0].id };
  }

  // 写入新 intervention task
  const inserted = await pool.query(
    `INSERT INTO tasks (title, task_type, status, priority, trigger_source, payload, created_at)
     VALUES ($1, 'harness_intervention', 'pending', 'P1', 'harness-container-monitor', $2, NOW())
     RETURNING id, task_type`,
    [
      `[harness-monitor] 容器异常干预 initiative=${initiativeId} type=${anomalyType}`,
      JSON.stringify({ initiativeId, reason, anomalyType, detectedAt: new Date().toISOString() }),
    ]
  );

  // 写入 cecelia_events intervention_result
  try {
    await pool.query(
      `INSERT INTO cecelia_events (event_type, source, payload) VALUES ($1, $2, $3)`,
      [
        'intervention_result',
        'harness-container-monitor',
        JSON.stringify({
          taskId: inserted.rows[0]?.id,
          initiativeId,
          reason,
          anomalyType,
          created_at: new Date().toISOString(),
        }),
      ]
    );
  } catch (err) {
    console.warn('[container-monitor] cecelia_events intervention_result 写入失败 (non-fatal):', err.message);
  }

  return inserted.rows[0] || { id: null };
}

/**
 * 检查 harness 相关容器状态，发现 exited/unhealthy 时触发干预。
 *
 * 函数签名：opts: { pool, dockerUnavailable?: boolean }
 *   - dockerUnavailable: true  → 跳过真实 docker 调用（测试/CI 注入 flag）
 *
 * @param {{ pool: import('pg').Pool, dockerUnavailable?: boolean }} opts
 * @returns {Promise<{ checked: number, anomalies: object[] }>}
 */
export async function checkHarnessContainers({ pool, dockerUnavailable = false } = {}) {
  if (dockerUnavailable) {
    // 测试/CI 注入 flag：跳过真实 docker 调用，warm-run 验证签名可调用
    console.log('[container-monitor] dockerUnavailable=true, skipping docker check');
    return { checked: 0, anomalies: [] };
  }

  let containers = [];

  try {
    // 列出所有以 harness- / cp- 开头的容器（包含 exited 状态）
    const { stdout } = await execFileAsync('docker', [
      'ps', '-a',
      '--filter', 'name=harness',
      '--format', '{{.ID}}\t{{.Names}}\t{{.Status}}\t{{.Labels}}',
    ], { timeout: 10000 });

    containers = stdout.trim().split('\n').filter(Boolean).map(line => {
      const [id, name, status] = line.split('\t');
      return { id, name, status };
    });
  } catch (err) {
    console.warn('[container-monitor] docker 不可用，跳过容器检查 (non-fatal):', err.message);
    return { checked: 0, anomalies: [] };
  }

  const anomalies = [];

  for (const container of containers) {
    const isExited = container.status?.toLowerCase().startsWith('exited');
    const isUnhealthy = container.status?.toLowerCase().includes('unhealthy');

    if (!isExited && !isUnhealthy) continue;

    const anomalyType = isExited ? 'exited' : 'unhealthy';

    // 从容器名提取 initiativeId（命名约定 harness-<initiative_id>-...）
    const match = container.name?.match(/harness-([a-f0-9-]{36})/);
    if (!match) continue;

    const initiativeId = match[1];
    anomalies.push({ container: container.name, anomalyType, initiativeId });

    // 触发干预 + 三级告警
    try {
      const result = await createInterventionTask(pool, {
        initiativeId,
        reason: `container ${container.name} is ${anomalyType}`,
        anomalyType,
      });

      if (!result?.skipped) {
        await sendAlertWithFallback(pool, { initiativeId, reason: `container ${anomalyType}`, anomalyType });
      }
    } catch (err) {
      console.warn(`[container-monitor] 处理容器 ${container.name} 异常 (non-fatal):`, err.message);
    }
  }

  return { checked: containers.length, anomalies };
}

export default { checkHarnessContainers, createInterventionTask };
