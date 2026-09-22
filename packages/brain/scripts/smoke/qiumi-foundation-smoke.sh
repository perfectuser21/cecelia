#!/usr/bin/env bash
# packages/brain/scripts/smoke/qiumi-foundation-smoke.sh
# Smoke: 秋米任务路由 PR1 地基的真库验证（task 15f42776，决策 b8abd28c）
#   闸1 qiumi_task 能 INSERT（CHECK 白名单已扩）
#   闸2 tasks.tenant_id 列存在
#   闸3 去重索引谓词豁免 payload.dedup_by_notion_page='true'：同名两行都带此键都能 queued
#   闸4 对照组：同名两行不带该键（含只带 notion_page_id 不带专用键）仍精确撞 23505
#              unique_violation on idx_tasks_dedup_active（豁免没把去重整个打掉，
#              且证明 notion_page_id 本身不是豁免键——见 461 头注释 C1 教训）
#   闸5 注册表派生的 tick 黑名单与 device-job 地基一致（qiumi_task 不在黑名单，device_job 在）
#   闸6 tasks_task_type_check 存在且已验证（461 NOT VALID + 462 VALIDATE 两步都到位，convalidated=true）
# 只删自己插的行（固定 title 前缀），绝不动别人的行。
set -euo pipefail
pass() { printf 'PASS: %s\n' "$1"; }
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }

: "${DATABASE_URL:?DATABASE_URL is required and must target a test or scratch database}"
PSQL="$(command -v psql)"; NODE="$(command -v node)"
DB_NAME="$("$NODE" -e "const u=new URL(process.argv[1]); process.stdout.write(decodeURIComponent(u.pathname.slice(1)))" "$DATABASE_URL")"
[[ "$DB_NAME" =~ (_test|_scratch)$ ]] || fail "拒绝连接非测试库: ${DB_NAME:-<empty>}"
# host 守卫（Task 4 审查 Minor #4）：只准 localhost/127.0.0.1，或本机自己的 hostname
# （本机运行时——即 mmv 本机——用短名或 FQDN 都算；防止 DATABASE_URL 被误配成远程
# 生产 host 时，光凭库名后缀 _test/_scratch 判断不出连去了哪台机）。
DB_HOST="$("$NODE" -e "const u=new URL(process.argv[1]); process.stdout.write(u.hostname)" "$DATABASE_URL")"
[[ -n "$DB_HOST" ]] || fail "拒绝连接：DATABASE_URL 解析不出 host"
SELF_SHORT="$(hostname -s 2>/dev/null || true)"
SELF_FQDN="$(hostname -f 2>/dev/null || hostname 2>/dev/null || true)"
case "$DB_HOST" in
  localhost|127.0.0.1) ;;
  *) [[ -n "$SELF_SHORT" && "$DB_HOST" == "$SELF_SHORT" ]] || [[ -n "$SELF_FQDN" && "$DB_HOST" == "$SELF_FQDN" ]] \
       || fail "拒绝连接非本机数据库 host: ${DB_HOST}（只准 localhost/127.0.0.1/本机 hostname）" ;;
esac
q() { "$PSQL" "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "$1"; }

# 合并前 Minor②：闸4/闸4b 原先"随便什么失败都判绿"——INSERT 语句本身打错列名
# 之类的语法错误也会让 psql 非 0 退出，被当成"确实撞上去重索引"，假绿。改成精确
# 断言错误是 23505（unique_violation）且撞的是 idx_tasks_dedup_active 这个具体约束
# （`-v VERBOSITY=verbose` 让 psql 把 SQLSTATE 码打进 ERROR 行本身）。
# 返回码：0=精确撞在 23505/idx_tasks_dedup_active 上（去重确实生效）；
#         1=INSERT 居然成功了（去重失效）；2=撞到别的非预期错误（脚本本身有 bug）。
qfail23505() {
  local sql="$1" out
  if out="$("$PSQL" "$DATABASE_URL" -v VERBOSITY=verbose -v ON_ERROR_STOP=1 -c "$sql" 2>&1)"; then
    return 1
  fi
  if [[ "$out" == *'ERROR:  23505:'* && "$out" == *'"idx_tasks_dedup_active"'* ]]; then
    return 0
  fi
  printf '意外错误（不是预期的 23505 idx_tasks_dedup_active 撞库）：\n%s\n' "$out" >&2
  return 2
}

T="[smoke] qiumi-foundation $$"
cleanup() { "$PSQL" "$DATABASE_URL" -q -c "DELETE FROM tasks WHERE title LIKE '${T}%'" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup

# 闸1
q "INSERT INTO tasks (title, task_type, status, priority, payload) VALUES ('${T} g1', 'qiumi_task', 'queued', 'P2', '{\"headed_manual\":true}'::jsonb)" >/dev/null \
  || fail "闸1 qiumi_task INSERT 被 CHECK 拒（461 未应用）"
pass "闸1 qiumi_task 可入库"

# 闸2
[[ "$(q "SELECT count(*) FROM information_schema.columns WHERE table_name='tasks' AND column_name='tenant_id'")" == "1" ]] || fail "闸2 tasks.tenant_id 不存在"
pass "闸2 tenant_id 列存在"

# 闸3：同名 + 都带 dedup_by_notion_page='true' → 两条都能 queued
q "INSERT INTO tasks (title, task_type, status, priority, payload) VALUES ('${T} dup', 'qiumi_task', 'queued', 'P2', '{\"headed_manual\":true,\"dedup_by_notion_page\":\"true\",\"notion_page_id\":\"page-a\"}'::jsonb)" >/dev/null
q "INSERT INTO tasks (title, task_type, status, priority, payload) VALUES ('${T} dup', 'qiumi_task', 'queued', 'P2', '{\"headed_manual\":true,\"dedup_by_notion_page\":\"true\",\"notion_page_id\":\"page-b\"}'::jsonb)" >/dev/null \
  || fail "闸3 同名 Notion 行仍撞去重索引（谓词未豁免 dedup_by_notion_page）"
[[ "$(q "SELECT count(*) FROM tasks WHERE title='${T} dup' AND status='queued'")" == "2" ]] || fail "闸3 计数不对"
pass "闸3 Notion 来源同名不撞"

# 闸4 对照组：同名 + 无豁免键 → 第二条必须精确撞 idx_tasks_dedup_active 的 23505
q "INSERT INTO tasks (title, task_type, status, priority, payload) VALUES ('${T} ctl', 'data', 'queued', 'P2', '{}'::jsonb)" >/dev/null
rc=0; qfail23505 "INSERT INTO tasks (title, task_type, status, priority, payload) VALUES ('${T} ctl', 'data', 'queued', 'P2', '{}'::jsonb)" || rc=$?
case $rc in
  0) pass "闸4 非 Notion 同名仍去重（23505 unique_violation on idx_tasks_dedup_active）" ;;
  1) fail "闸4 对照组没撞索引——去重被整个打掉了" ;;
  *) fail "闸4 对照组撞到非预期错误（不是 23505 idx_tasks_dedup_active，见上方输出）" ;;
esac

# 闸4b（C1 回归）：只带 payload.notion_page_id、不带专用键 dedup_by_notion_page →
# 必须仍然精确撞 idx_tasks_dedup_active 的 23505。这是生产今天就存在的形态
# （notion-push-sync.js 经 work-routing-store.js 把 metadata.notion_page_id spread
# 进 payload），若谓词误用 notion_page_id 当豁免键，这一条会从"撞索引"变成"放行"，
# 即 PR1 对既有 Notion 排单任务的隐性行为变化。
q "INSERT INTO tasks (title, task_type, status, priority, payload) VALUES ('${T} legacy', 'data', 'queued', 'P2', '{\"notion_page_id\":\"page-c\"}'::jsonb)" >/dev/null
rc=0; qfail23505 "INSERT INTO tasks (title, task_type, status, priority, payload) VALUES ('${T} legacy', 'data', 'queued', 'P2', '{\"notion_page_id\":\"page-d\"}'::jsonb)" || rc=$?
case $rc in
  0) pass "闸4b 仅 notion_page_id 不豁免（专用键未复发 C1，23505 unique_violation）" ;;
  1) fail "闸4b 只带 notion_page_id 未撞索引——谓词错用 notion_page_id 当豁免键(C1 复发)" ;;
  *) fail "闸4b 撞到非预期错误（不是 23505 idx_tasks_dedup_active，见上方输出）" ;;
esac

# 闸5：注册表派生的 tick 黑名单与 device-job 地基一致（qiumi_task 不在黑名单，device_job 在）
[[ "$(cd "$(dirname "$0")/../.." && node -e "import('./src/lib/task-type-registry.js').then(m=>process.stdout.write(String(m.TICK_DISPATCH_EXCLUDED.includes('device_job') && !m.TICK_DISPATCH_EXCLUDED.includes('qiumi_task'))))")" == "true" ]] || fail "闸5 注册表 tick 黑名单不符预期"
pass "闸5 注册表 tick 黑名单正确"

# 闸6：CHECK 已存在且已验证（462 的 VALIDATE CONSTRAINT 必须已跑过）
[[ "$(q "SELECT convalidated FROM pg_constraint WHERE conrelid='tasks'::regclass AND conname='tasks_task_type_check'")" == "t" ]] \
  || fail "闸6 tasks_task_type_check 不存在或未验证（462 未应用，NOT VALID 悬空）"
pass "闸6 tasks_task_type_check 存在且已验证"
echo "ALL PASS"
