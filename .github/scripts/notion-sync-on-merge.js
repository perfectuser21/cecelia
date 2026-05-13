/**
 * PR merge → Notion sync (thin version)
 *
 * PR body trailer 格式：
 *   Notion-Sprint: <sprint-page-id>
 *   Notion-Components: <component-page-id1>, <component-page-id2>
 *
 * 操作：
 *   Sprint: Status → done
 *   Sprint: PRs → append PR_URL
 *   Component: Last Changed Sprint → sprint 名称
 *
 * 无 trailer / 找不到页面 → 静默 exit 0
 */

const NOTION_API_BASE = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

export function parseTrailers(body) {
  if (!body) return {};
  const result = {};
  for (const line of body.split('\n')) {
    const m = line.match(/^(Notion-[^\s:]+)\s*:\s*(.+)$/);
    if (m) result[m[1].trim()] = m[2].trim();
  }
  return result;
}

async function notionReq(token, path, method = 'GET', body = null) {
  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(30000),
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(`${NOTION_API_BASE}${path}`, opts);
  if (res.status === 404) return null;

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Notion ${method} ${path} → ${res.status}: ${data.message}`);
  }
  return data;
}

function richTextValue(prop) {
  const arr = prop?.rich_text;
  if (!Array.isArray(arr)) return '';
  return arr.map(t => t.plain_text || '').join('');
}

function titleValue(prop) {
  const arr = prop?.title;
  if (!Array.isArray(arr)) return '';
  return arr.map(t => t.plain_text || '').join('');
}

async function patchSprint(token, sprintId, prUrl) {
  const page = await notionReq(token, `/pages/${sprintId}`);
  if (!page) {
    console.log(`Sprint ${sprintId} not found, skipping`);
    return null;
  }

  const props = page.properties || {};
  const updates = {};

  // Sprint 名称（用于回写 Component）
  const sprintName =
    titleValue(props['Name']) ||
    titleValue(props['名称']) ||
    titleValue(props['Sprint']) ||
    sprintId;

  // Status → done
  const statusProp = props['Status'];
  if (statusProp?.type === 'select') {
    updates['Status'] = { select: { name: 'done' } };
  } else if (statusProp?.type === 'status') {
    updates['Status'] = { status: { name: 'done' } };
  }

  // PRs → append
  const prsProp = props['PRs'];
  if (prsProp) {
    const existing = richTextValue(prsProp);
    const newVal = existing ? `${existing}\n${prUrl}` : prUrl;
    updates['PRs'] = {
      rich_text: [{ type: 'text', text: { content: newVal } }],
    };
  }

  if (Object.keys(updates).length > 0) {
    await notionReq(token, `/pages/${sprintId}`, 'PATCH', { properties: updates });
    console.log(`Sprint ${sprintId} updated (Status=done, PRs appended)`);
  }

  return sprintName;
}

async function patchComponents(token, componentIds, sprintName) {
  for (const raw of componentIds) {
    const cid = raw.trim();
    if (!cid) continue;

    const page = await notionReq(token, `/pages/${cid}`);
    if (!page) {
      console.log(`Component ${cid} not found, skipping`);
      continue;
    }

    const props = page.properties || {};
    const updates = {};

    if ('Last Changed Sprint' in props) {
      updates['Last Changed Sprint'] = {
        rich_text: [{ type: 'text', text: { content: sprintName || '' } }],
      };
    }

    if (Object.keys(updates).length > 0) {
      await notionReq(token, `/pages/${cid}`, 'PATCH', { properties: updates });
      console.log(`Component ${cid} updated (Last Changed Sprint=${sprintName})`);
    }
  }
}

async function main() {
  const token = process.env.NOTION_API_KEY;
  if (!token) {
    console.log('NOTION_API_KEY not configured, skipping');
    process.exit(0);
  }

  const prBody = process.env.PR_BODY || '';
  const prUrl = process.env.PR_URL || '';

  const trailers = parseTrailers(prBody);
  const sprintId = trailers['Notion-Sprint'];
  const componentsRaw = trailers['Notion-Components'];

  if (!sprintId && !componentsRaw) {
    console.log('No Notion trailers found, skipping');
    process.exit(0);
  }

  let sprintName = '';

  if (sprintId) {
    sprintName = (await patchSprint(token, sprintId, prUrl)) || '';
  }

  if (componentsRaw) {
    const ids = componentsRaw.split(',').map(s => s.trim()).filter(Boolean);
    await patchComponents(token, ids, sprintName);
  }

  console.log('Notion sync complete');
}

// 只在直接执行时运行（import 时不触发，避免测试被干扰）
import { fileURLToPath } from 'url';
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(err => {
    console.error('Notion sync error (non-blocking):', err.message);
    process.exit(0);
  });
}
