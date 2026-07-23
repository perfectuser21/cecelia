# Contract DoD: headless-smoke

**Task ID**: fa59d318-89ca-4b13-bee5-93cdf8c4362e
**Sprint Dir**: sprints/07240625-relay-fa59d318
**Date**: 2026-07-23

---

## DoD 定义

本合同定义 `headless-smoke.sh` 的完成标准。所有 [BEHAVIOR] 条目必须在 CI 中自动验证通过。

---

## [BEHAVIOR] 条目

- [BEHAVIOR] B1: `GET /healthz` 返回 HTTP 200，Brain 服务存活确认
- [BEHAVIOR] B2: `POST /api/brain/tasks` 携带 `mode=headless, executor=claude, orchestrator=skill-relay` 返回 200/201，响应含 `id` 字段（string 类型）
- [BEHAVIOR] B3: 读回任务（`GET /api/brain/tasks/{id}`）的 `payload.mode` 字段值为 `"headless"`
- [BEHAVIOR] B4: 读回任务的 `executor_kind` 字段值为 `"relay-container"`（I-01 不变式：headless 任务路由至 relay-container）
- [BEHAVIOR] B5: `PATCH /api/brain/tasks/{id}` 设 `status=cancelled` 返回 HTTP 200，探针清理成功
- [BEHAVIOR] B6: smoke 脚本登记在 `packages/quality/smoke-allowlist.txt` 中，满足 I-02 棘轮约束（新增脚本不欠债）

---

## manual:bash 验收命令

```bash
# 标准执行（Brain 在 localhost:5221）
bash packages/brain/scripts/smoke/headless-smoke.sh

# 验证 allowlist 登记
grep -q "headless-smoke.sh" packages/quality/smoke-allowlist.txt && echo "PASS: allowlist 已登记" || echo "FAIL: allowlist 未登记"
```

**判定**：两条命令均无错误输出，smoke 脚本 exit code = 0。

---

## 铁律检查项

### I-01（executor_kind 路由不变式）

> Brain 对 `mode=headless` 任务必须路由 `executor_kind=relay-container`；此路由逻辑由 `packages/brain/src/task-router.js` 决定，smoke 断言其输出不得变更。

- [x] B4 直接断言 `executor_kind == "relay-container"`
- [x] 若 task-router.js 路由逻辑变更导致 B4 失败，CI 即红（棘轮保护）

### I-02（smoke-allowlist 棘轮）

> 已登记进 `smoke-allowlist.txt` 的脚本不得失败退出；新增脚本须同步登记，不欠债。

- [x] `headless-smoke.sh` 在产物清单中须同步追加至 `packages/quality/smoke-allowlist.txt`
- [x] B6 条目通过 grep 校验登记状态

---

## 约束汇总

| 约束 | 来源 | 验证方式 |
|------|------|---------|
| 仅 bash + curl + python3 | NFR-02 | 代码审查（禁 jq/psql/node） |
| 脚本 < 60 行 | NFR-01 | `wc -l` 检查 |
| 探针 title 固定为 `headless-smoke-probe-test` | NFR-03 | 代码审查 |
| PATCH cancelled 后脚本正常退出 | NFR-03 | B5 断言 |
