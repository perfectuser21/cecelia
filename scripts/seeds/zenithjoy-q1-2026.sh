#!/usr/bin/env bash
# zenithjoy-q1-2026.sh
# 创建 ZenithJoy 2026 Q1 OKR 种子数据（幂等版本）
# 用途：解除 zenithjoy 部门派发冻结（原因：OKR=0）
# 幂等保护：执行前先检查同名 Objective 是否已存在，存在则跳过创建
#
# 已创建记录（2026-03-13）：
#   Objective ID: 33a45167-f12e-4972-a33a-9553626363c1
#   KR1 ID: d947e4c7-815e-454c-a8fb-0aa79d8024fb
#   KR2 ID: 3e3f713f-8ecb-429d-abc1-8018d308c7b5
#   KR3 ID: fedab43c-a8b8-428c-bcc1-6aad6e6210fc

set -e

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
OKR_TITLE="ZenithJoy 2026 Q1 - 多平台内容创作自动化"

echo "🔍 检查 ZenithJoy Q1 OKR 是否已存在..."

# 幂等检查：从 Brain 查询现有 goals，匹配标题
EXISTING_OKR=$(curl -s "$BRAIN_URL/api/brain/goals" | \
  python3 -c "
import sys, json
goals = json.load(sys.stdin)
for g in goals:
    if g.get('title') == '$OKR_TITLE':
        print(g['id'])
        break
" 2>/dev/null || echo "")

if [ -n "$EXISTING_OKR" ]; then
  echo "✅ Objective 已存在，跳过创建（ID: ${EXISTING_OKR}）"
  echo "   派发冻结已解除，zenithjoy 任务将在下次 tick 中继续派发。"
  exit 0
fi

echo "🎯 未找到现有 OKR，开始创建 ZenithJoy 2026 Q1 OKR..."

# Step 1: 创建 Objective
OKR_RESP=$(curl -s -X POST "$BRAIN_URL/api/brain/action/create-goal" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "ZenithJoy 2026 Q1 - 多平台内容创作自动化",
    "description": "2026 Q1 目标：将 zenithjoy 多平台内容发布、数据采集、内容生成全面自动化，实现 24/7 无人值守运营。",
    "priority": "P0",
    "type": "area_okr",
    "target_date": "2026-03-31"
  }')

OKR_ID=$(echo "$OKR_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['goal']['id'])")
echo "✅ Objective: $OKR_ID"

# Step 2: KR1 - 发布自动化
KR1_RESP=$(curl -s -X POST "$BRAIN_URL/api/brain/action/create-goal" \
  -H "Content-Type: application/json" \
  -d "{
    \"title\": \"KR1: 发布自动化 — 8平台发布率从30%提升至100%\",
    \"description\": \"zenithjoy 内容自动发布覆盖抖音、快手、小红书、微博、知乎、微信公众号、今日头条、视频号8个平台，当前30% → 目标100%。\",
    \"priority\": \"P0\",
    \"type\": \"area_okr\",
    \"parent_id\": \"$OKR_ID\",
    \"target_date\": \"2026-03-31\"
  }")
KR1_ID=$(echo "$KR1_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['goal']['id'])")
echo "✅ KR1 发布自动化: $KR1_ID"

# Step 3: KR2 - 数据采集
KR2_RESP=$(curl -s -X POST "$BRAIN_URL/api/brain/action/create-goal" \
  -H "Content-Type: application/json" \
  -d "{
    \"title\": \"KR2: 数据采集 — 8平台日常数据采集从0%提升至100%\",
    \"description\": \"zenithjoy 平台数据（播放/点赞/涨粉）每日自动采集入库，当前0% → 目标100%，覆盖全部8个平台。\",
    \"priority\": \"P1\",
    \"type\": \"area_okr\",
    \"parent_id\": \"$OKR_ID\",
    \"target_date\": \"2026-03-31\"
  }")
KR2_ID=$(echo "$KR2_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['goal']['id'])")
echo "✅ KR2 数据采集: $KR2_ID"

# Step 4: KR3 - 内容生成
KR3_RESP=$(curl -s -X POST "$BRAIN_URL/api/brain/action/create-goal" \
  -H "Content-Type: application/json" \
  -d "{
    \"title\": \"KR3: 内容生成 — AI内容生产自动化从20%提升至100%\",
    \"description\": \"zenithjoy 内容选题、文案生成、素材组装全流程 AI 自动化，当前20% → 目标100%，实现无人工干预每日发布。\",
    \"priority\": \"P1\",
    \"type\": \"area_okr\",
    \"parent_id\": \"$OKR_ID\",
    \"target_date\": \"2026-03-31\"
  }")
KR3_ID=$(echo "$KR3_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['goal']['id'])")
echo "✅ KR3 内容生成: $KR3_ID"

echo ""
echo "🎉 ZenithJoy Q1 OKR 创建完成！"
echo "   Planner 将在下次 tick 中感知到 KRs，自动恢复 zenithjoy 任务派发。"
