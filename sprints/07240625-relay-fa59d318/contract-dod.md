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
- [BEHAVIOR] B4: `packages/brain/src/executor-contracts.js` 的 `EXECUTOR_KIND_FOR` 映射表中包含 `harness_initiative: 'relay-container'`（I-01 不变式静态代码断言，python3 读文件验证）
- [BEHAVIOR] B5: `PATCH /api/brain/tasks/{id}` 设 `status=failed` 返回 HTTP 200，探针清理成功（white-listed: in_progress/completed/failed）
- [BEHAVIOR] B6: smoke 脚本登记在 `packages/quality/smoke-allowlist.txt` 中，满足 I-02 棘轮约束（新增脚本不欠债）
- [BEHAVIOR] B7: Brain 不可达时脚本以非零退出码退出（防假绿，sad path）

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

> `harness_initiative` 类型的任务必须映射至 `relay-container`；此映射在 `packages/brain/src/executor-contracts.js` 的 `EXECUTOR_KIND_FOR` 对象中静态声明。smoke 通过 python3 读文件断言此映射存在，不依赖 API 运行时状态（因 executor_kind 由 executor.js 在 dispatch 阶段异步写入，创建时为 NULL）。

- [x] B4 静态断言 executor-contracts.js 中 `harness_initiative: 'relay-container'` 映射存在
- [x] 若 executor-contracts.js 的映射被删除/修改，B4 断言失败，CI 即红（棘轮保护）

### I-02（smoke-allowlist 棘轮）

> 已登记进 `smoke-allowlist.txt` 的脚本不得失败退出；新增脚本须同步登记，不欠债。

- [x] `headless-smoke.sh` 在产物清单中须同步追加至 `packages/quality/smoke-allowlist.txt`
- [x] B6 条目通过 grep 校验登记状态（注：合同编号 B6 = I-02 allowlist 棘轮；sad-path 断言在 B7）

---

## 约束汇总

| 约束 | 来源 | 验证方式 |
|------|------|---------|
| 仅 bash + curl + python3 | NFR-02 | 代码审查（禁 jq/psql/node） |
| 脚本 < 60 行 | NFR-01 | `wc -l` 检查 |
| 探针 title 固定为 `headless-smoke-probe-test` | NFR-03 | 代码审查 |
| PATCH status=failed 后脚本正常退出 | NFR-03 | B5 断言 |
