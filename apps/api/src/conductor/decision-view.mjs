/* eslint-disable no-undef */ // Node ESM 全局(process/fetch/console/AbortSignal)
// 待决策视图 + 人审裁决 — 主理人每天扫的那一个面板,也是「懂代码战略对话桥」。
// SEAM(Agent C 升级): publishContract 把 Contract 写进 Notion「待决策」视图;
//   readVerdict 轮询该视图读人审裁决(approve/redirect+steer)。
//   env-gated: NOTION_API_KEY + AUTOPILOT_DECISION_DB_ID 都给了 → 走 Notion;
//   缺任一 → 降级回本地文件队列(骨架),打日志不崩,绝不写死 key。
//   demo 模式仍走剧本数组,不动(--demo 稳过)。
//
// ⚠️ 接缝断言: Notion「待决策」DB 的 schema(字段名)由主理人定库后真验校准。
//   本文件按 C 推荐字段(Task/状态/Lane/Contract/风险/裁决)写 properties;
//   字段名要等真库 ID + schema 给定后第二刀对齐(见设计 doc B 道分期)。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const QUEUE_DIR = path.join(__dirname, '.decisions-queue');

const NOTION_API_BASE = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

// env 齐(key + 库 id)才接 Notion;否则降级本地。
export function notionEnabled() {
  return Boolean(process.env.NOTION_API_KEY && process.env.AUTOPILOT_DECISION_DB_ID);
}

async function notionReq(pathPart, method, body) {
  const resp = await fetch(`${NOTION_API_BASE}${pathPart}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.NOTION_API_KEY}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(8000),
  });
  if (!resp.ok) throw new Error(`Notion ${method} ${pathPart} → ${resp.status}`);
  return resp.json();
}

// Notion rich_text/title 辅助
const rt = (text) => [{ type: 'text', text: { content: String(text ?? '').slice(0, 1900) } }];

// 把 task + contract 渲染成 Notion 待决策页 properties(字段名待真库校准)。
function toProperties(task, contract) {
  const contractFull = [
    `做法: ${contract.approach ?? ''}`,
    contract.files ? `文件: ${[].concat(contract.files).join(', ')}` : '',
    contract.tests ? `测试: ${[].concat(contract.tests).join('; ')}` : '',
    contract.dod ? `DoD: ${[].concat(contract.dod).join('; ')}` : '',
  ].filter(Boolean).join('\n');
  return {
    Task: { title: rt(task.title || task.id) },
    状态: { select: { name: '待审' } },
    Lane: { select: { name: 'A' } },
    Contract: { rich_text: rt(contractFull) },
    风险: { rich_text: rt(contract.risk ?? '') },
  };
}

// 写「待决策」: env 齐 → 创 Notion 页(返回 page id); 否则降级本地文件(返回文件路径)。
export async function publishContract(task, contract) {
  if (notionEnabled()) {
    const page = await notionReq('/pages', 'POST', {
      parent: { database_id: process.env.AUTOPILOT_DECISION_DB_ID },
      properties: toProperties(task, contract),
    });
    console.log(`[decision-view] 已写 Notion 待决策页: ${page.id}`);
    return page.id;
  }
  fs.mkdirSync(QUEUE_DIR, { recursive: true });
  const f = path.join(QUEUE_DIR, `${task.id}.contract.json`);
  fs.writeFileSync(f, JSON.stringify({ task, contract }, null, 2));
  console.log(`[decision-view] Notion 未配置, 降级本地待决策: ${f}`);
  return f;
}

// 从 Notion 查这条 task 的待决策页, 读「状态」select 翻成裁决; 待审/无页 → null。
async function readVerdictFromNotion(taskId) {
  const data = await notionReq(
    `/databases/${process.env.AUTOPILOT_DECISION_DB_ID}/query`,
    'POST',
    { filter: { property: 'Task', title: { contains: taskId } }, page_size: 1 },
  );
  const page = (data.results || [])[0];
  if (!page) return null; // 还没在待决策视图建页/被删
  const status = page.properties?.['状态']?.select?.name;
  if (!status || status === '待审') return null; // pause-in-place
  if (status === 'approve') return { action: 'approve' };
  if (status === 'redirect') {
    const steer = (page.properties?.['裁决']?.rich_text || [])
      .map((t) => t.plain_text ?? t.text?.content ?? '').join('').trim();
    return { action: 'redirect', steer };
  }
  return null; // 未知状态当未审
}

// verdict 来源 seam。demo: 剧本数组; once: env 齐查 Notion,否则读本地待决策文件。
// 任一来源出错 → 降级 null(pause-in-place,不崩)。
export async function readVerdict({ mode, script, round, taskId }) {
  if (mode === 'demo') return script[round - 1];

  if (notionEnabled()) {
    try {
      return await readVerdictFromNotion(taskId);
    } catch (err) {
      console.error(`[decision-view] 读 Notion 裁决失败, 降级 null(暂停在原地): ${err.message}`);
      return null;
    }
  }

  const vf = path.join(QUEUE_DIR, `${taskId}.verdict`);
  if (!fs.existsSync(vf)) return null; // 还没审 → 暂停在原地(pause-in-place)
  return JSON.parse(fs.readFileSync(vf, 'utf8'));
}
