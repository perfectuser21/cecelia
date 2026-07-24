---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: [FIRE DRILL 07241955] Kernel v1 mixed provider 最终主链验收（R5）

**范围**: 仅新增 `docs/fire-drills/kernel-v1-mixed-20260724-r5.md`；不得修改 packages/brain、现有合同测试、迁移、产品逻辑、CI 配置
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 目标文档存在且含标记 KERNEL_V1_MIXED_FIRE_DRILL_PASS_R5
  Test: node -e "const c=require('fs').readFileSync('docs/fire-drills/kernel-v1-mixed-20260724-r5.md','utf8');if(!c.includes('KERNEL_V1_MIXED_FIRE_DRILL_PASS_R5'))process.exit(1)"

- [ ] [ARTIFACT] 目标文档含生产版本 1.267.67 与 merge commit 19887912bbb581597f12c714a9ed187f051e2850
  Test: node -e "const c=require('fs').readFileSync('docs/fire-drills/kernel-v1-mixed-20260724-r5.md','utf8');if(!c.includes('1.267.67')||!c.includes('19887912bbb581597f12c714a9ed187f051e2850'))process.exit(1)"

- [ ] [ARTIFACT] 失败测试文件存在（TDD Red 载体）
  Test: node -e "require('fs').accessSync('sprints/07241955-kernel-fire-drill-mixed-r5/tests/fire-drill-doc.test.ts')"

## BEHAVIOR 条目（内嵌可执行 manual: 命令，journey_type = autonomous，测真实 git/gh/Brain）

- [ ] [BEHAVIOR] [L2] B1 PR diff 相对 origin/main 恰一行 = 目标文档（Golden Path Step 5）
  动作: generator 在合规分支完成文档提交后，机械执行 git diff --name-only origin/main...HEAD
  预期观察: 输出恰好一行，字面等于 docs/fire-drills/kernel-v1-mixed-20260724-r5.md
  Test: manual:bash -c 'DOC="docs/fire-drills/kernel-v1-mixed-20260724-r5.md"; git fetch origin main --quiet; D=$(git diff --name-only origin/main...HEAD); [ "$D" = "$DOC" ] || { echo "FAIL: diff=[$D]"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] [L2] B2 error path — PR diff 禁带 sprints/**、.harness/**、packages/brain/**（PRD 边界情况，负向断言）
  动作: 对同一 diff 做越界路径扫描
  预期观察: 扫描无命中；任何越界文件混入即本条 FAIL
  Test: manual:bash -c 'if git diff --name-only origin/main...HEAD | grep -E "^(sprints/|[.]harness/|packages/brain/)"; then echo "FAIL: 越界文件混入"; exit 1; fi; echo OK'
  期望: OK

- [ ] [BEHAVIOR] [L2] B3 Brain task API 返回 harness_runtime=kernel-v1 且五角色 provider/account 与派发分配一致（Golden Path Step 1）
  动作: 调用 GET /api/brain/tasks/e321ac5e-98ad-483c-b7ff-d8a6ac7c3687（真实 Brain）
  预期观察: payload.harness_runtime=kernel-v1；planner/proposer=claude/account1，reviewer/evaluator=grok/grok，generator=codex/team3
  Test: manual:bash -c 'RESP=$(curl -sf "http://localhost:5221/api/brain/tasks/e321ac5e-98ad-483c-b7ff-d8a6ac7c3687") || { echo "FAIL: Brain API 不可达"; exit 1; }; [ -n "$RESP" ] || { echo "FAIL: 空响应"; exit 1; }; echo "$RESP" | jq -e ".payload.harness_runtime == \"kernel-v1\" and .payload.role_assignments.planner.provider == \"claude\" and .payload.role_assignments.planner.account == \"account1\" and .payload.role_assignments.proposer.provider == \"claude\" and .payload.role_assignments.proposer.account == \"account1\" and .payload.role_assignments.reviewer.provider == \"grok\" and .payload.role_assignments.reviewer.account == \"grok\" and .payload.role_assignments.evaluator.provider == \"grok\" and .payload.role_assignments.evaluator.account == \"grok\" and .payload.role_assignments.generator.provider == \"codex\" and .payload.role_assignments.generator.account == \"team3\""'
  期望: exit 0（注：本条验证 Golden Path Step 1 的派发运行时事实，派发后任意时点 PASS 属预期，非 generator 产物断言）

- [ ] [BEHAVIOR] [L2] B4 relay-runs API 存在归属当前 task 的 run 记录（Golden Path Step 1，PRD 验收点 6）
  动作: 调用 GET /api/brain/orchestrator/relay-runs?task_id=<本 task uuid>（真实 Brain + Postgres）
  预期观察: 返回数组 length >= 1，且每行 current_task_id 等于本 task id
  Test: manual:bash -c 'RUNS=$(curl -sf "http://localhost:5221/api/brain/orchestrator/relay-runs?task_id=e321ac5e-98ad-483c-b7ff-d8a6ac7c3687") || { echo "FAIL: relay-runs 不可达"; exit 1; }; [ -n "$RUNS" ] || { echo "FAIL: 空响应"; exit 1; }; echo "$RUNS" | jq -e "type == \"array\" and length >= 1 and all(.[]; .current_task_id == \"e321ac5e-98ad-483c-b7ff-d8a6ac7c3687\")"'
  期望: exit 0（同 B3 注：验证链路运行时状态，非 generator 产物断言）

- [ ] [BEHAVIOR] [L2] B5 PR 状态 OPEN、未 merge、head SHA 与本地 HEAD 一致（Golden Path Step 5；human review 批准前禁 merge 的机器前置）
  动作: 在 generator PR 分支执行 gh pr view（真调 GitHub API）
  预期观察: state=OPEN，mergedAt=null，headRefOid 等于 git rev-parse HEAD
  Test: manual:bash -c 'PR_JSON=$(gh pr view --json state,mergedAt,headRefOid) || { echo "FAIL: gh pr view 失败或无 PR"; exit 1; }; [ -n "$PR_JSON" ] || { echo "FAIL: 空响应"; exit 1; }; echo "$PR_JSON" | jq -e --arg h "$(git rev-parse HEAD)" ".state == \"OPEN\" and .mergedAt == null and .headRefOid == \$h" || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] [L2] B6 CI 全绿，within 1800s until-loop 等待预算（Golden Path Step 6）
  动作: 轮询 gh pr view --json statusCheckRollup
  预期观察: within 1800s 内 rollup 非空且全部 conclusion/state ∈ {SUCCESS,NEUTRAL,SKIPPED}；超预算即 FAIL，禁止把 pending 当 PASS
  Test: manual:bash -c 'DEADLINE=$((SECONDS + 1800)); until PRJ=$(gh pr view --json statusCheckRollup 2>/dev/null) && [ -n "$PRJ" ] && echo "$PRJ" | jq -e "[.statusCheckRollup[] | (.conclusion // .state)] | length > 0 and all(.[]; . == \"SUCCESS\" or . == \"NEUTRAL\" or . == \"SKIPPED\")" >/dev/null 2>&1; do [ $SECONDS -lt $DEADLINE ] || { echo "FAIL: CI 未在 1800s 内全绿"; exit 1; }; sleep 30; done; echo OK'
  期望: OK

- [ ] [BEHAVIOR] [L2] B7 分支纪律 — 当前分支匹配 cp-MMDDHHMM-e321ac5e 且非 cp-harness-propose/contract 复用分支（Golden Path Step 4）
  动作: 读取当前分支名做正则机械核对
  预期观察: 分支名形如 cp-[0-9]{8}-e321ac5e*；命中合同分支前缀即 FAIL
  Test: manual:bash -c 'BR=$(git rev-parse --abbrev-ref HEAD); echo "$BR" | grep -Eq "^cp-[0-9]{8}-e321ac5e" || { echo "FAIL: 分支名不合规 [$BR]"; exit 1; }; if echo "$BR" | grep -Eq "^cp-harness-(propose|contract)"; then echo "FAIL: 复用合同分支"; exit 1; fi; echo OK'
  期望: OK

- [ ] [BEHAVIOR] [L2] B8 文档五角色证据行与 Brain API 实时分配逐角色交叉核对（Golden Path Step 8，防手抄假证据）
  动作: 从 task API 拉取五角色 provider/account，逐角色在目标文档 grep 同行序列 role→provider→account
  预期观察: 五角色全部命中；任一角色证据行缺失或与 API 不一致即 FAIL
  Test: manual:bash -c 'DOC="docs/fire-drills/kernel-v1-mixed-20260724-r5.md"; RESP=$(curl -sf "http://localhost:5221/api/brain/tasks/e321ac5e-98ad-483c-b7ff-d8a6ac7c3687") || { echo "FAIL: Brain API 不可达"; exit 1; }; echo "$RESP" | jq -r ".payload.role_assignments | to_entries[] | \"\(.key) \(.value.provider) \(.value.account)\"" > /tmp/dod-ra.txt; [ $(wc -l < /tmp/dod-ra.txt) -eq 5 ] || { echo "FAIL: 角色行数非 5"; exit 1; }; F=0; while read -r role prov acct; do grep -Eq "$role.*$prov.*$acct" "$DOC" || { echo "FAIL: 缺 $role 证据行"; F=1; }; done < /tmp/dod-ra.txt; [ "$F" -eq 0 ] || exit 1; echo OK'
  期望: OK

> 4 类标准场景覆盖说明：本 sprint 无新增 HTTP 端点，「schema 字段值」由 B3/B4 对既有端点的字段断言承担；「keys 完整性」「禁用字段反向」N/A（无新端点、无字段命名决策，Response Schema 段已声明）；「error path」由 B2（越界文件负向）承担。

## Invariant 铁律映射（PRD 铁律清单逐条处置）

| # | 铁律（截断名） | 处置 |
|---|---|---|
| 1 | manual oracle 真实 exit code + 解释器启动 | 已履行：contract-draft.md「Manual oracle 实跑记录」8 条全记 |
| 2 | manual:node -e 的 ${} 须 GAN 前真跑 | 已履行：A1/A2 node -e 已真跑（本轮 exit 1，红=文档未建，解释器已确认启动） |
| 3 | smoke-invariant-1784808160-58494 | N/A（系统占位铁律，本单无对应模块接触） |
| 4 | smoke-invariant-1784806023-5054 | N/A（同上） |
| 5 | 冷启动重置型测试须补增量场景 | N/A（tests/ 为纯文件内容断言，无状态重置写法） |
| 6 | 周期扫描 + 付费调用须已处理前置检查 | N/A(无扫描、无付费调用) |
| 7 | 跨模块时间常数隐含依赖须显式断言 | N/A（唯一时间常数 CI 预算 1800s 为单点显式值，无跨模块依赖） |
| 8 | theater_mismatch android 关键词 | N/A（target_environment=local_api，无 android/windows 路由词） |
| 9 | target_environment 从 DB tasks.payload 读 | 已核对：本 task payload 未带 target_environment 字段，按 PRD 显式声明 local_api 写入合同与 task-plan |
| 10 | judge .brain-result.json 顶层 exit_code+log_tail+behavior_tests[] | 映射：E2E 产出 e2e-checks.jsonl 每行含 command/exit_code/log_tail，为 evaluator/judge 出口格式提供逐条数据源 |
| 11 | varchar 长度写入前截断 | N/A（无 DB 写路径） |
| 12 | 复活死功能先查 git log -D | N/A（全新文档，无复活） |
| 13 | null/false 失败契约显式 else | 已履行：E2E run_check 对 ec≠0 显式 FAIL 分支 |
| 14 | smoke-invariant-1784543934-2387 | N/A（系统占位） |
| 15 | journey_features updated_at 停滞探针 | N/A（journey_id=none） |
| 16 | relay 容器 merge 后退出跳过 report | N/A（merge/report 属 judge/human 后段，合同已声明阶段边界，controller 侧兜底） |
| 17 | host/环境白名单断言核对 headed 接管 | N/A（本合同无 host 白名单类断言） |
| 18 | headed relay base_repo/pr_url 入 payload + 分支带 short id | 已核对：payload 含 base_repo；B7 断言分支名含 e321ac5e |
| 19 | 退役判断查生产库实锤 | N/A（无退役动作） |
| 20 | catch 吞错后台 job 须失败计数 | N/A（无后台 job 新增） |
| 21 | 表名认领冲突先 grep 写入方 | N/A（无建表/复用表） |
| 22 | 新后台 job 须声明消费方 | N/A（无落库 job） |
| 23 | 多设备 os_type UI 区分强制检查 | N/A（无 UI 改动） |
| 24 | git_sha=unknown 跨脚本同语义 | N/A（无判变/终验脚本对） |
| 25 | git rev-parse 判 ref 存在须 --verify ^{commit} | 已履行：合同 git 断言仅取当前 HEAD/分支名（rev-parse HEAD / --abbrev-ref），无「裸 rev-parse 判 ref 存在」用法 |
| 26 | worktree 当 DEPLOY_ROOT 须核对生产触碰 | N/A（无部署脚本执行） |
| 27 | 部署链失败禁 warning 降级 | 映射：失败语义声明表——全部 check FAIL 即拦截 exit 非零，禁 exit 0 兜底 |
| 28 | 判变基准用生产实体自报 | N/A（无判变链） |
| 29 | lint-test-quality 须 await fn() ≥1 | 已履行：tests/ 用 async it + await fsp.readFile |
| 30 | Test Contract 固定 4 列、testFile backtick | 已履行：contract-draft.md Test Contract 表 |
| 31 | Red commit 只 git add 精确路径 | 已履行：propose 提交仅 add 合同四产物精确路径 |
| 32 | source-code inspection 验调度接线 | N/A（无调度改动） |
| 33 | 新 cron 先查 scheduler-jobs.js | N/A（无 cron） |
| 34 | 禁止 generator 自行 merge PR | 映射：B5（evaluator 时点 mergedAt==null）+ Step 9 阶段语义（merge 权在 human 批准后） |
| 35 | CI 侧兜底提前 merge 须被抓 | 映射：B5——evaluator 时点 mergedAt 非 null 即 FAIL，含 auto-merge 兜底路径 |
| 36 | smoke-invariant-1783850042-79911 | N/A（系统占位） |
| 37 | feat+brain/src PR 带 smoke 登记 | N/A（PR 禁触 packages/brain，B2 反向把守） |
| 38 | 新 task_type 七点清单 | N/A（无新 task_type） |
| 39 | 服务存活双信号判定 | N/A（无常驻服务新增） |
| 40 | 本机禁 LaunchAgents 常驻 | N/A（无 launchd 改动） |
| 41 | 新常驻服务须进 launchd-patrol manifest | N/A（同上） |
| 42 | smoke-invariant-1783693282-93097 | N/A（系统占位） |
| 43 | 单 slot 串行任务 | N/A遵守：task-plan 单 ws1，无并行 |
| 44 | 禁止写死环境假设值 | 已履行：断言值全部来自 PRD 拍板事实（版本/commit/分配）与本轮实测 API/源码，无坐标/env 猜测值；CI 预算 1800s 为显式 [AI_ADDED] 等待预算 |
| 45 | 真环境验证才算 done | 映射：接缝清单——Brain（localhost:5221 真进程真库）与 GitHub（gh 真凭据）全真调，无 mock |
| 46 | 测试默认多租户 | N/A（docs-only，无租户面） |
| 47 | 凭据安全 | 已履行：合同/脚本无凭据字面量，gh 用本机既配凭据 |
| 48 | 日志脱敏 | 已履行：log_tail 仅命令输出截尾，无凭据回显 |
| 49 | 端点鉴权 | N/A（不新增端点） |
| 50 | 租户隔离 | N/A（无 DB 写） |
| 51 | Proposer 复用历史模板须核对本次真实派发历史 | 已履行：全部断言由本 task 实测（task API/relay-runs/routes 源码）推导，未搬历史 E2E 断言 |
| 52 | 共享 CI 基础设施文件默认禁区 | 映射：B1「diff 恰一行」+ B2 负向——.github/** 等任何非目标文档路径出现即 FAIL |
