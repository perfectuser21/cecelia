#!/usr/bin/env node
/**
 * qiumi-inflight-check.mjs — 切换前的在途清零检查（PR3 Task 6）。
 *
 * 问的是一件事：旧脚本（us-vps cron 的 notion-qiumi-delegate.py）手上还有没有没干完的活。
 * 判据 = 中文 GTD 表里「状态=进行中 ∧ OpenClaw任务号 非空」，且任务号不是 Brain 侧写的两种前缀：
 *   brain:   Brain 入账回执（PR2 ingestQiumiPage 写的）
 *   en:      英文表侧的对照号
 * 剩下的才是旧脚本自己认领的行——它们没跑完就切，会变成两边都以为对方在管的孤儿。
 *
 * `relay-` 不在豁免里，是故意的：它是旧脚本自己写、自己收的手机链前缀
 * （notion-qiumi-delegate LIVE:243 写号、482-484 回收），带这个号的行正是旧脚本手上没干完的活。
 * 把它当成 Brain 侧前缀滤掉，就会把「旧脚本还在跑」读成「已经清零」，然后切换照常往下走。
 *
 * 退出码：0 = 已清零可以切；2 = 还有在途（stdout 给出 ids）；1 = 环境/接口问题（别当成清零）。
 * 只读 Notion，不写一个字段。
 */
const DB = process.env.NOTION_GTD_DB_ID || 'c69c40c2-ba63-8271-badf-01c5410d8929';
const TOKEN = process.env.NOTION_TOKEN;
const BRAIN_SIDE_PREFIX = /^(brain:|en:)/;

if (!TOKEN) {
  console.error('NOTION_TOKEN required（取法见 docs/runbooks/qiumi-cutover.md）');
  process.exit(1);
}

const plain = (rich) => (rich ?? []).map((x) => x.plain_text ?? x.text?.content ?? '').join('');

async function queryAll() {
  const out = [];
  let cursor;
  // 分页到底再判定：只看第一页会在积压 >100 条时把「还有在途」读成「已清零」。
  do {
    const res = await fetch(`https://api.notion.com/v1/databases/${DB}/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        page_size: 100,
        start_cursor: cursor,
        filter: {
          and: [
            { property: '状态', status: { equals: '进行中' } },
            { property: 'OpenClaw任务号', rich_text: { is_not_empty: true } },
          ],
        },
      }),
    });
    if (!res.ok) throw new Error(`notion_http_${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json = await res.json();
    out.push(...(json.results ?? []));
    cursor = json.has_more ? json.next_cursor : undefined;
  } while (cursor);
  return out;
}

try {
  const pages = await queryAll();
  const ids = pages
    .filter((p) => !BRAIN_SIDE_PREFIX.test(plain(p.properties?.['OpenClaw任务号']?.rich_text)))
    .map((p) => p.id);
  console.log(JSON.stringify({ inflight: ids.length, ids }));
  process.exit(ids.length > 0 ? 2 : 0);
} catch (err) {
  // 查不到 ≠ 清零：接口挂了也退 1，让切换脚本停住而不是当成可以切。
  console.error(`inflight_check_failed: ${err.message}`);
  process.exit(1);
}
