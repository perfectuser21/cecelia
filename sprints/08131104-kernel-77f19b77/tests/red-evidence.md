# TDD Red 证据 — Round 1

## 核心行为红证据：四档 change_kind 未驱动 derive Profile（缺陷④）

命令（proposer 实跑，import 路径指向真 orchestrator/derive.js）：

```
npx vitest run kernel-change-kind-profile.test.js --reporter=basic
```

结果：

```
- generate
+ planning        # bugfix / parameter_only 现落 planning，非 generate
 Test Files  1 failed (1)
      Tests  2 failed | 1 passed (3)
```

- `bugfix` → 期望 phase='generate'，实际 'planning' → **FAIL（红）**
- `parameter_only` → 期望 phase='generate'，实际 'planning' → **FAIL（红）**
- `new_capability` → 期望 'planning'，实际 'planning' → PASS（现默认即全链）

根因：`orchestrator/derive.js` 第 740 行只读 `observed.gear`，`change_kind` 零消费。四档当前只是标签，非执行路径。Generator 实现 change_kind → Profile 分派后转绿。

## Schema / 启动链 / 生命周期红（真 PG 集成，brain-integration job 跑）

以下三类在本 checkout（runtime_resources.postgres=false）无法本地起真 PG，红态由代码现状推断，Generator 落地 .pg.integration.test.js 后由 brain-integration job 收割：

- migration 413 尚不存在 → `initiative_runs` 无 controller_session_id / controller_lease_expires_at 列 → B-03 红。
- `createKernelRun`（kernel-run-store.js:380）无 Controller identity 校验 → 无主 run 可建 → B-02 红。
- `harness-skill-relay.js:359` 对 kernel-v1 提前 `return _spawnKernelRuntime`，Kernel detached 无主，fatal 后 ownership 消失 → B-04/B-05/B-06 红。
