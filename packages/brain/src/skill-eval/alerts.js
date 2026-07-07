/**
 * alerts.js — Skill Eval 飞书告警
 */

// ─── 飞书告警 ────────────────────────────────────────────────────────
export async function sendFeishuAlert(type, data) {
  const webhookUrl = process.env.FEISHU_WEBHOOK_URL;
  if (!webhookUrl) return; // 没配置则静默跳过

  const messages = {
    eval_failed: `⚠️ Skill Eval 失败\n技能: ${data.skillName}\n状态: ${data.status}\ntask_id: ${data.taskId}`,
    eval_completed: `✅ Skill Eval 完成\n技能: ${data.skillName}\n耗时: ${data.durationMs}ms\n报告: ${data.reportUrl}`,
    queue_full: `🚫 Skill Eval 队列满\n当前队列: ${data.pendingCount}/${data.maxQueue}`,
    quota_blocked: `🔴 Skill Eval 额度预检失败\n原因: ${data.reason}`,
  };

  const text = messages[type] || `Skill Eval 通知 [${type}]: ${JSON.stringify(data)}`;

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msg_type: 'text', content: { text } }),
    });

    if (!response.ok) {
      console.error(`[alerts] feishu webhook failed: ${response.status}`);
    }
  } catch (err) {
    console.error('[alerts] feishu send error:', err.message);
  }
}
