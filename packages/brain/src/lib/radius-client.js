/**
 * radius-client.js
 *
 * 封装对 /api/brain/graph/radius 端点的调用。
 * 超时 3000ms，stale=true 或任何错误均返回 null（不抛出）。
 *
 * 使用方：cascade-list.js（优先路径），null 时回退 journey_step_links 格子查询。
 */

const BRAIN_URL = process.env.BRAIN_URL || 'http://localhost:5221';
const RADIUS_TIMEOUT_MS = 3000;

/**
 * 调用 POST /api/brain/graph/radius，获取改动文件的波及范围。
 *
 * @param {string[]} changedFiles - 改动文件路径列表
 * @returns {Promise<RadiusResult|null>} 成功时返回结果对象，失败或 stale 返回 null
 */
export async function callRadius(changedFiles) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), RADIUS_TIMEOUT_MS);

  try {
    const response = await fetch(`${BRAIN_URL}/api/brain/graph/radius`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: changedFiles }),
      signal: controller.signal,
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();

    // stale=true 视同不可达，返回 null
    if (data && data.freshness && data.freshness.stale === true) {
      return null;
    }

    return data;
  } catch (_err) {
    // 网络错误、超时（AbortError）、JSON 解析错误等，一律返回 null
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}
