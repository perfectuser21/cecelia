/**
 * publisher.js — Skill Eval 报告发布器
 * 职责：SSH 发布到 HK / 索引页维护 / evals 表写入
 */

import pool from '../db.js';

// ─── SSH 配置（全来自 env）───────────────────────────────────────────
export function getPublishConfig() {
  return {
    host: process.env.HK_SSH_HOST || 'hk-vps',
    username: process.env.HK_SSH_USER || 'root',
    privateKeyPath: process.env.HK_SSH_KEY_PATH || `${process.env.HOME}/.ssh/id_rsa`,
    docsPath: process.env.HK_DOCS_PATH || '/data/docs/skill-evals',
  };
}

// ─── B07: 写 evals 表 ────────────────────────────────────────────────
export async function writeEvalsRow({ taskId, skillName, status, reportUrl, durationMs }) {
  await pool.query(
    `INSERT INTO evals (task_id, skill_name, status, report_url, duration_ms)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT DO NOTHING`,
    [taskId, skillName, status, reportUrl || null, durationMs || null]
  );
}

// ─── B08: SSH 发布报告 ────────────────────────────────────────────────
export async function publishReport({ taskId, skillName, reportDir }) {
  const config = getPublishConfig();
  const shortCode = taskId.slice(0, 8);
  const slug = skillName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const remoteDir = `${config.docsPath}/${shortCode}-${slug}`;

  let ssh;
  try {
    const { NodeSSH } = await import('node-ssh');
    ssh = new NodeSSH();

    await ssh.connect({
      host: config.host,
      username: config.username,
      privateKeyPath: config.privateKeyPath,
    });

    // 创建远端目录
    await ssh.execCommand(`mkdir -p "${remoteDir}"`);

    // 上传报告目录
    await ssh.putDirectory(reportDir, remoteDir, {
      recursive: true,
      concurrency: 5,
    });

    const reportUrl = `https://${config.host}/skill-evals/${shortCode}-${slug}/`;

    // 更新索引页
    await updateIndex(ssh, config.docsPath, { taskId, skillName, reportUrl, slug, shortCode });

    // 回写 report_url 到 tasks
    await pool.query(
      `UPDATE tasks SET result = jsonb_set(COALESCE(result, '{}'), '{report_url}', $1::jsonb) WHERE id = $2`,
      [JSON.stringify(reportUrl), taskId]
    );

    return reportUrl;
  } finally {
    if (ssh) ssh.dispose();
  }
}

// ─── B10: 更新索引页（最新50条）──────────────────────────────────────
export async function updateIndex(ssh, docsPath, { taskId, skillName, reportUrl, slug, shortCode }) {
  // 读取现有索引（如果存在）
  const readResult = await ssh.execCommand(`cat "${docsPath}/index.html" 2>/dev/null || echo ""`);
  const existing = readResult.stdout || '';

  // 解析现有条目
  const entryRegex = /<!-- entry: (.+?) -->/g;
  const entries = [];
  let match;
  while ((match = entryRegex.exec(existing)) !== null) {
    try {
      entries.push(JSON.parse(match[1]));
    } catch (_) {
      // ignore malformed entries
    }
  }

  // 添加新条目
  entries.unshift({
    taskId,
    skillName,
    reportUrl,
    slug,
    shortCode,
    createdAt: new Date().toISOString(),
  });

  // 保持最新50条
  const latest = entries.slice(0, 50);

  // 生成索引 HTML
  const html = generateIndexHtml(latest);

  // 写入远端
  const tmpFile = `/tmp/skill-evals-index-${Date.now()}.html`;
  await ssh.execCommand(`cat > "${tmpFile}" << 'HTMLEOF'\n${html}\nHTMLEOF`);
  await ssh.execCommand(`mv "${tmpFile}" "${docsPath}/index.html"`);
}

function generateIndexHtml(entries) {
  const rows = entries.map(e => `
    <!-- entry: ${JSON.stringify(e)} -->
    <tr>
      <td><a href="${e.reportUrl}">${e.skillName}</a></td>
      <td>${e.shortCode}</td>
      <td>${e.createdAt}</td>
    </tr>`).join('\n');

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Skill Evals Index</title></head>
<body>
<h1>Skill Evaluations</h1>
<table>
<thead><tr><th>Skill</th><th>ID</th><th>Date</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
</body>
</html>`;
}
