# Sprint PRD — auto-merge GH_TOKEN → GH_PAT_BOT 修复（loop-prevention 结构性 bug）

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环（82%）
- **当前进度**：82%
- **本次推进预期**：84%（main push 触发 CI 真正生效，基础稳固度提升）

## 背景

`.github/workflows/ci.yml` 的 `auto-merge` job 用 `GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}` 触发 `gh pr merge --squash`，GitHub 官方 loop-prevention 机制导致该 merge 产生的 push 事件不触发新的 workflow run。仓库几乎 100% 合并走 cp-* → PR → auto-merge 路径，main 分支上 push 事件触发的 CI/Gate3 workflow 长期实际不生效，只被 pull_request 事件 CI 掩盖。PR #4442 合并后验证坐实此根因。

## Golden Path（核心场景）

系统从 [ci.yml auto-merge job 使用 GH_PAT_BOT] → 经过 [PAT 触发 gh pr merge，bypass loop-prevention] → 到达 [main push 事件正常触发下游 CI/Gate3 workflow]

具体：

1. [触发条件] cp-* 分支 PR 满足 auto-merge 条件，ci.yml auto-merge job 执行 `gh pr merge --auto --squash --delete-branch`
2. [系统处理] GH_TOKEN 使用 `${{ secrets.GH_PAT_BOT || secrets.GITHUB_TOKEN }}` 降级写法，PAT 触发的 merge 不受 GITHUB_TOKEN loop-prevention 限制
3. [可观测结果] 合并 commit 落入 main 后，GitHub Actions 产生新的 push 事件触发的 CI run（可用 `gh run list --branch main --workflow=ci.yml --limit 1` 核实 event=push）

## 边界情况

- `GH_PAT_BOT` secret 不存在时：降级写法 `|| secrets.GITHUB_TOKEN` 兜底，行为退化回修复前（可接受，不崩溃）
- brain-integration 测试报 "terminating connection due to administrator command"：已知偶发假红，重跑即可
- 修改 workflows/ 会触发全量测试：预期行为，非新增问题

## 范围限定

**在范围内**：
- `.github/workflows/ci.yml` auto-merge job 的 `GH_TOKEN` 环境变量由 `secrets.GITHUB_TOKEN` 改为 `secrets.GH_PAT_BOT || secrets.GITHUB_TOKEN`
- 新增静态契约测试 `packages/engine/tests/integrity/auto-merge-token-contract.test.sh`，断言 auto-merge job 中 GH_TOKEN 引用了 GH_PAT_BOT

**不在范围内**：
- should-auto-merge.sh 合并决策逻辑（harness PR 跳过规则等）
- harness judge 门禁绕过问题（另案 issue）
- 其他 workflow 文件的 token 用法

## 假设

- [ASSUMPTION: `GH_PAT_BOT` secret 在仓库已存在，无需新增凭据]
- [ASSUMPTION: 降级写法 `${{ secrets.GH_PAT_BOT || secrets.GITHUB_TOKEN }}` 与仓库既有 6 个 workflow 的惯例一致]
- [ASSUMPTION: ci.yml auto-merge job GH_TOKEN 所在行约为第 1855 行，需实际读文件确认]

## 预期受影响文件

- `.github/workflows/ci.yml`：auto-merge job GH_TOKEN 一行改动
- `packages/engine/tests/integrity/auto-merge-token-contract.test.sh`：新增静态契约测试（先红后绿，两个 commit）

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 不适用（单次 CI 配置变更）
- 版本要求: 不适用
- 可观测: 合并后必须用 `gh run list --branch main --workflow=ci.yml --limit 1` 核实 event=push 的 CI run 出现

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重 -->
- [字段核实] proposer 起草涉及 YAML 字段/环境变量的合同/测试前先实际读文件核对，不凭经验假设行号或字段名（来源: area）
- [枚举完整性] contract/测试里涉及 status 枚举硬编码断言，新增状态值时做全仓库 grep 复查（来源: area）
- [语义字段] 成功判定必须看语义字段，不能只 grep ok:true；CI run 验收需确认 event=push 而非仅 run 存在（来源: area）
- [心跳保活] headed relay session 在长 CI 等待循环中应周期性 PATCH relay-runs 心跳，防止 Brain reaper 误杀（来源: area）
- [毕业前校验] 测试入册 commit 后必须本地先跑 lint-tdd-commit-order 与 check-test-coverage 再 push（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path；journey_id=27e83eb4 golden-paths 返回空数组 -->
（本 line 暂无历史）

## E2E 验收

> Planner 初稿此区块框定验收点，proposer 在 GAN 阶段产出最终可执行脚本。

```bash
# 占位：proposer 将按 target_environment=local_api 填入真实脚本
# 期望验收点（自然语言）：
# 1. [先红] 在 ci.yml 未改前运行契约测试，auto-merge-token-contract.test.sh 应 exit 1（断言失败）
# 2. [后绿] 改 ci.yml GH_TOKEN 后重跑契约测试，exit 0（断言通过）
# 3. [终极验收] PR 合并入 main 后：
#    gh run list --branch main --workflow=ci.yml --limit 1
#    核实输出中 event 列为 push（而非 pull_request），即本次合并触发了真正的 push-CI run
```

## journey_type: dev_pipeline
## journey_type_reason: 修改 packages/engine/tests/integrity/ 下的测试文件 + .github/workflows/ci.yml，属于开发流水线质量基础设施改动
## target_environment: local_api
## target_environment_reason: payload 显式指定 target_environment=local_api；静态 shell 脚本断言无需浏览器/远端机器，本地执行即可
## journey_id: 27e83eb4-d582-4baf-aa08-7d6acbbe6e26
## step_id: none（PrepPRD 未锚定具体 step）
