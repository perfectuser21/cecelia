#!/usr/bin/env bash
# Smoke: 凭据保鲜守卫
#
# 案卷（2026-09-16/17 一夜实证）：
#   · Tailscale API key 过期 18 天没人知道，直到 CI 红了才反查出来
#   · 1Password 备用 GitHub PAT：元数据什么都没写，实际早已 401
#   · 99 个凭据条目里只有 1 个写了到期日
# 结论：读元数据只能抓到"老实写了到期日"的那一个，必须靠活性探测拿真相。
#
# 本守卫盯的是"别把这套机制拆回去"，每条断言都对应一个实际踩过的坑。
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
cd "$ROOT_DIR"

MOD="packages/brain/src/credential-freshness.js"

echo "[credential-freshness-smoke] 1. 模块存在且导出齐全"
for fn in daysUntil classifyExpiry buildProbePlan summarizeProbeResults \
          shouldRotateAuthKey issueAuthKey buildManualActionNotice \
          runCredentialFreshness maybeRunCredentialFreshness; do
  if ! grep -q "export \(async \)\?function $fn" "$MOD"; then
    echo "FAIL: 缺少导出 $fn"
    exit 1
  fi
done
echo "OK: 九个导出齐全"

echo "[credential-freshness-smoke] 2. 探活覆盖今晚实际出事的三类凭据"
for name in tailscale_api github_pat feishu_app; do
  if ! grep -q "name: '$name'" "$MOD"; then
    echo "FAIL: 探活计划缺 $name —— 今晚这三类都出过事"
    exit 1
  fi
done
echo "OK: 三类凭据都在探"

echo "[credential-freshness-smoke] 3. scheduler 已注册（不注册等于没有守卫）"
if ! grep -q "credential-freshness" packages/brain/src/scheduler-jobs.js; then
  echo "FAIL: scheduler-jobs.js 未注册 —— 09-16 查实采样器就是因为没人注册而从未运行过"
  exit 1
fi
echo "OK: scheduler 已注册"

echo "[credential-freshness-smoke] 4. 真行为：没有到期信息必须判 unknown 而非 ok"
cd packages/brain
node --input-type=module -e "
import { classifyExpiry, daysUntil, shouldRotateAuthKey, summarizeProbeResults, buildManualActionNotice } from './src/credential-freshness.js';

// 4a 缺到期信息不能当成没问题 —— 今晚出事的 PAT 正是'没写到期日'那把
if (classifyExpiry(null) !== 'unknown') { console.error('FAIL: 无到期信息被判成了 ' + classifyExpiry(null)); process.exit(1); }
if (classifyExpiry(daysUntil(null)) === 'ok') { console.error('FAIL: 无到期信息被判 ok'); process.exit(1); }
console.log('OK: 无到期信息判 unknown');

// 4b 不知道到期日绝不能自动续 —— 否则每轮重发新 key 把旧 key 冲掉
if (shouldRotateAuthKey(null) !== false) { console.error('FAIL: 到期日未知却触发续期，会每轮换钥匙'); process.exit(1); }
console.log('OK: 到期日未知不续期');

// 4c 探测失败必须算失活，不能当通过
const s = summarizeProbeResults([{ name: 'x', ok: false, detail: 'ECONNRESET' }]);
if (s.status !== 'degraded') { console.error('FAIL: 探测出错被当成通过'); process.exit(1); }
console.log('OK: 探测出错算失活');

// 4d 人工提示要可照做，且说明 auth key 不用管
const n = buildManualActionNotice(5);
if (!n || !n.includes('Generate access token') || !n.includes('auth key 会自动续')) {
  console.error('FAIL: 人工提示不完整 —— 要给出可照做步骤并说明哪些不用管'); process.exit(1);
}
console.log('OK: 人工提示可照做');
"
cd "$ROOT_DIR"

echo "[credential-freshness-smoke] 5. 签发 auth key 必须带齐 CI 需要的能力"
for cap in reusable ephemeral preauthorized; do
  if ! grep -q "$cap: true" "$MOD"; then
    echo "FAIL: 签发的 auth key 缺 $cap —— CI 每次是全新 runner，缺一项就连不进来或堆僵尸节点"
    exit 1
  fi
done
echo "OK: 三项能力齐全"

echo "[credential-freshness-smoke] 6. tailnet 必须用 '-'，不能用占位值"
# 只查非注释行——注释里写明"这是占位值、别用"是提醒后人，代码里真用才是问题
if grep -vE '^\s*(\*|//|/\*)' "$MOD" | grep -q "xx@gmail.com"; then
  echo "FAIL: 用了 1Password 里的占位 tailnet 名，实测 API 报 tailnet not found"
  exit 1
fi
if ! grep -q "tailnet/-/keys" "$MOD"; then
  echo "FAIL: 未使用默认 tailnet '-'"
  exit 1
fi
echo "OK: tailnet 用默认值"

echo "[credential-freshness-smoke] 7. 单元测试跑通"
cd packages/brain && npx vitest run src/__tests__/credential-freshness.test.js --reporter=basic 2>&1 | tail -5

echo "[credential-freshness-smoke] ALL PASS"
