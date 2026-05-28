#!/usr/bin/env node
// status.js — 查询某 Area 下所有 Journey + Feature 状态
// 用法：node status.js --area "ZenithJoy" [--journey "客户首次成功路径"]
//      或 node status.js --list-areas

const fs = require('fs');

const args = {};
for (let i = 2; i < process.argv.length; i += 2) {
  if (process.argv[i].startsWith('--')) {
    const k = process.argv[i].replace(/^--/, '');
    args[k] = process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true;
  }
}

const env = {};
fs.readFileSync(process.env.HOME + '/.credentials/notion.env', 'utf8')
  .split('\n').forEach(l => { const m = l.match(/^([^=]+)=(.+)/); if (m) env[m[1]] = m[2]; });

const NOTION_JOURNEY_DB = '358c40c2-ba63-8148-bde7-e313d789931a';
const NOTION_FEATURE_DB = '358c40c2-ba63-81e3-96c5-d762b3d34dff';
const NOTION_AREAS_DB = 'e62c40c2-ba63-829b-87a9-8185d4a2e422';

async function notion(method, path, body) {
  const r = await fetch('https://api.notion.com/v1' + path, {
    method,
    headers: {'Authorization':'Bearer '+env.NOTION_API_KEY,'Notion-Version':'2022-06-28','Content-Type':'application/json'},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json();
  if (!r.ok) { console.error('Notion FAIL', r.status, JSON.stringify(data, null, 2)); process.exit(1); }
  return data;
}

(async () => {
  // 列出所有 Areas（--list-areas 模式）
  if (args['list-areas']) {
    const all = await notion('POST', `/databases/${NOTION_AREAS_DB}/query`, {page_size: 100});
    console.log('=== 所有 Areas ===');
    all.results.forEach(p => {
      const name = p.properties?.Name?.title?.[0]?.plain_text || '(no title)';
      console.log(' -', name.padEnd(35), p.id);
    });
    return;
  }

  if (!args.area) { console.error('需要 --area "Area名" 或 --list-areas'); process.exit(1); }

  // 找 Area
  const areaQ = await notion('POST', `/databases/${NOTION_AREAS_DB}/query`, {
    filter: {property: 'Name', title: {equals: args.area}}, page_size: 5,
  });
  if (!areaQ.results?.length) { console.error(`Area not found: ${args.area}`); process.exit(1); }
  const areaId = areaQ.results[0].id;

  // 查 Journey 列表
  const journeyQ = await notion('POST', `/databases/${NOTION_JOURNEY_DB}/query`, {
    filter: {property: 'Area', relation: {contains: areaId}},
    page_size: 30,
  });

  console.log(`=== ${args.area} ===`);
  if (!journeyQ.results.length) {
    console.log('  (no journeys yet — 用 init-journey.js 建第一条)');
    return;
  }

  for (const j of journeyQ.results) {
    const name = j.properties?.Name?.title?.[0]?.plain_text || '(no title)';
    const type = j.properties?.['Journey Type']?.select?.name || '?';
    const maturity = j.properties?.Maturity?.select?.name || '?';
    const status = j.properties?.Status?.select?.name || '?';

    console.log('');
    console.log(`[Journey] ${name}  (${maturity}, ${type}, ${status})`);

    // 查 Feature
    const featQ = await notion('POST', `/databases/${NOTION_FEATURE_DB}/query`, {
      filter: {property: 'Journey', relation: {contains: j.id}},
      page_size: 100,
    });

    const buckets = {thin: [], medium: [], thick: [], mature: []};
    featQ.results.forEach(f => {
      const fName = f.properties?.Name?.title?.[0]?.plain_text || '(no title)';
      const fThick = f.properties?.Thickness?.select?.name || 'thin';
      const fStatus = f.properties?.Status?.select?.name || 'planned';
      buckets[fThick]?.push(`[${fStatus}] ${fName}`);
    });

    const counts = `thin:${buckets.thin.length} | medium:${buckets.medium.length} | thick:${buckets.thick.length} | mature:${buckets.mature.length}`;
    console.log('  ' + counts);

    if (args.journey === name || (!args.journey && featQ.results.length <= 20)) {
      ['thin', 'medium', 'thick', 'mature'].forEach(t => {
        buckets[t].forEach(line => console.log(`  - [${t}] ${line.replace(/^\[\w+\] /, '')}`));
      });
    }
  }

  console.log('');
  console.log('提示：');
  console.log('  -- 升级 Feature thickness：node thicken.js --feature-id "..." --to "medium" --reason "..."');
  console.log('  -- 看具体 Journey 详情：加 --journey "Journey 名"');
})();
