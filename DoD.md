contract_branch: cp-harness-propose-r3-aaa26ab2-r0f36a253-a29
sprint_dir: sprints/09190907-model-account-quota-projection

---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: 模型账号配额+机器可达性投影（刀2）

**范围**: 新增 GET /agent-ops/model-accounts（8 账号配额快照）+ agents 端点追加 model_role + 新表 ops_model_accounts + 采集 job（沿用刀1 host-exec）+ 三家可单测 parser + Notion「Agents&机器」配额列。只做可观测数据，不做派单决策。
**大小**: M

## ARTIFACT 条目

- [ ] [ARTIFACT] 采集器新文件存在且导出 parser/枚举/collector（含 refresh_token 禁止注释）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/ops-model-accounts-collector.js','utf8');if(!/MODEL_ACCOUNT_STATUS/.test(c)||!/parseAnthropicUsage/.test(c)||!/parseGrokUsage/.test(c))process.exit(1)"

- [ ] [ARTIFACT] migration 449 新建 ops_model_accounts 表（含 status/last_error/forward_targets 列 + account_id 唯一）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/migrations/449_ops_model_accounts.sql','utf8');if(!/CREATE TABLE IF NOT EXISTS ops_model_accounts/.test(c)||!/account_id/.test(c)||!/forward_targets/.test(c))process.exit(1)"

- [ ] [ARTIFACT] collector 源码无 refresh_token 调用路径（只允许出现在注释里）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/ops-model-accounts-collector.js','utf8');const bad=c.split('\n').filter(l=>/refresh_token/.test(l)&&!/^\s*(\/\/|\*|#)/.test(l));if(bad.length){console.error('非注释 refresh_token:',bad);process.exit(1)}"

## BEHAVIOR 条目（内嵌可执行 manual: 命令，journey_type=autonomous）

- [ ] [BEHAVIOR] [L2] B-01: 调 model-accounts 端点返回 8 条账号快照，11 字段齐全
  动作: E2E 预置 8 行账号快照后 GET /api/brain/agent-ops/model-accounts
  预期观察: data.accounts 恰好 8 条（e2e- 前缀），每条含 provider/plan/five_hour_pct/seven_day_pct/reset_at/host_alias/forwardable/forward_targets/status/last_checked_at/last_error 共 11 字段
  等待预算: 0s
  留证: /tmp/ma.json + jq 输出
  Test: manual:bash -c 'curl -sf localhost:5221/api/brain/agent-ops/model-accounts | jq -e "([.data.accounts[]|select(.account_id|startswith(\"e2e-\"))]|length==8) and ([.data.accounts[]|select(.account_id|startswith(\"e2e-\"))]|all(has(\"provider\") and has(\"plan\") and has(\"five_hour_pct\") and has(\"seven_day_pct\") and has(\"reset_at\") and has(\"host_alias\") and has(\"forwardable\") and has(\"forward_targets\") and has(\"status\") and has(\"last_checked_at\") and has(\"last_error\")))"'

- [ ] [BEHAVIOR] [L2] B-02: 单账号失败只标该条，其余正常，HTTP 200
  动作: 预置一条 status=unknown+last_error 的账号后 GET model-accounts
  预期观察: HTTP 200；至少 1 条 status=unknown 且 last_error 为字符串；其余账号 status 非 unknown 正常
  等待预算: 0s
  留证: HTTP code + jq 输出
  Test: manual:bash -c 'CODE=$(curl -s -o /tmp/ma.json -w "%{http_code}" localhost:5221/api/brain/agent-ops/model-accounts); [ "$CODE" = "200" ] || { echo "FAIL HTTP $CODE"; exit 1; }; jq -e "[.data.accounts[]|select(.status==\"unknown\")]|length>=1 and (.[0].last_error|type==\"string\")" /tmp/ma.json'

- [ ] [BEHAVIOR] [L2] B-03: Grok key 过期只标 key_expired，代码零 refresh_token 调用路径 [接缝×2]
  动作: 预置 grok status=key_expired 行后 GET model-accounts；并静态扫描 collector 源码
  预期观察: 至少 1 条 status=key_expired；collector 非注释行 refresh_token 命中数为 0（铁律 INV-1）
  等待预算: 0s
  留证: jq 输出 + grep 结果（应为空）
  Test: manual:bash -c 'jq -e "[.data.accounts[]|select(.status==\"key_expired\")]|length>=1" /tmp/ma.json && { HITS=$(grep -nE "refresh_token" packages/brain/src/ops-model-accounts-collector.js | grep -vE "^[0-9]+:[[:space:]]*(//|\*|#)" || true); [ -z "$HITS" ] || { echo "FAIL 非注释 refresh_token: $HITS"; exit 1; }; echo OK; }'

- [ ] [BEHAVIOR] [L2] B-04: agents 端点每条追加真实 model_role（三字段）
  动作: GET /api/brain/agent-ops/agents
  预期观察: data.agents 每条含 model_role{model_id, primary_count, fallback_count}，计数为全体分身真实聚合
  等待预算: 0s
  留证: jq 输出
  Test: manual:bash -c 'curl -sf localhost:5221/api/brain/agent-ops/agents | jq -e ".data.agents|all(has(\"model_role\") and (.model_role|has(\"model_id\") and has(\"primary_count\") and has(\"fallback_count\")))"'

- [ ] [BEHAVIOR] [L2] B-05: 冻结合同测试全绿（parser 同 schema + key_expired 分类 + refresh spy 零调用 + collector→表→端点真 PG + model_role 聚合）
  动作: 从仓库根跑冻结 sprint 测试（真 PG cecelia_test 注入）
  预期观察: model-accounts.test.ts 全部用例通过（三家 parser、classifyGrokUsageError=key_expired、refreshToken 零调用、端点 8 条含 last_error、model_role primary_count 聚合）
  等待预算: 0s
  留证: vitest verbose 输出末尾 passed 行
  Test: manual:bash -c 'npx vitest run sprints/09190907-model-account-quota-projection/tests/model-accounts.test.ts --reporter=verbose'

- [ ] [BEHAVIOR] [L2] B-06: Notion「Agents&机器」库 schema 含配额列（FiveHourPct/SevenDayPct/QuotaUpdatedAt）
  动作: 加载 ops-notion-schema.js 检查 OPS_DB_PROPS.graph 列定义
  预期观察: graph 库定义含 FiveHourPct、SevenDayPct、QuotaUpdatedAt 三列（缺列即补幂等，随现有 notion-push-sync 推送）
  等待预算: 0s
  留证: node stdout（OK graph 配额列齐）
  Test: manual:bash -c 'cd packages/brain && node -e "import(\"./src/ops-notion-schema.js\").then(m=>{const g=m.OPS_DB_PROPS.graph;const need=[\"FiveHourPct\",\"SevenDayPct\",\"QuotaUpdatedAt\"];const miss=need.filter(k=>!(k in g));if(miss.length){console.error(\"FAIL 缺列\",miss);process.exit(1)}console.log(\"OK graph 配额列齐\")})"'

- [ ] [BEHAVIOR] INV-3 [枚举单份] status 枚举只一份，collector 与 route builder 同源 import（无手抄副本）
  动作: grep 全仓 status 枚举字面量集合的定义处
  预期观察: `MODEL_ACCOUNT_STATUS` 常量仅在 ops-model-accounts-collector.js 定义一次；agent-ops.js 通过 import 使用而非重新声明字面量数组
  等待预算: 0s
  留证: grep 输出
  Test: manual:bash -c 'DEF=$(grep -rlE "MODEL_ACCOUNT_STATUS\s*=" packages/brain/src | wc -l | tr -d " "); [ "$DEF" = "1" ] || { echo "FAIL: 枚举定义处 $DEF 个（应 1）"; exit 1; }; grep -q "MODEL_ACCOUNT_STATUS" packages/brain/src/routes/agent-ops.js && echo OK'

- [ ] [BEHAVIOR] INV-4 [幂等 upsert] collector 真跑写路径 + 同 account_id 重复采集不产生重复行
  动作: 真 PG（DB_NAME 注入）下跑冻结 [integration] 段：`runModelAccountsCollector(真 pool, {fetchUsage 注入, refreshToken spy})` 连跑两次，psql 查 ops_model_accounts
  预期观察: 8 个静态 account_id 全部落表（写路径真验，非 memPool）；连跑两次后每 account_id 行数恒为 1、总行数恒 8（ON CONFLICT DO UPDATE 幂等，非 SELECT-then-INSERT）；refreshToken spy 零调用
  等待预算: 0s
  留证: vitest verbose 输出（[integration] 段 passed 行）
  Test: manual:bash -c 'npx vitest run sprints/09190907-model-account-quota-projection/tests/model-accounts.test.ts -t "integration" --reporter=verbose'
