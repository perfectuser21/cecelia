# Learning — F1 Capability 可重复认证闭环 kernel-v1（20260813-r3）

## 交付

- 新增 `GET /api/brain/capabilities/:capability/certification`（analytics.js capabilities 路由族），
  内部 `packages/brain/src/map/f1-certification.js` 复用 Mapper `aggregateCapabilityState`
  + `journey_assertion_receipts` / `golden_path_contract_versions` / `journey_step_links` 真库读路径，
  **不新增平行认证系统**。
- fail-closed 判定：合同身份 → Feature 绑定 → receipt → verdict → validation-clock（merge SHA），
  任一不齐一律 not green，且 reason_code 语义区分（no_receipt 补证据 vs receipt_fail 缺陷 vs
  revision_mismatch 错 SHA vs contract_identity_mismatch 无/错合同 vs anchor_target_missing 缺 Feature）。
- 幂等 seed helper `scripts/integration/seed-f1-cert-fixture.js` 供 smoke/nightly/DoD/E2E 复用。

## 关键坑：Brain 与 sprint 测试的 DB 分裂

`harness-v5-checks.yml` 原本把 Brain server 起在 `cecelia`，而 `Run sprint tests` 步骤
用 `DB_NAME=cecelia_test`。对「seed 落 DB 后再 curl Brain 回读」型 sprint 测试（本 F1 smoke 即是），
seed 写 `cecelia_test`、端点读 `cecelia`，正向断言必然假红。

**修法**：把 `Start Brain server` 的 `DB_NAME` 对齐为 `cecelia_test`，使 Brain HTTP 端点与
直连 DB seed 共库。final-e2e 无此问题（Brain 与 seed 都继承 `$DB_URL`）。

**How to apply**：任何「直连 DB 播种 + Brain HTTP 回读」型 sprint 测试，都必须确认 Brain 进程
与测试 seed 的目标 DB 一致——二者分库是这类 smoke 假红的头号根因。

## 判定点（面客不可逆信任）

- F1 green 判据锁定为「当前 revision 非 synthetic PASS receipt + 冻结身份齐」，
  拒绝历史/错 SHA/synthetic receipt 冒充。
- receipt ↔ merge SHA 绑定：`source_sha == expected_merge_sha`，拒绝共享 validation clock。
