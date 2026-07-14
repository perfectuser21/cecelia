#!/usr/bin/env bash
# Smoke: GET /api/brain/quality/ratchet 棘轮台账端点（刀4-T2）
# 断言：HTTP 200；available=true 时 registry ≥5 条且每项含 direction/source；
# available=false 仅在 ENOENT（容器镜像未带 scripts/ 目录的已知拓扑）时放行。
set -euo pipefail

BRAIN="${BRAIN_URL:-http://localhost:5221}"
URL="$BRAIN/api/brain/quality/ratchet"
OUT=/tmp/smoke-ratchet-registry.json

printf '%s\n' "▶️  smoke: ratchet-registry-smoke.sh"
printf '%s\n' "   target: $URL"

HTTP_CODE=$(curl -sS -o "$OUT" -w "%{http_code}" -m 8 "$URL")
if [ "$HTTP_CODE" != "200" ]; then
  printf '%s\n' "❌ HTTP $HTTP_CODE (expected 200)"
  cat "$OUT" 2>/dev/null || true
  exit 1
fi

node -e '
const d = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
if (d.available === true) {
  if (!Array.isArray(d.registry) || d.registry.length < 5) { console.error("❌ registry 非数组或 <5 条"); process.exit(1); }
  for (const e of d.registry) {
    if (!e.name || !["only_up","only_down"].includes(e.direction) || !e.source) {
      console.error("❌ 台账条目缺 name/direction/source:", JSON.stringify(e)); process.exit(1);
    }
  }
  console.log(`✅ ratchet 台账 ${d.registry.length} 条，方向/来源字段齐全`);
} else if (d.available === false && /ENOENT/.test(d.error || "")) {
  console.log("✅ available:false(ENOENT)——容器镜像未带 scripts/ 目录，属已知拓扑，端点降级正确");
} else {
  console.error("❌ 非预期响应:", JSON.stringify(d)); process.exit(1);
}
' "$OUT"

printf '%s\n' "✅ ratchet-registry smoke 通过"
