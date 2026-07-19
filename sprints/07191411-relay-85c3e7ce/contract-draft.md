# Contract Draft — headless-smoke（85c3e7ce）

## 任务信息

- TASK_ID: `85c3e7ce-7849-42b8-9ff9-542dd0db8375`
- Sprint: `07191411-relay-85c3e7ce`
- Brain URL: `http://localhost:5221`（本地）/ `http://host.docker.internal:5221`（容器内）
- 生成轮次: 第 1 轮（首轮，无 reviewer feedback）
- 生成时间: 2026-07-19

---

## 验收目标

验证 Brain headless dispatch 路径已被 Brain 接收、被当前 session 认领，并产生可追溯的 API/DB 证据。

具体三元组：
- `executor=claude`
- `mode=headless`
- `orchestrator=skill-relay`

---

## E2E 验收

### 验收命令（e2e-verify.sh）

```bash
bash sprints/07191411-relay-85c3e7ce/e2e-verify.sh
```

脚本将执行以下校验（必须全部通过才 exit 0）：

1. **FR-01** 调用 `GET /api/brain/tasks/85c3e7ce-7849-42b8-9ff9-542dd0db8375`，断言：
   - `status == "in_progress"`
   - `payload.mode == "headless"`
   - `payload.executor == "claude"`
   - `payload.orchestrator == "skill-relay"`
   - `dispatched_by_orchestrator == true`
   - `orchestrator_dispatched_at` 非空、非 null

2. **FR-02** 同一响应断言以下字段存在且非空：
   - `claimed_by`
   - `claimed_at`
   - `executor_kind`

3. **FR-03** 调用 relay-runs 端点（若存在）；若返回空集或 404，记录 concern（不阻断 exit 0）。

4. **FR-04** 将 API 响应脱敏摘要写入 `evidence.json`。

5. **FR-05** 脚本幂等可重复执行，禁止 `exit 0` 兜底。

### 手动执行示例

```bash
# 确保 Brain 在线
curl -sf http://localhost:5221/api/brain/tasks/85c3e7ce-7849-42b8-9ff9-542dd0db8375 | jq .status

# 执行完整 E2E 验收
bash sprints/07191411-relay-85c3e7ce/e2e-verify.sh
```

---

## 覆盖链路图

```
Brain (POST /api/brain/tasks)
  └─ dispatch: mode=headless, executor=claude, orchestrator=skill-relay
       └─ DB: tasks.status = in_progress
            ├─ claimed_by / claimed_at 已写入
            ├─ orchestrator_dispatched_at 已写入
            └─ payload 三元组已写入
```

---

## 未覆盖真实链路清单

| # | 链路 | 状态 | 备注 |
|---|------|------|------|
| 1 | `initiative_runs` 记录验证 | **Concern**（不是失败） | 端点可能不存在或返回空集；已在 FR-03 中要求记录 concern，后续阶段补证 |
| 2 | 真实 headless container spawn | 不在范围 | 本 sprint 只验证 DB/API 证据，不启动容器 |
| 3 | executor=codex 路径 | 不在范围 | 参照 PR#4103 覆盖，本 sprint 专注 claude/headless |

---

## 铁律覆盖确认

| # | 铁律 | 覆盖方式 |
|---|------|----------|
| 1 | smoke 验收不得依赖 headed session | e2e-verify.sh 直接调用 Brain API，不引用任何 headed session 历史 |
| 2 | done 判定必须引用 task id 实时 API 响应 | 脚本硬编码 task_id，每次执行实时 curl |
| 3 | initiative_runs 缺失必须列为 concern | FR-03 + 未覆盖链路清单第 1 条 |
| 4 | e2e-verify.sh 禁止 exit 0 兜底 | 脚本每个断言失败即 exit 1 |
| 5 | 测试文件 commit 后不可改内容 | contract-red.test.sh 锁定为 Red 状态 |

---

## 关联文档

- PRD: `sprints/07191411-relay-85c3e7ce/sprint-prd.md`
- DoD: `sprints/07191411-relay-85c3e7ce/contract-dod.md`
- 测试骨架: `sprints/07191411-relay-85c3e7ce/tests/contract-red.test.sh`
- 证据: `sprints/07191411-relay-85c3e7ce/evidence.json`（执行后生成）
- Concern: `sprints/07191411-relay-85c3e7ce/concerns.txt`（执行后生成）
