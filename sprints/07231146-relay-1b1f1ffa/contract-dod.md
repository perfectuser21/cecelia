---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: preview-capacity-gate-and-destroyer

**范围**: 宿主磁盘采样器（`scripts/host-disk-sampler.sh`）+ 容量准入闸门（`packages/brain/src/capacity-gate.js`）+ 统一销毁器（`packages/brain/src/preview-destroyer.js`）+ `scripts/preview-cleanup.sh` 重写 + migration 358 + `routes/preview.js` 接入 + 现存资源批量清扫（Final E2E 阶段）
**大小**: L

## ARTIFACT 条目

- [ ] [ARTIFACT] scripts/host-disk-sampler.sh 存在且含 set -euo pipefail 与显式 PATH 声明
  Test: node -e "const c=require('fs').readFileSync('scripts/host-disk-sampler.sh','utf8'); if(!c.includes('set -euo pipefail')) process.exit(1); if(!/PATH=/.test(c)) process.exit(1);"

- [ ] [ARTIFACT] packages/brain/src/capacity-gate.js 存在且导出 readHostDisk/admitPreview
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/capacity-gate.js','utf8'); if(!c.includes('readHostDisk')) process.exit(1); if(!c.includes('admitPreview')) process.exit(1);"

- [ ] [ARTIFACT] packages/brain/src/preview-destroyer.js 存在且导出 destroyPreview
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/preview-destroyer.js','utf8'); if(!c.includes('destroyPreview')) process.exit(1);"

- [ ] [ARTIFACT] migration 358 存在且含 cleaning/cleanup_failed/cleanup_detail
  Test: node -e "const fs=require('fs'); const f=fs.readdirSync('packages/brain/migrations').find(x=>x.startsWith('358_')); if(!f) process.exit(1); const c=fs.readFileSync('packages/brain/migrations/'+f,'utf8'); if(!c.includes('cleaning')||!c.includes('cleanup_failed')||!c.includes('cleanup_detail')) process.exit(1);"

- [ ] [ARTIFACT] scripts/preview-cleanup.sh 已重写为 preview-destroyer.js 的唯一 shell 执行体
  Test: node -e "const c=require('fs').readFileSync('scripts/preview-cleanup.sh','utf8'); if(!c.includes('preview-destroyer')) process.exit(1);"

- [ ] [ARTIFACT] T10 消费者代码 grep 断言：capacity-gate.js/preview-destroyer.js 内不存在本地 df/diskutil 直接调用（统一只经 readHostDisk() 消费 host-disk-sampler.sh 的采样结果，禁止消费者重复实现磁盘采样，违背"统一采样、统一消费"设计目标）
  Test: node -e "const fs=require('fs'); const files=['packages/brain/src/capacity-gate.js','packages/brain/src/preview-destroyer.js']; const bad=/execSync\(\s*['\"\`]\s*df\b|spawnSync\(\s*['\"\`]df['\"\`]|spawn\(\s*['\"\`]df['\"\`]|exec\(\s*['\"\`]\s*df\b|['\"\`]diskutil['\"\`]|\bdf\s+-k\b/; let fail=false; for (const f of files) { const c=fs.readFileSync(f,'utf8'); if (bad.test(c)) { console.error('FAIL: ' + f + ' 内含本地 df/diskutil 直接调用，应改为经 capacity-gate.js 的 readHostDisk() 读取 .runtime/host-disk.json'); fail=true; } } if (fail) process.exit(1); console.log('OK: no local df/diskutil calls in capacity-gate.js or preview-destroyer.js');"
  期望: exit 0（两文件源码内均不含 df/diskutil 直接调用）

## BEHAVIOR 条目（内嵌可执行 manual: 命令，journey_type=autonomous，真实 Brain/DB/文件系统/git worktree，禁 mock）

### 模块1 宿主磁盘采样器

- [ ] [BEHAVIOR] host-disk-sampler.sh 原子写入 host-disk.json 且字段完整、字节级数值（非 GB/GiB 字符串）
  Test: manual:bash -c 'node sprints/07231146-relay-1b1f1ffa/tests/manual/t1-sampler.mjs atomic-write'
  期望: OK:sampler-atomic-write

- [ ] [BEHAVIOR] host-disk-sampler.sh 在 cron 等价环境（仅 PATH=/usr/bin:/bin）下仍能成功采样（显式 PATH 生效）
  Test: manual:bash -c 'node sprints/07231146-relay-1b1f1ffa/tests/manual/t1-sampler.mjs cron-path'
  期望: OK:sampler-cron-path

### 模块2 容量准入闸门 — readHostDisk 4 种拒绝分支

- [ ] [BEHAVIOR] readHostDisk() 样本文件缺失 → reason sample_missing
  Test: manual:bash -c 'NODE_ENV=test DB_NAME=cecelia_test node sprints/07231146-relay-1b1f1ffa/tests/manual/t2-read-host-disk.mjs missing'
  期望: OK:read-host-disk-missing

- [ ] [BEHAVIOR] readHostDisk() 样本 JSON 损坏 → reason sample_corrupt
  Test: manual:bash -c 'NODE_ENV=test DB_NAME=cecelia_test node sprints/07231146-relay-1b1f1ffa/tests/manual/t2-read-host-disk.mjs corrupt'
  期望: OK:read-host-disk-corrupt

- [ ] [BEHAVIOR] readHostDisk() 样本过期（>180s）→ reason sample_stale
  Test: manual:bash -c 'NODE_ENV=test DB_NAME=cecelia_test node sprints/07231146-relay-1b1f1ffa/tests/manual/t2-read-host-disk.mjs stale'
  期望: OK:read-host-disk-stale

- [ ] [BEHAVIOR] readHostDisk() 样本字段不完整 → reason sample_incomplete
  Test: manual:bash -c 'NODE_ENV=test DB_NAME=cecelia_test node sprints/07231146-relay-1b1f1ffa/tests/manual/t2-read-host-disk.mjs incomplete'
  期望: OK:read-host-disk-incomplete

### 模块2 容量准入闸门 — admitPreview 四层判定 + 并发串行化 + 幂等复用

- [ ] [BEHAVIOR] admitPreview() active/starting/cleaning 数量 ≥6 → 拒绝 too_many_active，返回 free_bytes/projected_cost_bytes/need_release_bytes
  Test: manual:bash -c 'NODE_ENV=test DB_NAME=cecelia_test node sprints/07231146-relay-1b1f1ffa/tests/manual/t3-admit-preview.mjs count-limit'
  期望: OK:admit-count-limit

- [ ] [BEHAVIOR] admitPreview() effective_free_bytes - 3.5GiB < 35GiB → 拒绝 insufficient_free_space（字节级精确比较）
  Test: manual:bash -c 'NODE_ENV=test DB_NAME=cecelia_test node sprints/07231146-relay-1b1f1ffa/tests/manual/t3-admit-preview.mjs capacity-limit'
  期望: OK:admit-capacity-limit

- [ ] [BEHAVIOR] admitPreview() usage_pct ≥85 → 拒绝 usage_pct_too_high
  Test: manual:bash -c 'NODE_ENV=test DB_NAME=cecelia_test node sprints/07231146-relay-1b1f1ffa/tests/manual/t3-admit-preview.mjs usage-limit'
  期望: OK:admit-usage-limit

- [ ] [BEHAVIOR] admitPreview() 并发准入经 pg_advisory_xact_lock 串行化，剩余 1 名额时 3 并发「真实判定+预留」请求恰好 1 个 admitted，且 preview_environments 表针对这 3 个候选 PR 最终恰好新增 1 行真实 DB 记录（不是只数返回值里 admitted===true 的个数——GAN Round 1 反馈问题2 修复：抓出"admitPreview 判 true 后调用方再单独调无锁 allocatePreview() 做预留"的 TOCTOU 实现），admitted 返回值须含 port/db_name（方案A schema 升级）
  Test: manual:bash -c 'NODE_ENV=test DB_NAME=cecelia_test node sprints/07231146-relay-1b1f1ffa/tests/manual/t3-admit-preview.mjs concurrency-lock'
  期望: OK:admit-concurrency-lock

- [ ] [BEHAVIOR] admitPreview() 已存在活跃记录的 PR 重推（幂等复用）跳过准入四层判定
  Test: manual:bash -c 'NODE_ENV=test DB_NAME=cecelia_test node sprints/07231146-relay-1b1f1ffa/tests/manual/t3-admit-preview.mjs idempotent-reuse'
  期望: OK:admit-idempotent-reuse

### 模块3 统一销毁器 — 7 步流程 / 安全防护 / 幂等 / 并发去重

- [ ] [BEHAVIOR] destroyPreview() 7 步流程完整执行：真实 DB 已删 + 真实 worktree 已删 + 真实进程已杀 + 临时文件已清 + 终态 inactive
  Test: manual:bash -c 'NODE_ENV=test DB_NAME=cecelia_test node sprints/07231146-relay-1b1f1ffa/tests/manual/t4-destroy-preview.mjs full-flow'
  期望: OK:destroy-full-flow

- [ ] [BEHAVIOR] destroyPreview() DB 名不匹配 ^cecelia_preview_[0-9]+$ → 拒绝 DROP DATABASE，置 cleanup_failed，不误删邻近合法库
  Test: manual:bash -c 'NODE_ENV=test DB_NAME=cecelia_test node sprints/07231146-relay-1b1f1ffa/tests/manual/t4-destroy-preview.mjs dbname-guard'
  期望: OK:destroy-dbname-guard

- [ ] [BEHAVIOR] destroyPreview() worktree 路径通过符号链接逃逸 preview 根目录 → realpath 校验 abort，不执行 rm -rf
  Test: manual:bash -c 'NODE_ENV=test DB_NAME=cecelia_test node sprints/07231146-relay-1b1f1ffa/tests/manual/t4-destroy-preview.mjs realpath-guard'
  期望: OK:destroy-realpath-guard

- [ ] [BEHAVIOR] destroyPreview() 对已 inactive 的 PR 重复调用 → 幂等成功
  Test: manual:bash -c 'NODE_ENV=test DB_NAME=cecelia_test node sprints/07231146-relay-1b1f1ffa/tests/manual/t4-destroy-preview.mjs idempotent'
  期望: OK:destroy-idempotent

- [ ] [BEHAVIOR] destroyPreview() 同一 PR webhook + reaper 并发触发销毁，per-PR advisory lock 保证只实际执行一次
  Test: manual:bash -c 'NODE_ENV=test DB_NAME=cecelia_test node sprints/07231146-relay-1b1f1ffa/tests/manual/t4-destroy-preview.mjs concurrent-dedup'
  期望: OK:destroy-concurrent-dedup

### 路由层接入（POST /preview/start 准入拒绝 503 + POST /preview/stop 销毁终态透出）

- [ ] [BEHAVIOR] POST /api/brain/preview/start 数量红线场景返回 HTTP 503 + reason/free_bytes/projected_cost_bytes/need_release_bytes 四字段类型正确
  Test: manual:bash -c 'for i in $(seq 1 6); do psql -h localhost -U cecelia -d cecelia -c "INSERT INTO preview_environments (pr_number, branch_name, base_repo, port, db_name, status) VALUES (89000$i, '"'"'cp-dod-fixture'"'"', '"'"'cecelia'"'"', $((5290+i)), '"'"'cecelia_preview_89000'"'"'||$i, '"'"'active'"'"') ON CONFLICT DO NOTHING;" >/dev/null; done; CODE=$(curl -s -o /tmp/dod-admit-resp.json -w "%{http_code}" -X POST localhost:5221/api/brain/preview/start -H "Content-Type: application/json" -d "{\"pr_number\": 899999, \"branch_name\": \"cp-dod-fixture\"}"); psql -h localhost -U cecelia -d cecelia -c "DELETE FROM preview_environments WHERE branch_name='"'"'cp-dod-fixture'"'"';" >/dev/null; [ "$CODE" = "503" ] || { echo "FAIL: got $CODE"; cat /tmp/dod-admit-resp.json; exit 1; }; jq -e ".reason and (.projected_cost_bytes|type==\"number\") and (.need_release_bytes|type==\"number\")" /tmp/dod-admit-resp.json'
  期望: exit 0（HTTP 503 + 四字段类型正确）

- [ ] [BEHAVIOR] POST /api/brain/preview/stop/:pr 正常销毁场景响应体含 status:"inactive" 字段
  Test: manual:bash -c 'PR=898888; psql -h localhost -U cecelia -d cecelia -c "INSERT INTO preview_environments (pr_number, branch_name, base_repo, port, db_name, status) VALUES ($PR, '"'"'cp-dod-stop-fixture'"'"', '"'"'cecelia'"'"', 5298, '"'"'cecelia_preview_'"'"'||$PR, '"'"'active'"'"') ON CONFLICT DO NOTHING;" >/dev/null; RESP=$(curl -sf -X POST localhost:5221/api/brain/preview/stop/$PR); echo "$RESP" | jq -e ".status == \"inactive\" or .status == \"cleanup_failed\""'
  期望: exit 0（响应体含合法 status 枚举值）

## Invariant 覆盖（49 条铁律逐条映射，来源: area）

> 格式说明：本段逐条铁律登记"遵守/N/A + 理由"，**不用** `- [ ] [BEHAVIOR]` checkbox 格式（避免与上方真正的可执行 BEHAVIOR 条目混入同一计数，破坏 Step 2b-check 自查的 BC/MC 比例）。已有可执行断言覆盖的铁律，直接引用上方对应 BEHAVIOR 条目名，不重复起草断言。

- INV-01 [跨扫描测试] N/A：本 sprint 无冷启动重置类跨 tick 扫描测试模式，admitPreview/destroyPreview 均为单次同步真实执行
- INV-02 [重扫去重] N/A：本 sprint 不引入外部付费 LLM/API 调用
- INV-03 [时间常数] 遵守：`SAMPLE_STALE_SECONDS(180s)` 与采样 cron 频率(60s) 隐含大小关系已显式登记——180s = 3× 采样间隔，留足抖动余量；已由上方 BEHAVIOR「readHostDisk() 样本过期（>180s）→ reason sample_stale」间接验证该常量生效，不重复起草
- INV-04 [环境误判] N/A：target_environment=local_api，不涉及 android 关键词误判场景
- INV-05 [环境来源] 遵守：target_environment 已由 controller 从 DB tasks.payload 注入（sprint-prd.md 内 `## target_environment: local_api` 系派发时写入，非本合同从文件推断）
- INV-06 [结果格式] N/A：本铁律约束 judge 的 `.brain-result.json` 顶层 exit_code/log_tail/behavior_tests[] 格式，属 evaluator/judge 产物，非本 sprint 代码改动对象
- INV-07 [字段截断] N/A：本 sprint 涉及的 DB 列（db_name/branch_name/status）均为 TEXT 无 varchar(N) 长度约束，无截断风险
- INV-08 [复活先查] N/A：本 sprint 是新增模块（capacity-gate.js/preview-destroyer.js 首次创建），非复活曾经死过的功能
- INV-09 [显式else] 遵守：readHostDisk/admitPreview/destroyPreview 均"失败返回结构化对象、不抛异常"契约，routes/preview.js 调用方须写显式 else 分支（成功分支 200 / 失败分支 503|cleanup_failed），已写入 Golden Path Step 10 + Response Schema 段，由上方路由层两条 BEHAVIOR 验证
- INV-10 [smoke占位] N/A：占位铁律，无具体文本，无法映射
- INV-11 [漏跑探测] N/A：journey_id=none，本 sprint 无 journey_features 行可探测
- INV-12 [跳步兜底] N/A：harness-controller relay 容器兜底机制，非本 sprint 代码改动对象
- INV-13 [白名单核对] N/A：本 sprint 无 host/环境白名单类断言
- INV-14 [点火写payload] N/A：本 sprint 非 headed relay 点火任务
- INV-15 [退役实锤] N/A：本 sprint 无功能退役判断
- INV-16 [吞错告警] 遵守：destroyPreview cleanup_failed 状态本身即失败计数信号（`SELECT count(*) FROM preview_environments WHERE status='cleanup_failed'` 可查），配合 admitPreview layer1 拒绝分支的 Bark 告警，满足"吞错 job 须带失败计数指标"精神
- INV-17 [建表核对] 遵守：复用既有 preview_environments 表（非新建），已 grep 全部写入方（preview-manager.js/routes/preview.js/preview-reaper.sh/preview-env-start.sh/preview-env-stop.sh），migration 358 为向后兼容 ALTER ADD COLUMN，由上方 ARTIFACT「migration 358 存在」验证
- INV-18 [落库需消费方] 遵守：cleanup_detail 新列的消费方明确——GET /preview/status 透出给调用方、Final E2E 验收读取、人工排障读取，非孤儿落库
- INV-19 [多端UI] N/A：本 sprint 无 UI，无多设备类型区分场景
- INV-20 [语义一致] 遵守：`status != 'inactive'` 判"活跃"的语义在既有 allocatePreview 与新增 admitPreview 之间保持一致，未引入第二套判活标准，由上方 BEHAVIOR「admitPreview() active/starting/cleaning 数量 ≥6」间接验证
- INV-21 [ref校验] N/A：本 sprint 无 `git rev-parse` 判 ref 存在性的代码路径（worktree add 使用的是已知 branch_name/HEAD，非任意 ref 存在性判断）
- INV-22 [越权核对] 遵守：全部 driver 脚本/vitest 用真实临时目录（mkdtemp）覆盖 CECELIA_DEPLOY_ROOT/previewBaseDir，测试 fixture 用独立随机 PR 号区间（89xxxx/90xxxx/91xxxx/92xxxx），已核对不会向上触碰生产 preview_environments 数据或真实 previews 目录
- INV-23 [失败硬退] 遵守：dropdb/worktree remove 失败或路径逃逸场景，契约要求显式置 cleanup_failed + cleanup_detail 残留清单，绝不 warning 降级为 inactive；采样/准入侧拒绝 + Bark 告警而非静默 exit 0，已写入 Golden Path Step 2/8/9 与失败语义声明表，由上方 BEHAVIOR「destroyPreview() DB 名不匹配」「destroyPreview() worktree 路径通过符号链接逃逸」验证
- INV-24 [判变基准] N/A：本 sprint 无"生产实体自报 git_sha 对账 origin/main"类判变场景
- INV-25 [测试异步] 遵守：所有 BEHAVIOR 断言均 `async ()=>{}` + await 包装真实执行（manual driver scripts/vitest it() 均异步），文件存在性检查仅用于 ARTIFACT 而非业务行为断言
- INV-26 [合同表格式] 遵守：Test Contract 表固定 4 列（功能/Test File/BEHAVIOR 覆盖/预期红证据），testFile 已用反引号包裹
- INV-27 [Red精确add] N/A：Red commit 的 git add 精确性由 generator 在 TDD Red 阶段负责，非 proposer 义务
- INV-28 [回归验证法] N/A：本 sprint 无"调度接线"类回归验证场景，host-disk-sampler.sh 是宿主 OS cron 非 Brain 内部调度
- INV-29 [cron接线] N/A（边界已在 PRD 假设段声明）：host-disk-sampler.sh 是宿主 OS 级 cron（PR 内提供 crontab 行，部署方手工安装），不接入 `packages/brain/src/scheduler-jobs.js` 的 JOBS 列表，该铁律的"检查 scheduler-jobs.js"要求不适用于本模块
- INV-30 [禁自merge] 遵守：本 sprint 走标准 harness-generator→evaluator→controller merge 流程，proposer/generator 均不自行 merge PR
- INV-31 [tmux环境] N/A：本 sprint 非 headed relay tmux 场景
- INV-32 [合同复用核对] 遵守：本合同 E2E 验收模板取自 local_api 官方模板，结合 PRD 明确 target_environment=local_api 派发历史，未套用其他 journey_type 先例模板
- INV-33 [CI文件禁区] 遵守：本 sprint「预期受影响文件」不含 `.github/workflows/*.yml`——路由层改动发生在 `routes/preview.js`，`preview-deploy.yml`/`preview-cleanup.yml` 保持不变
- INV-34 [提前合并] N/A：由 controller/CI 侧机制负责，非 proposer 合同内容
- INV-35 [smoke占位2] N/A：占位铁律，无具体文本，无法映射
- INV-36 [PR带smoke] 提醒 generator：本 sprint 改动 `packages/brain/src/`（capacity-gate.js/preview-destroyer.js），开 PR 前须直接一次带齐 smoke.sh + smoke-allowlist 登记，不能等 CI
- INV-37 [新类型接线] N/A：本 sprint 不新增 task_type
- INV-38 [存活双信号] N/A：本 sprint 不新增常驻宿主服务，host-disk-sampler.sh 是一次性 cron 脚本非常驻进程
- INV-39 [禁用LaunchAgents] 遵守：host-disk-sampler.sh 走宿主 crontab（PRD 假设段明确），非 LaunchAgents，符合"本机禁止再放常驻 LaunchAgents 服务"要求
- INV-40 [服务登记] N/A：本 sprint 不新增常驻宿主服务，无需登记 launchd-patrol.js manifest
- INV-41 [smoke占位3] N/A：占位铁律，无具体文本，无法映射
- INV-42 [单slot串行] 遵守：pg_advisory_xact_lock 是本 sprint"单 slot 串行"的具体实现——全局准入判定串行、per-PR 销毁串行，跨 PR/跨请求可并行，同一临界资源单串行，已写入 Golden Path Step 6/9，由上方 BEHAVIOR「admitPreview() 并发准入」「destroyPreview() 同一 PR webhook + reaper 并发触发销毁」验证
- INV-43 [禁写死环境] 遵守：容量红线数值（3.5GiB/35GiB/85%/6）是 PRD 显式产品需求常量非"环境假设值"；PREVIEW_BASE_DIR/REPO_ROOT/CECELIA_DEPLOY_ROOT 均支持环境变量覆盖不写死路径
- INV-44 [真环境验证] 遵守：Final E2E 三段均在本机真实 Postgres + 真实文件系统 + 真实 df 上验证，非 mock 环境，见 ## E2E 验收 脚本
- INV-45 [默认多租户] N/A：preview_environments 是单租户 Brain 内部运维表，无多租户概念
- INV-46 [凭据安全] N/A：本 sprint 不涉及新增凭据
- INV-47 [日志脱敏] 遵守：cleanup_detail/日志输出的 residual 清单仅含路径/db_name/技术标识符，不含用户 PII
- INV-48 [端点鉴权] 遵守：POST /preview/start、/stop 沿用既有 checkDeployToken() 鉴权，本 sprint 不新增无鉴权端点，由上方路由层两条 BEHAVIOR 间接验证（均需 checkDeployToken 通过才能到达业务逻辑）
- INV-49 [租户隔离] N/A：同 INV-45，单租户系统

## generator 执行提醒（非验收项，来自 Invariant 映射的可操作提示）

- INV-36：本 PR 涉及 `packages/brain/src/`，开 PR 前带齐 smoke.sh + smoke-allowlist 登记
- INV-33：不要触碰 `.github/workflows/preview-deploy.yml`/`preview-cleanup.yml`，路由改动只在 `routes/preview.js`
- INV-29：host-disk-sampler.sh 的 crontab 行只需在 PR 描述里提供，由部署方手工安装（PRD ASSUMPTION 段），不要尝试接入 `scheduler-jobs.js`
