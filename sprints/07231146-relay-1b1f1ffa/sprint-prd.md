# Sprint PRD — preview-capacity-gate-and-destroyer

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：85%（消除 preview 磁盘失控隐患，闭环容量治理与统一销毁）

## 背景

US Mac mini（256G 盘）实测仅剩 28 GiB / 86%，16 个 cecelia_preview_* 库和 worktree 堆积。根因：preview 创建无容量准入；清理散在 3 处、无锁、静默失败（preview-reaper cron PATH 坑导致 dropdb 从未执行）。本 Sprint 一个 PR 交付四件事：宿主磁盘采样、容量准入闸门、统一销毁器、现存资源清扫。

## Golden Path（核心场景）

入口：宿主 cron 每分钟触发磁盘采样 → 经过「准入判定（含并发串行化）→ 创建/使用 → 统一销毁（含幂等/终态复查）」→ 出口：宿主磁盘可用空间维持在安全水位，无残留 preview 资源

具体：
1. 宿主 cron 每分钟执行 `host-disk-sampler.sh`，采样 `data_avail_bytes`（df）与 `apfs_unallocated_bytes`（diskutil），原子写入 `.runtime/host-disk.json`（含 sampled_at_epoch/usage_pct/effective_free_bytes）
2. Brain 收到创建 preview 请求时调用 `admitPreview()`：先 `readHostDisk()` 校验采样新鲜度（距今 >180s 视为 stale，拒绝 + 触发 Bark 告警防静默瘫痪）；再按序判定 active/starting/cleaning 数量 ≥6、`effective_free_bytes - 3.5GiB < 35GiB`、`usage_pct ≥85` 三条红线，全部字节级比较（禁止 GB/GiB 字符串比较）
3. 两个 PR 同时申请 preview 时，准入判定 + 端口扫描 + INSERT 全程包在 `pg_advisory_xact_lock` 内串行执行，消除并发双通过竞态；已存在活跃记录的幂等复用路径（re-push）不重新走准入
4. 准入拒绝时返回 reason/free_bytes/projected_cost_bytes/need_release_bytes，供上游决策
5. PR 关闭（webhook）、preview-reaper 定时巡检、zombie-reaper 孤儿检测三处统一调用 `destroyPreview(prNumber, reason, executionId)`：per-PR advisory lock 串行；已 inactive 直接幂等成功
6. `destroyPreview` 依次执行：状态置 cleaning → 杀进程/端口/PID 文件 → `pg_terminate_backend` 后 `DROP DATABASE`（库名须匹配 `^cecelia_preview_[0-9]+$`）→ `git worktree remove`（fallback `rm -rf` 前必须 realpath 校验路径在 preview 根目录内且非空，否则 abort）→ 清 npm cache/log/lock/临时文件
7. 终态复查库/目录/进程/临时文件四项全零 → 置 inactive；任一残留 → 置 cleanup_failed 并把残留清单写入 cleanup_detail
8. 对现存所有已关闭 PR 或超 24h 的 preview 逐个执行统一销毁器，验证宿主磁盘空闲实测回升

## 边界情况

- 采样文件缺失或 mtime 超 180s → stale_sample 拒绝 + Bark 告警
- 第 7 个 preview 申请时（已有 6 个 active/starting/cleaning）→ 拒绝并返回 need_release_bytes
- 同一 PR webhook + reaper 并发触发销毁 → 实际只执行一次
- dropdb 失败 → cleanup_failed，绝不误标 inactive，残留清单写入 cleanup_detail
- realpath 校验发现路径逃逸 preview 根目录 → abort 不删，置 cleanup_failed
- 对已 inactive 的 PR 重复调用 destroyPreview → 幂等成功

## 范围限定

**在范围内**：宿主磁盘采样器、容量准入闸门（含并发串行化）、统一销毁器（含幂等/终态复查/残留清单）、现存资源批量清扫
**不在范围内**：四档状态机的差异化动作（警戒/紧急档细分）、紧急抢占未到期 preview、Janitor 全量重构、harness worktree 接入同一闸门（本期只 export 接口）

## 假设

- [ASSUMPTION: 宿主 cron 已具备写 ~/perfect21/cecelia-deploy-main/.runtime/ 目录权限，PR 内提供 crontab 行由部署方手工安装]
- [ASSUMPTION: Bark 告警通道已配置可用，容量闸门/采样过期告警复用现有机制]

## 预期受影响文件

- `scripts/host-disk-sampler.sh`：新增，宿主磁盘采样 cron 脚本（显式 PATH，set -euo pipefail）
- `packages/brain/src/capacity-gate.js`：新增，readHostDisk + admitPreview 容量准入逻辑
- `packages/brain/src/preview-destroyer.js`：新增，destroyPreview 统一销毁器
- `scripts/preview-cleanup.sh`：重写为 preview-destroyer.js 的唯一 shell 执行体
- preview_environments 表 migration：新增 'cleaning'/'cleanup_failed' 状态 + cleanup_detail jsonb
- webhook(PR closed) / preview-reaper / zombie-reaper 调用点：改为只调 destroyPreview，删除各自旧删除逻辑
- allocatePreview 相关调用点：接入 admitPreview + advisory lock 串行化

## NFR 约束

<!-- 来源: PrepPRD 显式指定；decisions 表 category=nfr（step+journey_feature 两源）查询均为空数组，无副源补充 -->
- 采样频率: 每 1 分钟（宿主 cron）
- 采样新鲜度: >180s 视为过期，拒绝 + Bark 告警（防静默瘫痪）
- 并发安全: allocatePreview 全程 pg_advisory_xact_lock 串行化；destroyPreview per-PR 独立锁
- 容量红线: `effective_free_bytes - 3.5GiB < 35GiB` 拒绝；`usage_pct ≥85%` 拒绝；active/starting/cleaning ≥6 拒绝（均字节级比较，禁止 GB/GiB 字符串比较）
- 可观测: 采样过期/准入拒绝/销毁残留均需可查（cleanup_detail jsonb + Bark）
- 幂等: destroyPreview 对已 inactive 状态重复调用必须幂等成功
- 安全: DROP DATABASE 前库名须匹配 `^cecelia_preview_[0-9]+$`；rm -rf 前必须 realpath 校验防越权删除

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step 级(golden-path-decisions?category=invariant，空)+ journey_feature 级(ability_id 为空，空)+ area 级(/api/brain/invariants?level=area，49 条)三源合并去重 -->
- [跨扫描测试] 测试若都靠冷启动重置（afterEach 清空 sentinel/sinceMs=0），需补至少一条真实多轮扫描、状态不重置的集成测试（来源: area）
- [重扫去重] 周期性重扫同一批数据若引入外部付费调用(LLM/API)，须同时设计"是否已处理过"前置检查，不能假设重扫不常发生（来源: area）
- [时间常数] 跨模块时间常数（扫描间隔/闲置阈值/缓存TTL等）若彼此有隐含大小关系依赖，须在设计阶段显式写不变量断言（来源: area）
- [环境误判] contract 中 android 关键词即使在排除列表也会触发 theater_mismatch，可用 windows_cloud 环境绕过（来源: area）
- [环境来源] target_environment 必须从 DB tasks.payload 读取，不从文件读，任务注册时须正确设置（来源: area）
- [结果格式] Brain judge .brain-result.json 必须有顶层 exit_code + log_tail + behavior_tests[]，每条含 exit_code+log_tail（来源: area）
- [字段截断] DB 表字段长度约束(如 varchar(100))若来源数据无天然长度保证(如文件路径/目录名)，写入前必须显式截断（来源: area）
- [复活先查] 复活/重做曾经死过的功能前，先用 git log --diff-filter=D + git show <commit> 查清历史原因（来源: area）
- [显式else] 调用"失败不抛异常、返回null/false"契约的函数时，写完 if(成功分支) 必须显式写 else 分支（来源: area）
- [smoke占位] smoke-invariant-1784543934-2387（占位铁律，无具体文本）（来源: area）
- [漏跑探测] journey_features 表 updated_at 长期停滞(明显早于对应PR合并时间)可作为 report 阶段漏跑的兜底探测信号（来源: area）
- [跳步兜底] harness-controller relay 容器可能在 Step6(merge) 后异常退出而跳过 Step7(report)，需兜底补跑（来源: area）
- [白名单核对] contract-proposer 起草 host/环境白名单类断言时必须核对 headed 人工接管场景，避免误判（来源: area）
- [点火写payload] headed relay 点火时必须把 base_repo 或 pr_url 写入 task payload，且分支名带 task 短ID（来源: area）
- [退役实锤] 退役判断依据数据不靠记忆，须查生产库实锤(cursor状态分布/表行数/消费方grep)，避免误删活模块（来源: area）
- [吞错告警] catch 吞错的后台 job 必须带失败计数指标，连续失败超阈值告警（来源: area）
- [建表核对] 表名认领冲突：建新表/复用表前须先 grep 全部写入方，两个模块写同一张表必须 schema 对齐评审（来源: area）
- [落库需消费方] 新增后台 job 必须同时声明消费方，无下游读方的落库 job 不允许上线（来源: area）
- [多端UI] 多设备类型(os_type/device_platform) UI 区分必须在设计/审查阶段强制检查（来源: area）
- [语义一致] 同一语义(如 git_sha=unknown) 在判变端与终验端必须用同一处理策略，跨脚本语义分叉会开假绿面（来源: area）
- [ref校验] git rev-parse 判 ref 存在必须带 --verify "<ref>^{commit}"，裸 rev-parse 不可靠（来源: area）
- [越权核对] smoke/测试用真实 worktree 当 CECELIA_DEPLOY_ROOT 时，必须核对被测脚本会不会向上触碰生产资源（来源: area）
- [失败硬退] 部署链任何失败路径禁止 warning 降级：须显式 FAIL 变量 + Bark + exit 非零（来源: area）
- [判变基准] 判变基准永远用"生产实体自报"(build-info.json/health.git_sha)对账 origin/main，禁用其他来源（来源: area）
- [测试异步] lint-test-quality 要求 await fn() ≥1，读源码必须包装 async function，不能直接 readFileSync（来源: area）
- [合同表格式] Test Contract 表格固定4列格式，testFile 用反引号包裹，checker 从第3列解析路径（来源: area）
- [Red精确add] Red commit 必须只 git add 精确路径(*.test.ts)，禁止 git add . 或 git add .harness（来源: area）
- [回归验证法] 回归测试用 source-code inspection 验证调度接线比 mock 覆盖更直接有效（来源: area）
- [cron接线] 新增 cron 功能首先检查 scheduler-jobs.js 的 JOBS，tick-runner.js 是 deprecated 路径（来源: area）
- [禁自merge] harness-generator 禁止自行 merge PR，merge 权归 controller（来源: area）
- [tmux环境] headed relay 的 tmux innerCmd 启动的子 shell 不自动继承父进程环境变量（来源: area）
- [合同复用核对] Proposer 复用历史合同模板(尤其E2E验收断言)时必须先核对本次任务的真实派发/执行历史，不能假设与先例路径相同（来源: area）
- [CI文件禁区] harness-generator skill 增加共享CI基础设施文件默认禁区规则(.github/workflows/*.yml等)（来源: area）
- [提前合并] PR 被 should-auto-merge.sh 等 CI 侧兜底机制在 evaluator/judge 跑完前提前合并时，须特殊处理（来源: area）
- [smoke占位2] smoke-invariant-1783850042-79911（占位铁律，无具体文本）（来源: area）
- [PR带smoke] feat+brain/src PR 开PR前须直接一次带齐 smoke.sh + smoke-allowlist 登记，不能等CI（来源: area）
- [新类型接线] 新 task_type 接线用七点清单：CHECK约束/task-router四表/EXECUTOR_KIND_FOR 等（来源: area）
- [存活双信号] 服务"该活着"的判定用双信号：launchctl 状态 + 端口监听，单看 launchd 会漏 nohup 孤儿宕机（来源: area）
- [禁用LaunchAgents] 本机(美国 Mac mini) 禁止再往 ~/Library/LaunchAgents 放需要常驻的服务，gui 域不存在（来源: area）
- [服务登记] 新增常驻宿主服务时，必须同步加进 packages/brain/src/launchd-patrol.js 的 manifest（来源: area）
- [smoke占位3] smoke-invariant-1783693282-93097（占位铁律，无具体文本）（来源: area）
- [单slot串行] 单 slot 串行任务，并行只许跨 slot（来源: area）
- [禁写死环境] 禁止写死环境假设值（来源: area）
- [真环境验证] 真环境验证才算 done（来源: area）
- [默认多租户] 测试默认多租户（来源: area）
- [凭据安全] 凭据安全（来源: area）
- [日志脱敏] 日志脱敏（来源: area）
- [端点鉴权] 端点鉴权（来源: area）
- [租户隔离] 租户隔离（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path；journey_id 为空（本任务非 /dev 路径 C 点火），优雅降级为无历史 -->
- （本 line 暂无历史）

## E2E 验收

> Planner 初稿此区块留空（只写占位 + 期望验收点的自然语言描述）。最终可执行的 E2E 脚本由 proposer 在 GAN 阶段产出（target_environment=local_api，用 curl + psql + 本地 shell 脚本模板），写进 contract-draft.md 的 `## E2E 验收` 区块。

```bash
# 占位：proposer 将按 target_environment=local_api 填入真实脚本（curl localhost:5221/api/brain/* + psql + 本地 shell）
# 期望验收点（自然语言）：
# 1. 真实走一遍：采样器落 JSON → allocatePreview 准入 → 创建 → destroyPreview
#    → psql -lqt 确认库为 0、worktree 目录不存在、无残留进程
# 2. 在 cron 等价环境（env -i PATH=/usr/bin:/bin + 脚本自带 PATH 修正）执行
#    destroyer shell 路径，全流程成功
# 3. 对现存过期 preview 批量销毁后，宿主 df 实测 avail 上升，记录前后字节数
```

## journey_type: autonomous
## journey_type_reason: 全部改动落在 packages/brain/src/（capacity-gate.js/preview-destroyer.js）+ scripts/（host-disk-sampler.sh/preview-cleanup.sh），无 apps/dashboard、无 agent_remote 协议、无 packages/engine 改动，按优先级链归类为 autonomous（纯后端容量治理/调度）
## target_environment: local_api
## target_environment_reason: Final E2E 通过 localhost:5221 Brain API + psql + 本地 shell/cron 脚本在本机（US Mac mini，Brain 所在宿主）验证，无 UI/浏览器/Windows 依赖
## journey_id: none
## step_id: none（PrepPRD 未锚定）
