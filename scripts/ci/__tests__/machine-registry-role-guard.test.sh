#!/usr/bin/env bash
# 守卫：machine-registry 必须恰好一台 primary，且 us-mac-m4 字面量不得再扩散。
#
# 为什么不是「零命中」：Task 9 把机器角色判据从裸字面量收敛进了
# machine-registry.js，但裁决保留了 7 行 B 类 per-machine 配置——这些行不是
# "判断逻辑"，是 Mac Studio 到货前唯一还认得机器名的少数几处配置表（worker URL
# 环境变量映射 / SSH 端口 / 健康检查地址）。把它们也逼成 machine-registry 抽象，
# 收益为负：配置表本来就该按机器名排列，抽象反而让人看不懂"这行配的是谁"。
#
# 所以本守卫改用「文件级白名单 + 每文件命中数棘轮」：
#   · 白名单之外的文件出现 'us-mac-m4' → 红（判断逻辑不许再长新的机器字面量）
#   · 白名单内文件的命中数超过下面登记的值 → 红（只许降不许升，弹回门槛防悄悄再长）
#   · 白名单内文件命中数变少（比如某行被删或改用 machine-registry 解析）→ 绿，
#     但登记值不会自动跟着降——需要有人把下面的数字也改小，让棘轮真正收紧。
#
# 这份白名单就是 Mac Studio 到货时的迁移清单：Mac Studio 上线顶替 us-mac-m4
# 成为 primary 那天，下面每一个白名单文件都要加行/改行（新机器的 URL、端口、
# 健康检查地址），到时候顺手把这份清单也维护一遍。
#
# 亲验报红方法（两种，任选其一即可复现）：
#   1) 临时把 machine-registry.js 里 xian-mac-m4 的 machineRole 改成 primary
#      （造出两台 primary）→ 断言一必红。
#   2) 临时在白名单外的文件（比如 harness-skill-relay.js 的判断逻辑里）新增一行
#      裸字面量 'us-mac-m4' → 断言二必红。
#   3) 临时把某个白名单文件里的命中数改多（复制一行 'us-mac-m4' 配置）而不改登记值
#      → 棘轮必红。
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
BRAIN_SRC="$REPO_ROOT/packages/brain/src"
FAIL=0

echo "== machine-registry 角色守卫 =="

# ── 断言一：恰好一台 primary ──────────────────────────────────
PRIMARY_OUT=$(node --input-type=module -e '
import { MACHINES } from "'"$BRAIN_SRC"'/machine-registry.js";
const p = MACHINES.filter((m) => m.machineRole === "primary");
console.log(p.length);
if (p.length !== 1) process.exit(1);
' 2>&1)
PRIMARY_STATUS=$?
if [ "$PRIMARY_STATUS" -eq 0 ]; then
  echo "  ✅ 恰好一台 primary（${PRIMARY_OUT}）"
else
  echo "  ❌ primary 数量不是 1：$PRIMARY_OUT"
  FAIL=1
fi

# ── 白名单 + 每文件命中数棘轮（Mac Studio 迁移清单，见文件头注释）────
# 格式：相对 packages/brain/src 的路径 => 登记的最大命中数
declare -A REGISTERED_HITS=(
  ["harness-skill-relay.js"]=1
  ["orchestrator/production-transport.js"]=2
  ["orchestrator/fleet-node/node-admission-client.js"]=1
  ["orchestrator/fleet-node/node-profile.js"]=3
)

ALL_HITS=$(grep -rn "'us-mac-m4'" "$BRAIN_SRC" --include='*.js' \
  | grep -v '/machine-registry\.js:' | grep -v '/__tests__/' | grep -v '\.test\.' || true)

# 按文件分组统计命中数
declare -A ACTUAL_HITS=()
if [ -n "$ALL_HITS" ]; then
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    fpath="${line%%:*}"
    rel="${fpath#"$BRAIN_SRC"/}"
    ACTUAL_HITS["$rel"]=$(( ${ACTUAL_HITS["$rel"]:-0} + 1 ))
  done <<< "$ALL_HITS"
fi

# 白名单外文件一律零容忍
for rel in "${!ACTUAL_HITS[@]}"; do
  if [ -z "${REGISTERED_HITS[$rel]+x}" ]; then
    echo "  ❌ 白名单外文件出现 'us-mac-m4' 字面量：${rel}（命中 ${ACTUAL_HITS[$rel]} 处）"
    echo "     判断逻辑不许再长新的机器字面量——要么走 machine-registry.js 解析，"
    echo "     要么把这行加进本脚本的 Mac Studio 迁移清单（需要有理由，不是默认选项）。"
    FAIL=1
  fi
done

# 白名单内逐文件核对棘轮
for rel in "${!REGISTERED_HITS[@]}"; do
  registered=${REGISTERED_HITS[$rel]}
  actual=${ACTUAL_HITS[$rel]:-0}
  if [ "$actual" -gt "$registered" ]; then
    echo "  ❌ 棘轮倒退：${rel} 命中数 ${actual} > 登记值 ${registered}（只许降不许升）"
    FAIL=1
  else
    echo "  ✅ ${rel} 命中数 ${actual}（登记 ${registered}）"
  fi
done

echo ""
if [ "$FAIL" -eq 0 ]; then
  echo "✅ machine-registry role guard OK"
  exit 0
else
  echo "❌ machine-registry role guard 失败"
  exit 1
fi
