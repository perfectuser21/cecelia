---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: 模型账号配额+机器可达性投影（工厂·F5 指挥舱 刀2）

**范围**: 新增 GET /api/brain/agent-ops/model-accounts 只读端点 + ops_model_accounts 账号级快照表 + ops-model-accounts-collector.js（三家可单测 parser + 逐账号隔离 + upsert）+ agents 端点追加 model_role + Notion「Agents&机器」库加配额列。**只观测，不做派单/选模型决策。**
**大小**: M

> runtime postgres:false：以下 [BEHAVIOR] 全部为纯函数 + capturing 假 pool 的可执行断言（npx vitest / node，从仓库根跑，无需 Postgres）。真 PG 落库端到端见 contract-draft.md「未覆盖真实链路清单」。

## ARTIFACT 条目

- [ ] [ARTIFACT] collector 文件存在且导出三家 parser
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/ops-model-accounts-collector.js','utf8'); if(!/parseAnthropicUsage/.test(c)||!/parseChatgptWhamUsage/.test(c)||!/parseGrokUsage/.test(c))process.exit(1)"

- [ ] [ARTIFACT] ops_model_accounts 迁移文件存在
  Test: node -e "const fs=require('fs'); if(!fs.readdirSync('packages/brain/migrations').some(f=>/ops_model_accounts/.test(f)))process.exit(1)"

- [ ] [ARTIFACT] agent-ops 路由挂载 model-accounts 端点
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/agent-ops.js','utf8'); if(!/model-accounts/.test(c)||!/buildModelAccountsPayload/.test(c))process.exit(1)"

## BEHAVIOR 条目（五行剧本，manual: 内嵌单行命令，postgres:false 可跑）

- [ ] [BEHAVIOR] [L2] B-01: model-accounts 端点返回 8 账号且每条字段齐全
  动作: 用 mock rows 调 buildModelAccountsPayload（等价 GET /agent-ops/model-accounts 只读投影）
  预期观察: 返回 accounts 长度 8，每条含 provider/plan/five_hour_pct/seven_day_pct/reset_at/host_alias/forwardable/forward_targets/status/last_checked_at/last_error 共 11 个必填字段
  等待预算: 0s
  留证: vitest 输出末行（1 passed）
  Test: manual:bash -c 'npx vitest run sprints/09190907-model-account-quota-projection/tests/ --no-cache -t "返回全部 8 条且每条字段齐全"'

- [ ] [BEHAVIOR] [L2] B-02: 单账号失败只标 status+last_error 不阻塞整体（INV-2 不阻塞）
  动作: collectAccountSnapshots 中令 account2 的 fetch 抛 timeout
  预期观察: 返回 2 条，account1 status=ok，account2 status=unknown+last_error，不整体抛错（等价端点 HTTP 200）
  等待预算: 0s
  留证: vitest 输出末行
  Test: manual:bash -c 'npx vitest run sprints/09190907-model-account-quota-projection/tests/ --no-cache -t "单账号 fetch 抛错"'

- [ ] [BEHAVIOR] [L2] B-03: Grok key 过期 → key_expired 且解析纯函数无 refresh 副作用（proven-to-fire，接缝×2）
  动作: parseGrokUsage 收到 grpc-status 7 PERMISSION_DENIED 帧
  预期观察: 返回 status=key_expired，且返回对象无 refresh_token/refresh_action 字段（绝不触碰 refresh_token）
  等待预算: 0s
  留证: vitest 输出末行
  Test: manual:bash -c 'npx vitest run sprints/09190907-model-account-quota-projection/tests/ --no-cache -t "key_expired"'

- [ ] [BEHAVIOR] [L2] B-04: agents 端点每条含 model_role 真实计数且不造分层标签（INV-3 不造标签）
  动作: attachModelRoles 处理含 primary/fallback 的 agent fixtures
  预期观察: 每条 model_role={model,primary_count,fallback_count}，计数与分身配置一致，键集恰为这三个（无 tier/level/layer）
  等待预算: 0s
  留证: vitest 输出末行
  Test: manual:bash -c 'npx vitest run sprints/09190907-model-account-quota-projection/tests/ --no-cache -t "model_role"'

- [ ] [BEHAVIOR] [L2] B-05: 三家 parser 把 provider payload 归一到统一 pct schema
  动作: parseAnthropicUsage / parseChatgptWhamUsage 喂代表性 provider payload
  预期观察: 输出 {five_hour_pct, seven_day_pct, reset_at}，pct 归一到 0-100（超界 clamp），缺字段 null
  等待预算: 0s
  留证: vitest 输出末行
  Test: manual:bash -c 'npx vitest run sprints/09190907-model-account-quota-projection/tests/ --no-cache -t "映射"'

- [ ] [BEHAVIOR] [L2] B-06: 表未迁移 42P01 → migration_pending（禁 200 空数组假绿）
  动作: buildModelAccountsPayload 遇 ops_model_accounts 42P01
  预期观察: reject 带 reason_code=migration_pending（端点层转 HTTP 503，非 200 空数组）
  等待预算: 0s
  留证: vitest 输出末行
  Test: manual:bash -c 'npx vitest run sprints/09190907-model-account-quota-projection/tests/ --no-cache -t "42P01"'

- [ ] [BEHAVIOR] [L2] B-07: Codex 凭据缺失/损坏 → no_credential
  动作: classifyAccountStatus 收到 ENOENT/损坏错误
  预期观察: 返回 status=no_credential（区别于 unknown 超时/key_expired）
  等待预算: 0s
  留证: vitest 输出末行
  Test: manual:bash -c 'npx vitest run sprints/09190907-model-account-quota-projection/tests/ --no-cache -t "no_credential"'

- [ ] [BEHAVIOR] [L2] B-08: Notion「Agents&机器」库对应行产出 5h%/7d%/更新时间配额列（PRD Golden Path 第4条，token-free 纯函数 oracle）
  动作: 用含 five_hour_pct/seven_day_pct/last_checked_at 的运行单元 fixture 调 buildOpsUnitNotionProperties（notion-push-sync.js，等价 Notion 推送时对该行的属性构造）
  预期观察: 产出 Quota5h={number:42}、Quota7d={number:60}、QuotaUpdatedAt={date:{start:...}} 三个 Notion 属性；无配额数据的行不产出这三列（不误填 0）
  等待预算: 0s
  留证: vitest 输出末行（passed）
  Test: manual:bash -c 'npx vitest run sprints/09190907-model-account-quota-projection/tests/ --no-cache -t "Notion"'

- [ ] [BEHAVIOR] [L2] INV-1: collector 源码任何路径无 refresh_token/device-auth 调用（不可逆事故防护）
  动作: 静态读 collector 源码正则扫描 refresh_token/refreshToken/device-auth
  预期观察: 命中 0 处（脚本刷新 refresh_token=整条链被撤销，只能人工 device-auth）
  等待预算: 0s
  留证: 命令 exit code 0 + stdout OK
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/ops-model-accounts-collector.js','utf8'); if(/refresh[_-]?token|refreshToken|device-auth/.test(c)){console.error('FAIL: refresh path present');process.exit(1)} console.log('OK')"

- [ ] [BEHAVIOR] [L2] INV-5: 凭据白名单不外泄——extractOpenclawAgents 输出不含明文凭据
  动作: 用含 apiKey:'SECRET' 的 config 真跑 extractOpenclawAgents
  预期观察: 序列化结果不含 'SECRET'（白名单铁律不回退），且 meta.model_fallbacks 被捕获
  等待预算: 0s
  留证: 命令 exit code 0 + stdout OK
  Test: manual:node -e "import('./packages/brain/src/ops-collector.js').then(m=>{const r=m.extractOpenclawAgents({agents:{entries:{main:{model:{primary:'x',fallbacks:['y']},apiKey:'SECRET'}}}}); if(JSON.stringify(r).includes('SECRET'))process.exit(1); if(JSON.stringify(r[0].meta.model_fallbacks)!=='[\"y\"]')process.exit(1); console.log('OK')}).catch(e=>{console.error(e);process.exit(1)})"

## INV 覆盖收尾（铁律逐条映射）

- INV-1 不碰 refresh_token → 上方 [BEHAVIOR] INV-1 + B-03
- INV-2 不阻塞 → 上方 [BEHAVIOR] B-02
- INV-3 不造标签 → 上方 [BEHAVIOR] B-04
- INV-4 只观测 → N/A（本合同 scope 仅只读端点 + 采集表 + parser，无任何派单/选模型/写决策端点，无对应可执行断言）
- INV-5 凭据隔离/白名单 → 上方 [BEHAVIOR] INV-5
