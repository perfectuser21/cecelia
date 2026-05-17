# Learning — Harness v6 P1-D Brain↔Generator Env 协议固化

日期：2026-04-25
分支：cp-0425185121-harness-v6-p1d-brain-env-inject
Brain 任务：baa16433-91d0-4628-b078-08757d22bd44

## 现象

今晚 Gen2 (commit 3329655d) 进入容器后立刻自我 ABORTED：

- Generator SKILL 在 Step 0 自检 `CONTRACT_BRANCH` / `SPRINT_DIR` / `BRAIN_URL` 全部缺失
- 容器内 `git remote get-url origin` 是宿主绝对路径 `/Users/.../perfect21/cecelia`，不是 GitHub URL
- 即使 SKILL 不 ABORT，第一步 `git fetch origin <contract_branch>` 也会挂 "does not appear to be a git repository"

### 根本原因

Brain↔Generator 协议两端没对齐：

1. `harness-task-dispatch.js` 的 docker env 块只显式注入 6 个老字段（CECELIA_TASK_TYPE / HARNESS_NODE / HARNESS_INITIATIVE_ID / HARNESS_TASK_ID / HARNESS_FIX_MODE / GITHUB_TOKEN）
2. Generator SKILL 在 v5.0 升级后强制依赖 `CONTRACT_BRANCH` / `SPRINT_DIR` / `BRAIN_URL` / `WORKSTREAM_INDEX`，且这 4 个 env 任一缺失就 ABORT
3. `task.payload` 里实际有 `contract_branch` / `sprint_dir` / `workstream_index`（execution.js callback 链路一直在写），dispatch 只是没读
4. `entrypoint.sh` 没处理"宿主以 worktree 形式挂载 /workspace 时 origin URL 是宿主绝对路径"的 case

## 修复

1. `packages/brain/src/harness-task-dispatch.js`：env 块新增 6 个字段（CONTRACT_BRANCH / SPRINT_DIR / BRAIN_URL / WORKSTREAM_INDEX / WORKSTREAM_COUNT / PLANNER_BRANCH），其中：
   - `BRAIN_URL` 固定 `http://host.docker.internal:5221`（容器从 host.docker.internal 访问宿主 5221）
   - `WORKSTREAM_INDEX` 通过 `extractWorkstreamIndex(payload)` helper 解析：`payload.workstream_index` 优先 → 否则从 `payload.logical_task_id`（`ws<N>`）抽 N
2. `docker/cecelia-runner/entrypoint.sh`：在 git config safe.directory 之后插一段，检测 `/workspace` 的 origin URL 是否以 `/` 开头（宿主路径），是则 `git remote set-url origin https://github.com/perfectuser21/cecelia.git`
3. `packages/workflows/skills/harness-generator/SKILL.md`：Step 0 校验扩到 4 个 env 并给可执行 for-loop；新增 Step 0.4 自检 origin URL 不是宿主路径
4. `packages/brain/src/__tests__/harness-task-dispatch.test.js`：新增 describe "Harness v6 P1-D: env protocol"，5 个断言覆盖正常注入、WORKSTREAM_INDEX 双来源、SPRINT_DIR 默认 `sprints`、BRAIN_URL 固定不可被 payload 覆盖、缺失字段兜底空串

### 下次预防

- [ ] Brain↔SKILL 之间的 prompt env 协议必须**单测固化**：SKILL.md 改 Step 0 自检的同时，必须 grep `harness-task-dispatch.js` 确认 env 已注入；缺一就 fail
- [ ] 任何容器内执行 `git fetch / push` 的脚本，必须先验 `git remote get-url origin` 不是 `/`-前缀的宿主绝对路径
- [ ] Generator SKILL 升级 prompt env 依赖列表时，必须同步开 PR 改 dispatch（v5.0 升级时漏了这一步，造成今晚事故）
- [ ] dispatch 注入新 env 时附带"为什么 / 来源 / 兜底" 注释指向 design doc，避免未来又被改回去
