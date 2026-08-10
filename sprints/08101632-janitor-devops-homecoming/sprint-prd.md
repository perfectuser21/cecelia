# Sprint PRD — janitor 归位 Cecelia DevOps：迁入 scripts/ops + 五处失效修复 + 死化石清理

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：85%（三次盘满事故的根因回收器归位，静默失效终结）

## 背景

janitor.sh 是纯 bash cron 脚本（无 LLM），却住在 zenithjoy-skills（skill SSOT 仓，存 LLM 指令）。分类错误导致跨仓引用腐烂，三次盘满事故（07-15/07-17/08-10）的回收器全部静默失效。决策 c14a3e6f 拍板：janitor 是 Cecelia DevOps 一员，迁入 cecelia 仓 scripts/ops/。

## Golden Path（核心场景）

系统到点（cron 13:00 LA）→ janitor 在新家 `scripts/ops/janitor.sh` 运行 → 全部 10 步真实执行 → 结束时台账追加一行 → 有残留未清理则退出码非零+告警入 Brain

具体：

1. cron 触发 `~/bin/janitor.sh`（软链指向 cecelia 仓 `scripts/ops/janitor.sh`）
2. 每步执行后输出"检测 N / 清理 M"；若 N>0 且 M=0 → 记 FAIL + 步骤号
3. 步骤8：内联孤儿分支清理（已 merge 到 main + 无 open PR + 无 worktree 引用 → 删本地分支；无 branch-gc.sh 引用）
4. 步骤9：扫描 `~/worktrees/cecelia/*` + `~/worktrees/zenithjoy/*`，用 `git worktree list --porcelain` 比对识别真孤儿（目录存在但 git 未注册）；age>24h 且无 open PR 才删；Guard A 三查（git status 未提交 / .dev-lock* / .dev-mode.*）保护活 worktree
5. 磁盘超 70% 时 POST Brain 告警任务，description 含磁盘水位+各步残留摘要（非空，pre-flight 可放行）
6. 运行结束追加一行到 `~/logs/janitor-ledger.csv`：ts,used_pct,avail_gb,orphan_worktrees,stale_images,failed_steps
7. `packages/workflows/skills/janitor/` 整个目录从 cecelia 仓删除（死化石）

## 边界情况

- 活 worktree 三查中任一命中 → 不删，不记 FAIL（保护优先）
- 分支三条件未全满足 → 不删，不记 FAIL
- `~/logs/` 目录不存在时自动创建，台账追加不影响主流程退出码
- Brain API 不可达时告警降级为本地 log，不阻断主流程
- `--dry-run` / `--mode daily` 参数：dry-run 只输出检测数不执行清理，退出码 0

## 范围限定

**在范围内**：
- janitor.sh 从 zenithjoy-skills 迁入 `scripts/ops/janitor.sh`，保留全部现有防线
- 五处修复：步骤8虚构依赖/步骤9扫错目录/自验断言/告警 description/水位台账
- 测试迁入（`__tests__/` 按 cecelia 惯例落位）并接入 CI
- 删除 `packages/workflows/skills/janitor/` 死化石目录

**不在范围内**：
- preview-reaper.sh（PR#4759 已修，勿动）
- cron 调度时间（不变）
- `~/bin/janitor.sh` 软链切换（合并后宿主动作）
- zenithjoy-skills 旧目录删除（合并后跟进）
- memory_stream 保留策略 / preview 瘦克隆

## 假设

- [ASSUMPTION: gh auth 在 CI 沙箱中已配置，步骤8 `gh pr list` 调用可用]
- [ASSUMPTION: 源文件从 zenithjoy-skills 克隆获取，版本 v4.0 约 26KB]
- [ASSUMPTION: `~/logs/` 路径在宿主机存在或可创建，不在任何清理路径内]

## 预期受影响文件

- `scripts/ops/janitor.sh`：新建，从 zenithjoy-skills janitor/janitor.sh 迁入并修复
- `packages/engine/__tests__/janitor/`（或 `scripts/ops/__tests__/`）：测试落位
- `.github/workflows/engine-ci.yml`（或适当 CI 文件）：接入 janitor 测试
- `packages/workflows/skills/janitor/`：整目录删除

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 超时/延迟：janitor 单次运行上限 30 分钟（cron 调度间隔 24h，不超即可）
- 频控：每日 cron 一次，不额外频控
- 版本要求：bash ≥ 4.0（macOS 默认 3.x 需用 `#!/usr/bin/env bash` + 规避 associative array）
- 可观测：每步必须输出"检测 N / 清理 M"；失败必须写 Brain 告警 + ledger 台账

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重 -->
- [真环境验证] 验收必须真实执行并确认 exit code，不能仅凭"测试通过"空话收尾（来源: area）
- [禁写死环境假设] 脚本中禁止写死路径/hostname，必须从环境变量或动态探测获取（来源: area）
- [合同验证命令实跑] 合同里的验证命令必须先实跑确认 exit code 语义，写进合同前跑一次（来源: area）
- [FAIL 显式化] 任何失败路径禁止 warning 降级，必须显式 FAIL 变量 + exit 非零（来源: area）
- [Guard A 三查] 活 worktree（git 在册/有未提交改动/含 .dev-lock*）绝不删除（来源: PrepPRD 历史教训 PR#3694/#3702）
- [告警 description 非空] POST Brain 任务时 description 不能为空，否则 pre-flight 拒收（来源: PrepPRD 已知失效#4）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

（本 line 暂无历史——journey 91c17939 golden-paths 为空，首次 sprint）

## E2E 验收

```bash
# 占位：proposer 将按 target_environment=local_api 填入真实脚本（bash + 本地执行）
# 期望验收点（自然语言）：
# 1. 单测：构造假孤儿 worktree（目录存在但 git 未注册 + mtime>24h + 无 open PR）
#    → 断言 janitor 步骤9 识别并清理，退出码 0
# 2. 单测：活 worktree 三查（git 在册 / 有未提交改动 / 含 .dev-lock）→ 逐一断言不删
# 3. 单测：模拟"检测到残留 N>0 但清理 M=0" → 断言退出码非零且日志含 FAIL 与步骤号
# 4. 单测：告警 POST body → 断言 description 非空且含磁盘百分比数字
# 5. 单测：步骤8 → grep 断言不含 branch-gc.sh；孤儿分支三条件有独立用例
# 6. smoke：janitor.sh --mode daily 在 CI 沙箱 dry-run 退出码 0，台账文件新增恰好一行
# 7. 回归：既有 janitor 测试（etime/常驻豁免/audiomxd）迁入后全绿
# 8. repo 断言：packages/workflows/skills/janitor/ 目录不存在
# 9. CI 全绿
```

## journey_type: dev_pipeline
## journey_type_reason: 涉及 packages/engine 管辖的 hooks/scripts/ops 运维脚本迁移与修复，属开发流水线维护
## target_environment: local_api
## target_environment_reason: 纯 bash 脚本 + Brain API curl 验证，在本地 evaluator 执行（localhost:5221 + 本地文件系统）
## journey_id: 91c17939-225c-4491-92f3-67d8b0ace4d9
## step_id: keep-green
