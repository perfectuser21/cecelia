#!/usr/bin/env bash
# knowledge-ruminate.sh — 知识反刍辅助脚本
# 用途：读取 Brain 知识库条目，输出摘要，供 Agent 消化时参考
#
# 用法:
#   bash knowledge-ruminate.sh [--limit 25] [--offset 0] [--format summary|list|json]
#
# 示例:
#   bash knowledge-ruminate.sh --limit 25 --offset 0 --format list

set -euo pipefail

BRAIN_URL="${BRAIN_API_URL:-http://localhost:5221}"
LIMIT=25
OFFSET=0
FORMAT=list

# 解析参数
while [[ $# -gt 0 ]]; do
    case "$1" in
        --limit)   LIMIT="$2"; shift 2 ;;
        --offset)  OFFSET="$2"; shift 2 ;;
        --format)  FORMAT="$2"; shift 2 ;;
        *) echo "未知参数: $1" >&2; exit 1 ;;
    esac
done

# 安全获取知识条目（Brain 离线时返回空）
fetch_knowledge_safe() {
    local url="${BRAIN_URL}/api/brain/knowledge?limit=${LIMIT}&offset=${OFFSET}"
    local result
    result=$(curl -s --connect-timeout 5 --max-time 10 "$url" 2>/dev/null) || result="[]"
    # 验证是 JSON 数组
    echo "$result" | node -e "
const raw = require('fs').readFileSync('/dev/stdin','utf8');
try { const d = JSON.parse(raw); if (!Array.isArray(d)) throw new Error('not array'); process.stdout.write(raw); }
catch(e) { process.stdout.write('[]'); }
" 2>/dev/null || echo "[]"
}

DATA=$(fetch_knowledge_safe)
COUNT=$(echo "$DATA" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));console.log(d.length)" 2>/dev/null || echo "0")

if [[ "$COUNT" == "0" ]]; then
    echo "⚠️  未获取到知识条目（Brain 可能离线或无数据）"
    exit 0
fi

echo "📚 知识库条目: ${COUNT} 条（offset=${OFFSET}, limit=${LIMIT}）"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

case "$FORMAT" in
    json)
        echo "$DATA"
        ;;
    list)
        echo "$DATA" | node -e "
const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
d.forEach((item, i) => {
    const name = item.name || '(无名称)';
    const type = item.type || 'unknown';
    console.log((i+1) + '. [' + type + '] ' + name.slice(0, 100));
});
" 2>/dev/null
        ;;
    summary)
        echo "$DATA" | node -e "
const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
const byType = {};
d.forEach(item => {
    const t = item.type || 'unknown';
    byType[t] = (byType[t] || 0) + 1;
});
console.log('类型分布:');
Object.entries(byType).forEach(([t, n]) => console.log('  ' + t + ': ' + n + ' 条'));
const byStatus = {};
d.forEach(item => {
    const s = item.status || 'unknown';
    byStatus[s] = (byStatus[s] || 0) + 1;
});
console.log('状态分布:');
Object.entries(byStatus).forEach(([s, n]) => console.log('  ' + s + ': ' + n + ' 条'));
" 2>/dev/null
        ;;
    *)
        echo "未知 format: ${FORMAT}（支持 summary|list|json）" >&2
        exit 1
        ;;
esac

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ 完成。可用 --offset 调整批次（每批 ${LIMIT} 条）。"
