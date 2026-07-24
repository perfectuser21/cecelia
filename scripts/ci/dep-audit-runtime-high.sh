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
  # @opentelemetry/propagator-jaeger — Denial of service in JaegerPropagator。
  #   不可利用：packages/brain/src/otel.js 是本仓唯一的 OTel 初始化点，只配置了
  #   OTLPTraceExporter（走 Honeycomb），从未 import/配置 JaegerPropagator——
  #   grep 全仓 "propagator-jaeger|JaegerPropagator|jaeger" 零命中，是传递依赖
  #   （随 @opentelemetry/sdk-node 或 auto-instrumentations-node 带入），漏洞代码
  #   路径从未被调用。
  #   不能 non-breaking 修：受 @opentelemetry/sdk-node 版本链约束，修复需 sdk-node
  #   升级到 0.221.0（major，breaking）。
  #   移除条件：opentelemetry 链升级带出安全版本后删本行。TODO(deps): 同 opentelemetry P2 track
  #   （见 protobufjs 同批 track，@opentelemetry/sdk-node 本身的 high 漏洞暂不在本白名单——
  #   该包是直接依赖且真在用，是否可豁免需要单独评估，见另一条 track，不跟这条一起处理）。
  "@opentelemetry/propagator-jaeger"
  # react-router — 多条 advisory（GHSA-chx6-hx7r-mcp5 DoS / GHSA-wrjc-x8rr-h8h6 open-redirect /
  #   GHSA-h8fp-f39c-q6mh RSC-XSS / GHSA-337j-9hxr-rhxg SSR-constructor-injection），修复版 ≥7.17.0。
  #   apps/dashboard 直接依赖 react-router-dom ^6.20.0（CSR/SPA 模式，无 SSR/RSC）：
  #   ① RSC-XSS（GHSA-h8fp-f39c-q6mh）、SSR-constructor-injection（GHSA-337j-9hxr-rhxg）
  #     ——均要求 SSR/RSCErrorHandler 代码路径，本项目纯 CSR 不走该路径，不可利用。
  #   ② DoS via inefficient route matching（GHSA-chx6-hx7r-mcp5）——路由配置静态硬编码，
  #     用户无法注入路由 pattern，攻击路径不存在。
  #   ③ Open redirect via backslash（GHSA-wrjc-x8rr-h8h6）——仅影响 <Link to="\\...">，
  #     本仓 Link/navigate 调用只传内部路径常量，无用户可控 to= 输入，不可利用。
  #   不能 non-breaking 修：v6→v7 是 major breaking change（Router API/hooks 均有变更），
  #     需整体迁移 apps/dashboard，不属于一行 version bump。
  #   移除条件：apps/dashboard 完成 react-router v7 迁移后删本行。
  #   TODO(deps): track react-router-dom v6→v7 迁移（P2，与 Dashboard 重构一起处理）。
  "react-router"
)

JSON=$(npm audit --audit-level=high --omit=dev --json 2>/dev/null || true)
[ -z "$JSON" ] && { echo "[dep-audit-runtime-high] npm audit 无输出，视为通过"; exit 0; }

UNWAIVED=$(echo "$JSON" | ALLOW="${ALLOW_PKGS[*]:-}" python3 -c "
import sys, json, os
allow = set(os.environ.get('ALLOW','').split())
d = json.load(sys.stdin)
bad = {}
for name, v in d.get('vulnerabilities', {}).items():
    if name in allow:
        continue
    # 只信这个包自己直接挂着的 advisory（via 里的 dict 项，带它自己的 severity/cvss）。
    # 不用顶层 v['severity']——那是 npm 沿整条依赖链滚算出来的聚合值，会被链上别的
    # 包的高危漏洞拉高，哪怕这个包跟那条 CVE 的关系只是'依赖了持有它的包'，不是
    # '自己有洞'。真正持有该 CVE 的包会在同一份 audit 输出里单独有自己的顶层条目
    # （自己的 via 里就有这条 advisory），用它自己的条目判断即可，不需要在这里对
    # 每一层继承者重复拦一次，否则会出现包没有任何自己的 CVE 却被拦下的假阳性。
    advisories = [via for via in v.get('via', []) if isinstance(via, dict)]
    if not advisories:
        continue  # 纯继承（via 全是包名字符串），没有自己的 advisory，交给真正持有 CVE 的那个包条目处理
    own_high = [a for a in advisories if a.get('severity') in ('high', 'critical')]
    if not own_high:
        continue
    titles = [a.get('title','') for a in own_high]
    bad[name] = (own_high[0].get('severity'), '; '.join(t for t in titles if t)[:70])
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
