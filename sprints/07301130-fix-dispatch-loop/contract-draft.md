# Sprint Contract — Brain派发死循环三源根治（Issue cc28d1af）

> 本合同为交互式 headed-session 事后补录（非标准 GAN 流程产出），如实反映已完成并测试通过的实现。

## Golden Path

[tick派发任务] → [cecelia-run经软链启动launcher(路径必须真实存在)] → [失败时transient requeue计数≤5] → [隔离TTL自动释放计数≤2] → [部署swap成功后drain-cancel] → [出口：单任务故障有限重试后终局隔离，不再饿死队列；部署后派发不瘫痪]

### Step 1: 软链launcher路径根治（根因A）
**来源**: `[FROM_PRD]` — sprints/07301130-fix-dispatch-loop/prep-prd.md

**可观测行为**: 经 `~/bin/cecelia-run` 软链调用 `--dry-run`，输出的 claude-launch.sh 路径真实存在（此前为 //scripts/claude-launch.sh → exit 127 秒挂）

**验证命令**:
```bash
bash packages/brain/scripts/__tests__/cecelia-run-symlink.test.sh
```

**硬阈值**: exit 0（1 pass / 0 fail）

---

### Step 2: 部署成功路径 drain-cancel（根因D）
**来源**: `[FROM_PRD]`

**可观测行为**: brain-deploy.sh 在 Deploy SUCCESS 分支无条件 best-effort `POST /tick/drain-cancel`——新容器不再从 working_memory 恢复 pre-swap 的 draining 状态

**验证命令**:
```bash
bash scripts/__tests__/brain-deploy-drain-cancel.test.sh
```

**硬阈值**: exit 0（2 pass / 0 fail：出现次数≥2 + 成功路径语义标记）

---

### Step 3: 两个"无限"变"有限"（根因B/C）
**来源**: `[FROM_PRD]`

**可观测行为**: handleTaskFailure skipCount(transient) 路径写入 `transient_requeue_count`，≥5 落入正常失败计数/隔离；checkExpiredQuarantineTasks 的 SELECT 排除 `quarantine_release_count`≥2 的任务且每次自动释放递增该计数

**验证命令**:
```bash
cd packages/brain && npx vitest run src/__tests__/quarantine-dispatch-caps.test.js --reporter=basic
```

**硬阈值**: 3/3 passed

---

## Risks

| 风险 | 说明 | Mitigation |
|---|---|---|
| 真瞬时故障（网络抖动）连续5次后被计入失败 | TRANSIENT_REQUEUE_CAP=5 | 真瞬时故障不会连续命中5次；命中即结构性问题，本就该隔离；且落入的是"失败计数"路径仍有隔离阈值缓冲 |
| 部署失败路径重复cancel | 失败回滚路径已有cancel | 幂等API，best-effort `|| true`，无副作用 |
| quarantine-classification等重型套件未回归 | 在vitest exclude清单（已知OOM，CI默认不跑） | 相关行为由 quarantine.test.js/quarantine-release/quarantine-block/callback-atomic/dispatch-loop-caps 覆盖，75+3全绿 |

## 未覆盖真实链路清单
- 真实部署链路的 post-swap drain-cancel 未在本地实跑完整 bluegreen（需真部署验证）——补位计划：本 PR 合并后触发的自动部署本身就是首次真机验证，验证点=部署完成后 `tick/status.draining=false`（本 session 部署后人工确认）

## 禁 mock 边清单
- 测试 ↔ cecelia-run.sh / brain-deploy.sh（bash 测试真调脚本，不 mock）
- quarantine-dispatch-caps.test.js mock 了 db.js pool（quarantine 单测既有模式，接缝为纯 SQL 语句形态断言）；真 DB 行为由合并后真实部署链路验证（见上清单）

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| ws1-symlink | `packages/brain/scripts/__tests__/cecelia-run-symlink.test.sh` | 软链调用 launcher 路径真实存在 | → 实现前 FAIL（/var/folders/z2/scripts/claude-launch.sh 不存在） |
| ws2-deploy | `scripts/__tests__/brain-deploy-drain-cancel.test.sh` | 成功路径 drain-cancel 存在 | → 实现前 0 pass/2 fail（仅失败回滚路径有 cancel） |
| ws0-wrapper | `sprints/07301130-fix-dispatch-loop/tests/dispatch-loop-fix.test.js` | 根因A：cecelia-run 软链调用 launcher 路径真实存在、根因D：brain-deploy 成功路径含 drain-cancel | → 实现前两 bash 测试红 → wrapper 红 |
| ws3-caps | `packages/brain/src/__tests__/quarantine-dispatch-caps.test.js` | transient requeue 递增 transient_requeue_count、transient_requeue_count 达上限、quarantine_release_count ≥2 的任务不进入自动释放清单 | → 实现前 3 failed |

## E2E 验收
```bash
bash packages/brain/scripts/__tests__/cecelia-run-symlink.test.sh
bash scripts/__tests__/brain-deploy-drain-cancel.test.sh
cd packages/brain && npx vitest run src/__tests__/quarantine-dispatch-caps.test.js
```
均已本地真实执行通过；合并后自动部署即根因D的首次真机验证（部署完成后确认 draining=false）。
