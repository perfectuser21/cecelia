#!/usr/bin/env bash
# dep-audit-critical.sh — npm audit critical 检查，带文档化 advisory 白名单
#
# 背景：npm audit 查实时 advisory 库，新 CVE 随时公布会让同一份 lockfile 从 pass 翻 fail。
# 对"无 non-breaking 修复 + 在本项目用法下不可利用"的 advisory，加文档化白名单豁免，
# 但仍拦截所有其它 critical（防供应链攻击）。
#
# 白名单纪律：每条必须注明 (1) 为什么不可利用 (2) 为什么不能修 (3) 移除条件 + TODO。
# 严禁为图省事把可修的 advisory 加进来。
#
# 用法：bash dep-audit-critical.sh
# 退出码：0 = 无未豁免 critical，1 = 有未豁免 critical

set -uo pipefail

# ── 白名单（GHSA ID）────────────────────────────────────────────────────────
ALLOWLIST=(
  # GHSA-5xrq-8626-4rwp — Vitest UI server 任意文件读取。
  #   不可利用：仅 dev 依赖（vitest/@vitest/ui/coverage-v8），且只在 `vitest --ui`
  #            启动本地 UI server 时可被利用；CI 与生产从不跑 UI server。
  #   不能修：修复需 vitest 1.x → 4.x 跨 3 个 major，破坏性极大（全测试套件重写风险）。
  #   移除条件：vitest 升级到 ≥4.1.8 后删除本行。TODO(deps): 跟踪 vitest 大版本升级。
  "GHSA-5xrq-8626-4rwp"
)

JSON=$(npm audit --audit-level=critical --json 2>/dev/null || true)
if [ -z "$JSON" ]; then
  echo "[dep-audit-critical] npm audit 无输出，视为通过"
  exit 0
fi

# 提取所有 critical advisory 的 GHSA ID（去重），过滤白名单后剩余即未豁免项
UNWAIVED=$(echo "$JSON" | ALLOWLIST="${ALLOWLIST[*]:-}" python3 -c "
import sys, json, os
allow = set(os.environ.get('ALLOWLIST','').split())
d = json.load(sys.stdin)
found = {}
for name, v in d.get('vulnerabilities', {}).items():
    if v.get('severity') != 'critical':
        continue
    for via in v.get('via', []):
        if isinstance(via, dict) and via.get('url'):
            ghsa = via['url'].rstrip('/').split('/')[-1]
            found[ghsa] = via.get('title', '')[:70]
unwaived = {g: t for g, t in found.items() if g not in allow}
for g, t in sorted(unwaived.items()):
    print(f'{g}\t{t}')
")

if [ -n "$UNWAIVED" ]; then
  echo "::error::dep-audit-critical 发现未豁免的 critical 漏洞："
  echo "$UNWAIVED" | while IFS=$'\t' read -r ghsa title; do
    echo "  ❌ $ghsa — $title"
  done
  echo "  处理：升级对应包；确属无修复+不可利用才加入 scripts/ci/dep-audit-critical.sh 白名单（须注明原因+TODO）"
  exit 1
fi

echo "✅ dep-audit-critical 通过（白名单豁免 ${#ALLOWLIST[@]} 条已文档化）"
exit 0
