#!/usr/bin/env bash
# 回归守卫：凭据同步把 ~/.credentials/*.env 写成垃圾（2026-09-07 现场发现）
#
# ── 事故 ──────────────────────────────────────────────────────────────
# sync-credentials.sh 里的字段过滤条件是 `f.type!=='CONCEALED'`，而 1Password
# 里**真正的凭据字段全都是 CONCEALED 类型**——于是它把所有真凭据排除掉，只留下
# `valid from` 和 `expires` 两个 DATE 字段。14 个凭据文件里 9 个变成这样：
#
#   $ cat ~/.credentials/tencent-cloud.env
#   valid from=0
#   expires=0
#
# `valid from=0` 带空格，`source` 时被当成命令 → `command not found: valid`。
# 而且很多条目的真凭据写在 notesPlain 里，sync_item 根本不读 notes。
#
# 症状特别难查：文件存在、chmod 600、看着一切正常，只有真去 source 才炸；
# 而多数调用点 `source ... 2>/dev/null || true`，于是变成静默失效。
#
# ── 这个测试守什么 ────────────────────────────────────────────────────
# 直接把 1Password 条目的真实 JSON 形状喂给提取器，断言：
#   ① CONCEALED 字段（真凭据）必须被收进来
#   ② 'valid from' / 'expires' 这类非法变量名必须被丢掉
#   ③ notesPlain 里的 KEY=VALUE 必须被解析出来
#   ④ 输出必须是 source 得动的合法 shell
#   ⑤ 带空格的 label（如 'ZenithJoy DB Host'）绝不能出现在输出里

set -uo pipefail

PASS=0
FAIL=0
ok() { echo "PASS: $1"; PASS=$((PASS + 1)); }
bad() { echo "FAIL: $1"; FAIL=$((FAIL + 1)); }

HERE="$(cd "$(dirname "$0")" && pwd)"
EXTRACT="$HERE/../../lib/op-item-to-env.js"

if [ ! -f "$EXTRACT" ]; then
  echo "FAIL: 找不到提取器 $EXTRACT"
  exit 1
fi

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# 真实形状：照抄 `op item get ... --format json` 的输出结构。
# CONCEALED + purpose=null 就是真凭据的样子（实测 Tencent / WeChat 小程序都是）。
cat > "$TMP/item.json" <<'JSON'
{
  "id": "fake",
  "title": "Fake Item",
  "fields": [
    { "id": "notesPlain", "label": "notesPlain", "type": "STRING", "purpose": "NOTES",
      "value": "# 注释行必须跳过\nFOO_FROM_NOTES=note-value-123\n\nBAR_WITH_EQUALS=a=b=c\n随便一句中文说明" },
    { "id": "f1", "label": "valid from", "type": "DATE", "value": "0" },
    { "id": "f2", "label": "expires", "type": "DATE", "value": "0" },
    { "id": "f3", "label": "API_TOKEN", "type": "CONCEALED", "value": "sk-real-secret" },
    { "id": "f4", "label": "PLAIN_HOST", "type": "STRING", "value": "example.com" },
    { "id": "f5", "label": "ZenithJoy DB Host", "type": "STRING", "value": "10.0.0.1" },
    { "id": "f6", "label": "EMPTY_ONE", "type": "CONCEALED", "value": "" },
    { "id": "f7", "label": "WITH_SPACES", "type": "CONCEALED", "value": "a b c" },
    { "id": "f8", "label": "WITH_QUOTE", "type": "CONCEALED", "value": "it's here" }
  ]
}
JSON

OUT="$TMP/out.env"
node "$EXTRACT" < "$TMP/item.json" > "$OUT" 2>"$TMP/err" || {
  echo "FAIL: 提取器执行失败：$(cat "$TMP/err")"
  exit 1
}

echo "--- 提取结果 ---"
cat "$OUT"
echo "----------------"

# ① 真凭据（CONCEALED）必须在——这是本次事故的根因
grep -q '^API_TOKEN=' "$OUT" \
  && ok "CONCEALED 字段被收进来了（真凭据就是这个类型）" \
  || bad "CONCEALED 字段被丢了 —— 这正是把 9 个凭据文件写成垃圾的那个 bug"

# ② 非法变量名必须被丢掉
grep -q 'valid from' "$OUT" \
  && bad "'valid from' 混进来了 —— source 时会报 command not found: valid" \
  || ok "'valid from' 被丢掉"
grep -q '^expires=' "$OUT" \
  && bad "'expires' 混进来了（不是凭据，是元数据）" \
  || ok "'expires' 被丢掉"

# ⑤ 带空格的 label 绝不能出现
grep -q 'ZenithJoy DB Host' "$OUT" \
  && bad "带空格的 label 混进来了 —— database.env 就是这么废掉的" \
  || ok "带空格的 label 被丢掉"

# ③ notes 里的 KEY=VALUE 要解析出来（多数条目的真凭据在这儿）
grep -q '^FOO_FROM_NOTES=' "$OUT" \
  && ok "notesPlain 里的 KEY=VALUE 被解析出来" \
  || bad "notesPlain 没被解析 —— Tencent/GitHub 等条目的凭据全在那里面"
grep -q '^BAR_WITH_EQUALS=' "$OUT" \
  && ok "值里带 = 号的行没被截断" \
  || bad "值里带 = 号的行丢了或被截断"
grep -q '注释行必须跳过' "$OUT" \
  && bad "notes 里的 # 注释行混进来了" \
  || ok "notes 里的注释行被跳过"

# 空值字段不写
grep -q '^EMPTY_ONE=' "$OUT" \
  && bad "空值字段被写进去了" \
  || ok "空值字段不写"

# ④ 最要紧的一条：输出必须真能 source
#    这是唯一能证明「文件不是垃圾」的断言——前面几条都只是看文本
(
  set -e
  # shellcheck disable=SC1090
  . "$OUT"
  [ "$API_TOKEN" = "sk-real-secret" ] || { echo "API_TOKEN 值不对: $API_TOKEN"; exit 1; }
  [ "$WITH_SPACES" = "a b c" ] || { echo "带空格的值被拆了: $WITH_SPACES"; exit 1; }
  [ "$WITH_QUOTE" = "it's here" ] || { echo "带单引号的值坏了: $WITH_QUOTE"; exit 1; }
  [ "$BAR_WITH_EQUALS" = "a=b=c" ] || { echo "带等号的值坏了: $BAR_WITH_EQUALS"; exit 1; }
) >"$TMP/src.log" 2>&1 \
  && ok "输出能被 source，且带空格/引号/等号的值都完好" \
  || bad "输出 source 不动或值被破坏：$(cat "$TMP/src.log")"

# 不含特殊字符的值保持裸写 —— 有两个现存消费者用 grep+cut 解析
# （skill-notion-sync-hook.sh、engine/skills/dev/scripts/status.js），
# 无条件加引号会把引号一起 cut 给它们
grep -qx 'PLAIN_HOST=example.com' "$OUT" \
  && ok "普通值保持裸写（grep+cut 的消费者不被打断）" \
  || bad "普通值被加了引号 —— 会打断 grep -m1 '^KEY=' | cut -d= -f2- 这类消费者"

echo ""
echo "结果: $PASS 通过 / $FAIL 失败"
[ "$FAIL" -eq 0 ]
