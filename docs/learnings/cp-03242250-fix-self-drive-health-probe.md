# Learning: 修复 self_drive_health 链路探针故障

**Branch**: cp-03242250-eeebbe45-e3eb-4c5b-8214-043062
**Date**: 2026-03-25

## 背景

`probeSelfDriveHealth` 探针持续返回 `ok: false`，导致 Brain 反复创建无效修复任务，形成错误循环。

## 根本原因

### 根本原因 1：DB 中模型配置被误改

`profile-anthropic` 的 `thalamus` 被意外设为 `{"provider": "codex", "model": "codex/gpt-5.4-mini"}`。Codex team 账号对 `gpt-5.4-mini` 触发 usage quota 限制，每次 self-drive cycle 都报 `cycle_error`。

### 根本原因 2：探针判定逻辑不完整

原始 `probeSelfDriveHealth` 只检查 `tasks_created > 0`，导致 LLM 正常运行但判断"无需行动"（`no_action` 事件）时也被误判为失败。实际上 `no_action` 代表系统健康，不应触发告警。

## 修复内容

1. **`migrations/192_fix_thalamus_model.sql`**：重置 `profile-anthropic.thalamus` 为 `anthropic/claude-haiku-4-5-20251001`（与 FALLBACK_PROFILE 一致）
2. **`capability-probe.js`**：重写 `probeSelfDriveHealth` SQL，区分三种事件：
   - `cycle_complete` / `no_action` → 成功（`ok: true`）
   - `cycle_error` → LLM 失败（`ok: false`）
   - 无任何事件 → 系统未运行（`ok: false`）
3. **`capability-probe-highlevel.test.js`**：新增 4 个单测覆盖成功/失败路径

## 下次预防

- [ ] 修改 `model_profiles` 时必须同步检查所有 active profile 的 `thalamus` 字段是否指向有效模型
- [ ] Self-drive 探针应区分"LLM 失败"和"LLM 判断无需行动"两种语义——二者监控意义完全不同
- [ ] `EXPECTED_SCHEMA_VERSION` 变动时必须同步更新 3 处测试文件（`desire-system.test.js`、`selfcheck.test.js`、`learnings-vectorize.test.js`）
- [ ] Migration 写 `UPDATE` 语句前应先 `SELECT` 确认目标行存在，防止 `UPDATE 0` 静默失败
