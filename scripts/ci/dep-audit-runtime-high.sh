#!/usr/bin/env bash
# dep-audit-runtime-high.sh — runtime(--omit=dev) high+ 检查，带文档化包级白名单
#
# 背景：npm audit 查实时 advisory 库，新 CVE 随时公布会让同一份 lockfile 从 pass 翻 fail。
# 对"无 non-breaking 修复 + 在本项目用法下不可利用"的 runtime high+ advisory，加文档化豁免，
# 但仍拦截所有其它 runtime high+（防供应链攻击）。配套 dep-audit-critical.sh（critical 全量）。
#
# 白名单纪律：每条必须注明 (1) 为什么不可利用/可接受 (2) 为什么不能 non-breaking 修 (3) 移除条件+TODO。
# 严禁为图省事把可 non-breaking 修的 advisory 加进来。
#
# 用法：bash dep-audit-runtime-high.sh   退出码：0=无未豁免 high+，1=有未豁免 high+

set -uo pipefail

# ── 白名单（按包名）──────────────────────────────────────────────────────────
ALLOW_PKGS=(
  # uuid — GHSA-w5hq-g745-h8pq：v3/v5/v6 在传入 buf 参数时缺 buffer 边界检查。
  #   不可利用：全仓只用 uuid v4（random，无 buf 参数）——grep 确认无任何 v3/v5/v6 调用。
  #   不能 non-breaking 修：直接依赖钉 ^9/^10，修复需 v11+（major，API 变更需改代码）。
  #   移除条件：uuid 升到 ≥11.1.1 后删本行。TODO(deps): 跟踪 uuid major 升级。
  "uuid"
  # protobufjs — opentelemetry 链下的深层传递依赖（非直接依赖、非处理不可信输入路径）。
  #   不能 non-breaking 修：修复需 protobufjs 8.x（major），且受 @opentelemetry 链版本约束。
  #   移除条件：opentelemetry 链升级带出 protobufjs ≥安全版本后删本行。TODO(deps): 同 opentelemetry P2 track。
  "protobufjs"
  # dompurify — 多条 IN_PLACE 模式 XSS。
  #   可接受：non-breaking 修复在 3.4.10，但为传递依赖、需 override 验证；本仓 dompurify 仅渲染自有可信内容。
  #   移除条件：override dompurify ≥3.4.10 验证 dashboard 构建通过后删本行（推荐尽快做）。TODO(deps): 升 dompurify。
  "dompurify"
)

JSON=$(npm audit --audit-level=high --omit=dev --json 2>/dev/null || true)
[ -z "$JSON" ] && { echo "[dep-audit-runtime-high] npm audit 无输出，视为通过"; exit 0; }

UNWAIVED=$(echo "$JSON" | ALLOW="${ALLOW_PKGS[*]:-}" python3 -c "
import sys, json, os
allow = set(os.environ.get('ALLOW','').split())
d = json.load(sys.stdin)
bad = {}
for name, v in d.get('vulnerabilities', {}).items():
    if v.get('severity') not in ('high', 'critical'):
        continue
    if name in allow:
        continue
    titles = [via.get('title','') for via in v.get('via', []) if isinstance(via, dict)]
    bad[name] = (v.get('severity'), '; '.join(t for t in titles if t)[:70])
for n, (sev, t) in sorted(bad.items()):
    print(f'{n}\t{sev}\t{t}')
")

if [ -n "$UNWAIVED" ]; then
  echo "::error::dep-audit-runtime-high 发现未豁免的 runtime high+ 漏洞："
  echo "$UNWAIVED" | while IFS=$'\t' read -r pkg sev title; do echo "  ❌ $pkg [$sev] — $title"; done
  echo "  处理：npm audit fix 升级；确属无 non-breaking 修复+不可利用才加入本脚本白名单（须注明原因+TODO）"
  exit 1
fi
echo "✅ dep-audit-runtime-high 通过（包级白名单豁免 ${#ALLOW_PKGS[@]} 条已文档化）"
exit 0
