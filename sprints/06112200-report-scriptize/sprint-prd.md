# Sprint PRD — harness-report.mjs 脚本化（机械段下沉 + 幂等 + 宿主 git 隔离）

## OKR 对齐

- **对应 KR**：Cecelia Harness Pipeline 可靠性（Deterministic Gate 第 5/7 条）
- **当前进度**：待 Brain 上线后确认
- **本次推进预期**：消除 report 阶段 git 越界与脚本腐烂根因

## 背景

reportNode 派 harness_report 子任务时，9 大步骤写在 SKILL.md（markdown 内 bash，无测试无 lint），已出现 awk 模板损坏、thickness 枚举过时两个 stale；且两次实证 report 阶段在宿主仓库 mount 上直接 git checkout/commit，污染宿主工作树。本 sprint 把机械段下沉为 `packages/brain/scripts/harness-report.mjs`，reportNode 改为优先调此脚本。

## Golden Path（核心场景）

用户/系统从 [sprint 完成] → 经过 [CLI 脚本一命令产报告 + Brain 回写] → 到达 [产物落盘 + DB 状态同步 + 宿主 git 不变]

具体步骤：

1. **入口**：调用 `node packages/brain/scripts/harness-report.mjs --sprint-dir <dir> --task-id <id> --pr-url <url> --feature-id <fid>`
2. **脚本执行**（每步独立 try/catch，单步失败不中断其余步骤）：
   - a. 在 sprint-dir 下生成 `harness-report.md` / `learning.md` / `index.html`（LLM 洞察段标"待补"，无 LLM 也能完整出报告）
   - b. PATCH `tasks/{id}` status=completed + result（Brain API 回写）
   - c. PATCH `journey_features/{fid}` 仅发 `{"status":"done"}`（修 stale：不发 thickness 字段——thickness 无 done 枚举值）
   - d. Upsert api_registry / test_registry（ON CONFLICT DO NOTHING 或 upsert）
   - e. POST Report note 关联到对应 task
   - f. 结尾输出 ✅/❌ 分步汇总；部分失败 → 退出码 1，全部成功 → 退出码 0
3. **幂等验证**：同命令重复跑 → Brain API 调用无重复插入，退出码 0
4. **出口可观测**：执行前后 `git -C <宿主> status --porcelain` 输出不变、`git branch --show-current` 不变；脚本不做任何宿主 git 写操作，报告产物仅以 untracked 文件落盘

## 边界情况

- sprint-prd.md / contract-draft.md 不存在 → 对应步骤 WARN+跳过，不中断流程
- Brain API 5xx（如 Notion 502） → 该步骤记 FAIL，后续步骤继续执行，结尾汇总清单 + 非零退出码
- 重跑：api_registry / test_registry 行已存在 → ON CONFLICT DO NOTHING（不报错）

## 范围限定

**在范围内**：
- `packages/brain/scripts/harness-report.mjs` 脚本（新增）
- `reportNode` 改为 import 并优先调脚本（机械段）
- vitest 单测：脚本核心函数 + reportNode 接线
- 修 2 个已知 stale：`thickness:"done"` → 移除 thickness 字段；DB 表名 awk `print $NF` → `print $2`

**不在范围内**：
- SKILL.md 仓库侧瘦身（另行 PR）
- LLM 洞察段实际 AI 调用实现
- Notion/飞书推送逻辑（仍由 harness_report task 走现有 Phase B SKILL.md）
- 凭据/URL 新增配置

## 假设

- [ASSUMPTION: "宿主 git" 指调用脚本时 CWD 所在的 git repo（即 /workspace）；脚本对其不做任何 git 操作]
- [ASSUMPTION: Notion/飞书推送仍走现有 harness_report task SKILL.md Phase B；本脚本只覆盖 Brain 侧机械回写]
- [ASSUMPTION: api_registry / test_registry 幂等策略沿用现有表 unique 约束 + ON CONFLICT DO NOTHING]
- [ASSUMPTION: fixture sprint-dir 由 proposer 从现有 sprints/ 某个已完成 sprint 构造，含 sprint-prd.md + contract-draft.md]

## 预期受影响文件

- `packages/brain/scripts/harness-report.mjs`：新增（脚本主体）
- `packages/brain/src/workflows/harness-initiative.graph.js`：reportNode 机械段改为调脚本（line ~1264）
- `packages/brain/src/__tests__/harness-report-script.test.js`：新增 vitest 单测
- （stale 修复两处已在脚本内实现，SKILL.md 不在本 sprint 改动范围）

## E2E 验收

```bash
# 占位：proposer 将按 target_environment=local_api 填入真实 bash 验收脚本
# 期望验收点（自然语言）：
# 1. 用已有 fixture sprint-dir 跑脚本一遍 → harness-report.md / learning.md / index.html 存在，退出码 0
# 2. 同命令再跑一遍（幂等） → 退出码 0，Brain DB 无重复记录（api_registry/test_registry 行数不变）
# 3. 两次运行前后：
#    git -C /workspace status --porcelain  → 输出完全一致（无新增/修改/暂存）
#    git -C /workspace branch --show-current → 分支名不变
# 4. vitest packages/brain/src/__tests__/harness-report-script.test.js → 全部 PASS
```

## journey_type: autonomous
## journey_type_reason: 纯 packages/brain/ 后端脚本 + Brain API 回写，无 UI、无 Windows、无 agent 协议
## target_environment: local_api
## target_environment_reason: curl localhost:5221 + psql cecelia，本机 evaluator 执行，无需远端机器
## journey_id: （来源 task.payload.journey_id，由 /dev 路径 C 点火时写入）
## step_id: harness-report-scriptize
