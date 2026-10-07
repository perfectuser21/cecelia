#!/usr/bin/env bash
# Smoke: backbone-page-body — Activity 页面正文的机器区块（目录第二轮：前提/不变量/NFR/失败语义/读回/判定点/对抗/保质期/用料 9 段不占列，写进正文）
# 验证（不连真库、不发网络；假 notionReq + 假 pool）：
#   1. 正文是一个带「机器维护」标记的折叠块，9 段小标题，没写的写「（未写）」；只删自己的旧折叠块，人写的段落不动；指纹不变第二轮零 Notion 调用
#   2. 接线：唯一写正文的是目录投影（directory-projector 调 syncActivityBodies），契约 job 不再写正文；迁移 483（指纹列）+ 回滚存在；smoke 登记 allowlist
set -euo pipefail
cd "$(dirname "$0")/../.."

echo "[backbone-page-body-smoke] 1. 正文机器区块（折叠块 9 段 + 只换自己 + 指纹不变零调用）"
node --input-type=module -e "
import { buildActivityBodyBlock, syncActivityBodies, BODY_MARKER } from './src/projection/activity-body.js';
const r = { id: 'a1', page_id: 'p1', preconditions: ['设备在线'], nfr: { timeout_s: 600 }, shelf_life_days: 7, uses: [] };
const b = buildActivityBodyBlock(r, []);
const plain = x => (x[x.type].rich_text || []).map(t => t.text.content).join('');
if (b.type !== 'toggle' || !plain(b).startsWith(BODY_MARKER)) { console.error('FAIL 正文应为带机器维护标记的折叠块'); process.exit(1); }
const heads = b.toggle.children.filter(k => k.type === 'heading_3').map(plain).join(',');
if (heads !== '前提,不变量,NFR,失败语义,读回,判定点,对抗,保质期,用料') { console.error('FAIL 9 段小标题不对', heads); process.exit(1); }
if (!JSON.stringify(b).includes('（未写）')) { console.error('FAIL 没写的段应写（未写）'); process.exit(1); }
const deleted = []; let calls = 0;
const notionReq = async (_t, p, m) => { calls++; if (m === 'DELETE') deleted.push(p);
  return m === 'GET' ? { results: [{ id: 'human', type: 'paragraph', paragraph: { rich_text: [{ plain_text: '人写的' }] } },
    { id: 'old', type: 'toggle', toggle: { rich_text: [{ plain_text: BODY_MARKER + '：旧' }] } }], has_more: false } : {}; };
let digest = null;
const pool = { async query(t, p) { if (/FROM activities a/.test(t)) return { rows: [{ ...r, notion_body_digest: digest }] }; if (/notion_body_digest =/.test(t)) digest = p[1]; return { rows: [] }; } };
await syncActivityBodies(pool, { token: 'tok', notionReq });
if (deleted.join() !== '/blocks/old') { console.error('FAIL 只应删自己的旧折叠块', deleted); process.exit(1); }
const first = calls;
await syncActivityBodies(pool, { token: 'tok', notionReq });
if (first === 0 || calls !== first) { console.error('FAIL 指纹不变应零调用', first, calls); process.exit(1); }
console.log('折叠块 9 段 / 只换自己 / 指纹不变零调用 ✓');
"

echo "[backbone-page-body-smoke] 2. 接线"
grep -q "syncActivityBodies" src/projection/directory-projector.js || { echo "FAIL 目录投影未接正文同步"; exit 1; }
! grep -q "syncBackboneBodies" src/activity-contract-sync.js || { echo "FAIL 契约 job 仍在写正文（两处写正文会打架）"; exit 1; }
test -f migrations/483_backbone_body_digest.sql || { echo "FAIL 缺迁移 483"; exit 1; }
test -f migrations/rollback/483_backbone_body_digest.down.sql || { echo "FAIL 缺回滚 483"; exit 1; }
grep -q "backbone-page-body-smoke.sh" ../quality/smoke-allowlist.txt || { echo "FAIL smoke 未登记 allowlist"; exit 1; }
echo "[backbone-page-body-smoke] PASS"
