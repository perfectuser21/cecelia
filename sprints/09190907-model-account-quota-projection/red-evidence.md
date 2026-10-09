# Red 证据 — 模型账号配额+机器可达性投影（刀2）

冻结合同测试 `tests/model-accounts.test.ts` 随 `chore(harness): import contract`（e8223fd71）
已 tracked。Red 时（实现 commit 之前）以下实现产物均不存在：

- `packages/brain/src/ops-model-accounts-collector.js`  → 缺失
- `packages/brain/migrations/449_ops_model_accounts.sql` → 缺失
- `packages/brain/src/routes/agent-ops.js` 无 `buildModelAccountsPayload` / `model_role`
- `packages/brain/src/ops-notion-schema.js` 无配额列

因此测试文件顶部 `import { ... } from '.../ops-model-accounts-collector.js'` 整个 suite
加载失败（Failed to load url .../ops-model-accounts-collector.js）→ 12 用例 0 通过（全红）。

实测（Red 时）：
```
$ ls packages/brain/src/ops-model-accounts-collector.js
ls: cannot access 'packages/brain/src/ops-model-accounts-collector.js': No such file or directory
```

预期红证据与 Test Contract 一致：模块不存在 → 整个 suite 加载失败 → 0 通过。
