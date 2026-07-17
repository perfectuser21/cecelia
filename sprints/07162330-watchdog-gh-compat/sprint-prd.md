# Sprint PRD — watchdog CI查询兼容老版gh + 仓库映射补 zenithjoy-skills

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环（82%）
- **当前进度**：82%
- **本次推进预期**：84%（自愈链 CI 救援恢复可用）

## 背景

07-16 自愈链首夜实战暴露两个剧场差异 bug：①容器内 gh 版本不支持 `pr checks --json`，导致 A1/A5 CI 救援每轮『CI 状态查询失败保守跳过』——宿主机测全绿、生产容器全废；②W3 的 PR 在 zenithjoy-skills 已 MERGED，但 HARNESS_REPO_MAP 默认表无 skills 仓，finalize/反查失明，任务挂 in_progress 4 小时，三个死跑 W1/W3/W5 全靠人工救场。

## Golden Path（核心场景）

watchdog 自愈链在生产容器内执行 CI 状态判定，并能正确解析 zenithjoy-skills 仓库的 PR URL。

具体：

1. **[触发条件]** watchdog 检测到某任务 PR 的 CI 状态需要判定（自愈链 A1/A5 阶段）
2. **[CI 查询路径]** 调用 `gh pr view <pr_url> --json statusCheckRollup,mergeStateStatus` 而非 `gh pr checks --json state`（老版 gh 不支持 checks 子命令的 --json 标志）；解析逻辑：存在 FAILURE → ci_red；全 SUCCESS → green；其余 → pending；保留 execTolerant 容错
3. **[仓库反查路径]** 调用 `_parseBaseRepo('/Users/administrator/perfect21/zenithjoy-skills')` 返回 `perfectuser21/zenithjoy-skills`；finalize 阶段 PR 反查不再失明
4. **[可观测结果]** CI 红任务被正确识别为 ci_red 并触发重点火；zenithjoy-skills PR 合并后任务状态正常 completed

## 边界情况

- 老版 gh 对 `pr checks --json` 报 "unknown flag: --json" 或 "unknown subcommand" 类错误且无 stdout → 必须走 pr view 路径，不得保守跳过
- pr view 输出 statusCheckRollup 为空数组 → 判定为 pending（无检查项时保守）
- zenithjoy-skills 路径同时满足 cecelia base_repo 和 zenithjoy-skills → 映射表精确匹配

## 范围限定

**在范围内**：
- `packages/brain/src/harness-relay-watchdog.js` CI 查询逻辑替换
- `packages/brain/src/harness-relay-watchdog.js` `_parseBaseRepo` 默认映射表补 zenithjoy-skills
- 对应失败测试（先写 failing，修后 passing）
- 部署后容器内 `docker exec` 真验

**不在范围内**：
- 其他 watchdog 逻辑（A2/A3/A4 阶段行为）
- gh 客户端升级
- 其他仓库映射

## 假设

- [ASSUMPTION: 生产容器 gh 版本支持 `gh pr view --json statusCheckRollup`（A5 PRD 给过此备选）]
- [ASSUMPTION: execTolerant 已有实现，本次只替换调用参数和解析逻辑]
- [ASSUMPTION: zenithjoy-skills 仓库 owner 为 perfectuser21]

## 预期受影响文件

- `packages/brain/src/harness-relay-watchdog.js`：CI 查询改为 pr view statusCheckRollup + 映射表补 zenithjoy-skills
- `packages/brain/tests/harness-relay-watchdog.test.js`（或对应测试文件）：新增 2 个 failing test（老版 gh 报错路径 + _parseBaseRepo zenithjoy-skills）

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 超时/延迟：待定（PrepPRD 未指定，沿用 execTolerant 已有超时）
- 频控：N/A
- 版本要求：生产容器内 gh 须支持 `gh pr view --json`（老版本命令，而非 checks 子命令）
- 可观测：修复后必须在生产容器 docker exec 真跑一次 `gh pr view --json statusCheckRollup` 并附原文到 behavior_tests

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重 -->
- [单slot串行] 同一 slot/会话内严格串行执行任务，前一个收口后才起下一个（来源: area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [端点鉴权] 每个 API 端点必须有 auth；无鉴权端点不准 ship（来源: area）
- [租户隔离] 碰租户数据的查询/写入必须 scope 到当前租户（来源: area）
- [真环境验证] 接缝断言必须在真目标上验证过才算 done（来源: area）
- [禁止写死环境假设值] 环境假设值禁止写死，要么从环境推导要么真机校准（来源: area）
- [generator不得自merge] 禁止 generator 自行 merge PR，merge 权归 controller（来源: area）
- [共享CI禁区] .github/workflows/*.yml、smoke-allowlist.txt 等跨 sprint 共享文件未经合同显式授权不可修改（来源: area）
- [实测老版gh行为] 测试必须覆盖『容器内老 gh』行为，mock 按真实老版 gh 的报错原文，禁 mock 掉版本差异（来源: thin_prd 显式铁律）
- [failing test先行] 必须先写能复现的 failing test，修完 test 再修代码，test 必须 commit 进 repo 永久留在 CI（来源: thin_prd 显式铁律）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->
（本 line 暂无历史——journey_id 未设定，无法从 journeys API 加载累积 FR）

## E2E 验收

> 最终可执行 E2E 脚本由 proposer 在 GAN 阶段产出（target_environment=local_api，bash 模板）。

```bash
# 占位：proposer 将按 target_environment=local_api 填入真实脚本
# 期望验收点（自然语言）：
# 1. failing test ① — mock execFn 对 pr checks 抛 "unknown flag: --json" 且无 stdout
#    → 现版本 resumed=0（保守跳过）；修复后 gh pr view 路径正确判定 ci_red 并重点火
# 2. failing test ② — _parseBaseRepo('/Users/administrator/perfect21/zenithjoy-skills')
#    → 现版本返回 null；修复后返回 'perfectuser21/zenithjoy-skills'
# 3. 既有 A1/A5/A2 测试全 PASS（回归保护）
# 4. 部署后在生产容器内：
#    docker exec <container> gh pr view <test_pr_url> --json statusCheckRollup
#    附原文输出到 behavior_tests（证明兼容）
```

## journey_type: autonomous
## journey_type_reason: 纯 packages/brain/src/ 后端逻辑修改，无 UI，无 agent 协议，无 engine hooks
## target_environment: local_api
## target_environment_reason: 修改 harness-relay-watchdog.js 后端逻辑，E2E 验收用 curl localhost:5221 + jest 本地跑，部署后附容器内真验
## journey_id: none
## step_id: none（PrepPRD 未锚定）
