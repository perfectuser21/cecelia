# Sprint PRD: janitor 归位 Cecelia DevOps
<!-- 此 PRD 由 harness-planner 生成，基于 prep_prd_body -->
<!-- TASK_ID: 61f7a4dd-4635-4bbd-a80d-eae1e91cbbe5 -->

## 背景与目标

janitor.sh 是纯 bash cron 脚本（无 LLM），却住在 zenithjoy-skills（skill SSOT 仓，存 LLM 指令）。分类错误导致跨仓引用腐烂，三次盘满事故（07-15/07-17/08-10）的回收器全部静默失效。用户拍板（决策 c14a3e6f）：janitor 是 Cecelia DevOps 一员，脚本迁入 cecelia 仓 `scripts/ops/`。

## Golden Path（本次必须实现）

1. 系统到点（cron 13:00 LA）→ janitor daily 在新家 `scripts/ops/janitor.sh` 运行 → 全部 10 步真实执行，无一步引用不存在的文件
2. janitor 扫描 `~/worktrees/cecelia/*` 与 `~/worktrees/zenithjoy/*` → 用 `git worktree list --porcelain` 比对识别真孤儿（未注册目录）→ age>24h 且无 open PR 的被删除 → 活 worktree（git 在册/有未提交改动/含 .dev-lock*）绝不删
3. 任一步"检测到残留 N>0 但清理 M=0" → 该步记 FAIL → 脚本结尾汇总退出码非零 + 告警 → 主理人从日志/告警一眼看到哪个回收器失效（不再假绿）
4. 磁盘超 70% → janitor POST Brain 告警任务，description 非空（含磁盘水位+各步残留摘要）→ pre-flight 放行 → 告警真正进入处理流程
5. 每次运行结束 → 持久台账（非 /tmp）追加一行：时间戳+磁盘用量%+可用GB+各类残留统计 → 下次排查"磁盘为什么高"30秒可答

## 必须实现（技术清单）

1. **迁移**：`scripts/ops/janitor.sh` 从 zenithjoy-skills 现版本迁入，保留全部现有行为；测试按 cecelia 仓惯例落位并接入 CI
2. **步骤8修复**：删除对 branch-gc.sh 的引用（该文件两仓从未存在过，是虚构依赖）。孤儿分支清理逻辑内联：已 merge 到 main 且无 open PR 引用且无 worktree 引用的 cp-* 分支 → 删除本地分支；禁止再引用任何外部脚本文件而不校验存在性
3. **步骤9修复**：扫描目标改为 `~/worktrees/cecelia/*` + `~/worktrees/zenithjoy/*`；用 `git worktree list --porcelain` 输出比对识别"目录存在但 git 未注册"的真孤儿；保留 age>24h 且无 open PR 判断；活体保护三查（git status 未提交 / .dev-lock* / .dev-mode.*）必须保留（Guard A 教训，PR#3694/#3702）
4. **自验断言**：每步输出"检测 N / 清理 M"；N>0 且 M=0 → 该步 FAIL；结尾汇总 FAIL>0 → 退出码非零 + 告警。禁止静默假绿
5. **告警修复**：POST /api/brain/tasks 的 body 必带非空 description（磁盘水位+残留摘要），杜绝 pre-flight "Task description is empty" 拒收
6. **水位台账**：每次运行追加一行到持久路径 `~/logs/janitor-ledger.csv`（不在任何清理路径内）：ts,used_pct,avail_gb,orphan_worktrees,stale_images,failed_steps
7. **删死化石**：删除 cecelia 仓 `packages/workflows/skills/janitor/` 整个目录（迁移提交 0bb9fbdaef 未完成的收尾，其 SKILL.md 停在 v2.0.0 与真身漂移）

## 不包含（边界）

- preview-reaper.sh（PR#4759 已修，勿动）
- cron 调度时间不变；`~/bin/janitor.sh` 软链切换是合并后的宿主动作，不在本 PR
- zenithjoy-skills 仓旧目录删除（合并后跟进小 PR）
- memory_stream 保留策略 / preview 瘦克隆（待主理人拍板后另立 Sprint）

## Invariant 约束

- preview-reaper.sh 不动（PR#4759 已修）
- 不改 cron 调度时间
- Guard A 三查必须保留（git status 未提交 / .dev-lock* / .dev-mode.*）
- 不引用不存在的外部脚本文件
- janitor.sh 迁入后保留所有现有行为与防线（etime 八进制修复#179 / cecelia 常驻路径豁免+kill后复查#181 / audiomxd taskpolicy#180 / container prune until=1h #185 / TTY+tmux 祖先保护#162）
- 告警 description 必须非空（含磁盘水位+残留摘要）
- 持久台账路径 `~/logs/janitor-ledger.csv` 不在任何清理路径内
- `packages/workflows/skills/janitor/` 必须删除
- 步骤8三条件：已 merge 到 main + 无 open PR + 无 worktree 引用（三条件同时满足才删）
- worktree 孤儿判断用 `git worktree list --porcelain` 比对（目录存在但未注册）
- N>0 且 M=0 → 该步 FAIL + 退出码非零

## 累积 FR

- FR-1：janitor.sh 迁入 `scripts/ops/janitor.sh`，保留全部现有行为与防线
- FR-2：步骤8内联孤儿分支清理（已 merge+无 open PR+无 worktree 引用三条件），删除对 branch-gc.sh 的虚构引用
- FR-3：步骤9扫描 `~/worktrees/cecelia/*` + `~/worktrees/zenithjoy/*`，用 porcelain 比对识别真孤儿
- FR-4：每步输出"检测 N / 清理 M"，N>0 且 M=0 → FAIL，脚本结尾汇总退出码
- FR-5：告警 POST body 含非空 description（磁盘水位+各步残留摘要）
- FR-6：持久台账 `~/logs/janitor-ledger.csv` 每次运行追加一行
- FR-7：删除 `packages/workflows/skills/janitor/` 死化石目录
- FR-8：测试文件从 zenithjoy-skills/janitor/__tests__/ 迁入，接入 CI

## NFR

- 性能：不影响现有 janitor 运行时间
- 安全：不新增外部网络调用
- 可靠性：水位台账写入失败不影响 janitor 主流程
- 兼容性：迁移后行为与原版 100% 一致

## 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| worktree 是否孤儿 | mtime 判断 / git worktree list --porcelain 比对 | porcelain 比对（目录存在但未注册） | mtime 会误判活跃但久未动的 worktree | 误删活 worktree=丢未提交改动（Guard A 三查兜底） |
| 分支是否可删 | 名字匹配 cp-* / gh pr list 无 open PR 且已 merge | 已 merge 到 main 且无 open PR 且无 worktree 引用 | 三条件同时满足才删 | 误删未合分支=丢代码（git 对象 90 天内可恢复） |
| 步骤是否假绿 | 只看退出码 / 检测数 vs 清理数比对 | N>0 且 M=0 → FAIL | 退出码骗了我们一个月 | 误报 FAIL=多一条告警（可容忍，宁误报不漏报） |

## 验收标准（Final E2E）

- [ ] 单测：构造假孤儿 worktree（未注册+mtime>24h+无PR）→ 断言被识别并清理
- [ ] 单测：活 worktree 三查（git 在册 / 有未提交改动 / 含 .dev-lock）→ 逐一断言不删
- [ ] 单测：模拟"检测到残留但清理0" → 断言退出码非零且日志含 FAIL 与步骤号
- [ ] 单测：告警 POST body → 断言 description 非空且含磁盘百分比数字
- [ ] 单测：步骤8 → 断言不再引用 branch-gc.sh（grep 断言），孤儿分支三条件逻辑有独立用例
- [ ] smoke：janitor.sh --mode daily 在 CI 沙箱 dry-run 退出码 0，台账文件新增恰好一行
- [ ] 回归：既有 janitor 测试（etime/常驻豁免/audiomxd）迁入后全绿
- [ ] repo 断言：packages/workflows/skills/janitor/ 目录不存在
- [ ] CI 全绿

journey_type: devops_migration
target_environment: local_api
