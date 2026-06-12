# Sprint PRD — harness-report.mjs 脚本化 + 宿主 git 零接触（R3）

## OKR 对齐

- **对应 KR**：Cecelia Harness Pipeline 可靠性 / Deterministic Gate 第 5/7 条
- **当前进度**：Gate 条目 4/7 已完成
- **本次推进预期**：Gate 第 5 条（report 阶段脚本化）打通

## 背景

reportNode 现在派发 `harness_report` 子任务，路由到 `/harness-report` skill；但 skill 内 9 段 bash 写在 SKILL.md，无测试，已有 awk 损坏 + thickness 枚举过时。两次实证均因在宿主仓库 mount 上执行 git 命令导致越界。前次 run 因 contract-gate 钝规则窗口期误报 failed，规则已三轮进化（#3351/#3353/#3357）；本次 R3 在稳定规则上重发。

## Golden Path（单线性）

用户/系统从 [reportNode 派发 harness_report 子任务] → 经过 [harness-report.mjs 脚本 7 步顺序执行] → 到达 [报告产物落盘 + Brain API 回写完毕 + 宿主 git 状态不变]

具体：

1. **入口**：`node packages/brain/scripts/harness-report.mjs --sprint-dir <dir> --task-id <id> --pr-url <url> --feature-id <fid>` 被调用（可 CLI 直调，也可 skill runner 调）
2. **步骤**：
   - S1：读 sprint-dir 下产物清单（contract-draft.md / evaluator-output.json 等），提取元数据
   - S2：生成 `<sprint-dir>/harness-report.md`（摘要、DoD 结果、步骤耗时、GAN 轮数）
   - S3：生成 `<sprint-dir>/learning.md`（洞察段；无 LLM 时写占位，有 LLM 可选调用）
   - S4：生成 `<sprint-dir>/index.html`（静态可读版）
   - S5：Brain API 回写 — PATCH tasks/{task-id} result（含 pr_url）
   - S6：Brain API 回写 — PATCH journey_features/{feature-id} status=done
   - S7：Brain API 回写 — POST notes（Report note 关联 task）
3. **出口**：
   - 所有步骤成功 → 退出码 0，stdout 打印各文件路径 + 回写确认
   - 部分步骤失败（如 Notion 502）→ 继续剩余步骤，结尾输出 `PARTIAL_FAIL` 摘要 + 非零退出码
4. **幂等验证**：同命令重复执行 → 退出码 0，文件内容覆写一致，API 回写幂等（PATCH 同值）
5. **git 零接触**：执行前后 `git status --porcelain` 与 `git branch --show-current` 完全一致，报告产物均为 untracked 文件

## 边界情况

- Notion / Brain API 单步 502/timeout：不中断其余步骤，仅记录失败，结尾汇报
- sprint-dir 缺产物（evaluator-output.json 不存在）：生成降级报告（字段填 N/A），不崩溃
- 重复跑：文件覆写 + API PATCH 同值，退出码 0
- 宿主 repo 有脏工作区：脚本不执行任何 git 命令，原样保留
- feature-id 为空：跳过 S6，不报错

## 范围限定

**在范围内**：
- `packages/brain/scripts/harness-report.mjs`（新脚本，7 步顺序执行）
- `packages/brain/scripts/__tests__/harness-report.test.mjs`（vitest 覆盖核心逻辑 + 接线）
- reportNode 调用路径改为优先 spawn 本脚本（替换旧 SKILL.md bash 段）
- 修复 awk 损坏（表名提取改 `$2`）+ thickness 枚举过时

**不在范围内**：
- 修改宿主 repo 任何文件
- LLM 强制依赖（learning 洞察段可选）
- 新增 Brain API 端点
- Dashboard UI 变更

## 假设

- [ASSUMPTION: Brain API localhost:5221 在执行环境可访问]
- [ASSUMPTION: sprint-dir 路径由调用方保证可写，脚本不自行 mkdir sprint 之外的目录]
- [ASSUMPTION: feature-id 对应 journey_features 表记录已存在]
- [ASSUMPTION: harness-report sub-task payload 含 sprint_dir / task_id / pr_url / feature_id 四个字段]

## 预期受影响文件

- `packages/brain/scripts/harness-report.mjs`：新建，7 步顺序报告脚本
- `packages/brain/scripts/__tests__/harness-report.test.mjs`：新建，vitest 单测
- `packages/brain/src/workflows/harness-initiative.graph.js`：reportNode spawn 调用改为执行本脚本（替旧 skill bash）
- `packages/brain/src/task-router.js`：确认 `harness_report` → `local_api` 路由无需改动（[ASSUMPTION: 已正确]）

## E2E 验收

> 最终可执行脚本由 proposer 在 GAN 阶段产出（target_environment=local_api → bash + curl + psql）。

```bash
# 期望验收点（自然语言）：
# 1. 构造 fixture sprint-dir（含最小产物文件），调用 harness-report.mjs
#    → harness-report.md / learning.md / index.html 三文件存在，关键字段非空
# 2. Brain API 回写验证：curl GET tasks/{id} → result.pr_url 非空；
#    curl GET journey_features/{fid} → status=done
# 3. 同命令重跑 → 退出码 0，文件 mtime 更新，内容一致
# 4. git status --porcelain 执行前后输出字节对比相等（断言 diff=""）
# 5. 模拟 S5 Brain 502 → 其余步骤继续，退出码非零，输出含 PARTIAL_FAIL
```

## journey_type: autonomous
## journey_type_reason: 纯后端脚本（packages/brain/scripts/）+ Brain API 回写，无 UI 交互
## target_environment: local_api
## target_environment_reason: curl localhost:5221 + psql 本地验证；无浏览器/Windows/生产服务器依赖
## journey_id: cecelia-harness-pipeline
## step_id: report-scriptize-r3
