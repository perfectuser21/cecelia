# Learning: brain_guidance 基础设施

**分支**: cp-brain-guidance  
**任务**: Wave1-C — 两层架构握手表 + getGuidance/setGuidance  
**日期**: 2026-05-04

### 根本原因

调度层（Layer 1）和意识层（Layer 2）之间缺乏异步通信机制：Layer 2 的 LLM 决策结果无处存储，Layer 1 只能 await LLM 阻塞 tick loop。

### 修复方案

- `migration 262`: 新建 `brain_guidance` 表（key/value JSONB/source/expires_at）+ TTL 过期索引
- `guidance.js`: `getGuidance(key)` / `setGuidance(key, value, source, ttlMs)` / `clearExpired()`
- Layer 2 写入 guidance，Layer 1 读取（1ms DB 查询），完全解耦

### 下次预防

- [ ] 测试文件路径必须匹配 lint-test-pairing 规则：`__tests__/<name>.test.js`，不要放 `__tests__/routes/`
- [ ] feat: PR 触及 brain/src 必须配套 `packages/brain/scripts/smoke/<feature>-smoke.sh`
- [ ] selfcheck.js EXPECTED_SCHEMA_VERSION 必须等于最高 migration 编号
