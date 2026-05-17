---
id: review-plan-20260226-l2
version: 1.0.0
created: 2026-02-26
updated: 2026-02-26
changelog:
  - 1.0.0: 基于 L2 全量扫描报告生成修复计划
---

# Review Plan - Level 2 修复计划

**基于**: CODE-REVIEW-REPORT-20260226-L2.md
**目标**: 消除所有 SEC 和 L2 发现，达到 PASS 状态

---

## 修复优先级

| 优先级 | 任务数 | 预估工时 |
|--------|--------|----------|
| P0 (必须修) | 2 | 1-2h |
| P1 (应该修) | 4 | 2-3h |
| P2 (建议修) | 5 | 3-4h |
| P3 (可选改进) | 4 | 4-6h |

---

## P0: 阻塞修复（影响功能正确性）

### Task 1: 修复死三元运算符

**影响**: 决策逻辑完全失效
**文件**: 2 个文件，2 处修改
**预估**: 30 分钟

| 文件 | 当前 | 应改为 |
|------|------|--------|
| `decision.js` `requiresApproval()` | `? 'pending' : 'pending'` | `? 'pending' : 'approved'` |
| `proposal.js` L269 | `? 'pending_review' : 'pending_review'` | `? 'pending_review' : 'approved'` |

**验证**:
- [ ] 确认 decision.js 的 `requiresApproval` 在高置信度时返回 `'approved'`
- [ ] 确认 proposal.js 在不需要审查时返回 `'approved'`
- [ ] 运行相关测试用例

### Task 2: 修复过时路径

**影响**: 功能 broken（找不到仓库、工作目录错误）
**文件**: 3 个文件
**预估**: 30 分钟

| 文件 | 行号 | 当前值 | 应改为 |
|------|------|--------|--------|
| `daily-review-scheduler.js` | L21-27 | `cecelia/core`, `cecelia/workspace`, `cecelia/engine` | `cecelia/packages/brain`, `cecelia/apps`, `cecelia/packages/engine` |
| `executor.js` | L62 | `cecelia/core` | `cecelia` (monorepo root) |
| `tick.js` | L1938 | `cecelia/quality/scripts/` | `cecelia/packages/quality/scripts/` |

**验证**:
- [ ] 确认路径在文件系统上存在
- [ ] 手动触发 daily review 验证调度器工作
- [ ] `ensureCodexImmune` 路径可达

---

## P1: 安全修复

### Task 3: 修复 API Key 暴露

**影响**: 泄漏 OpenAI Realtime API Key
**文件**: `orchestrator-realtime.js`
**预估**: 30 分钟

**方案**: `getRealtimeConfig()` 返回值中移除 `apiKey` 字段，或者仅在服务端使用，不通过 API 暴露给前端。如果前端需要连接 Realtime API，应通过 Brain 作为代理。

**验证**:
- [ ] API 端点不再返回 apiKey
- [ ] Realtime 功能正常工作（如果有的话）

### Task 4: 加强路径穿越防护

**影响**: 可能通过 artifact download 端点读取任意文件
**文件**: `trace-routes.js` L207
**预估**: 30 分钟

**方案**:
```javascript
const resolved = path.resolve(filePath);
const allowedPrefix = path.resolve(ARTIFACTS_DIR);
if (!resolved.startsWith(allowedPrefix + path.sep) && resolved !== allowedPrefix) {
  return res.status(403).json({ error: 'Path outside allowed directory' });
}
```

**验证**:
- [ ] `../../../etc/passwd` 被拒绝
- [ ] `/etc/passwd` 被拒绝
- [ ] 正常 artifact 路径可以下载

### Task 5: SQL 参数化统一

**影响**: 消除注入风险模式
**文件**: 7 个文件，约 10 处修改
**预估**: 1 小时

**统一方案**: 将所有 `INTERVAL '${variable} hours'` 改为参数化写法：

```sql
-- 方案 A: 使用 make_interval
WHERE created_at > NOW() - make_interval(hours => $1)

-- 方案 B: 使用乘法
WHERE created_at > NOW() - ($1 || ' hours')::interval

-- 方案 C: 传入秒数
WHERE created_at > NOW() - ($1 * INTERVAL '1 hour')
```

**受影响文件**:
- `decision-executor.js`
- `monitor-loop.js`
- `alertness/index.js`
- `decomposition-checker.js` (4 处)
- `memory-retriever.js`
- `validate-okr-structure.js`

**验证**:
- [ ] 所有文件的 SQL 查询使用参数化
- [ ] 运行相关测试确保查询结果不变

### Task 6: 收紧 CORS

**文件**: `server.js`
**预估**: 30 分钟

**方案**: 将 `Access-Control-Allow-Origin: *` 替换为动态白名单：

```javascript
const ALLOWED_ORIGINS = [
  'http://localhost:5211',
  'http://localhost:5212',
  'http://perfect21:5211',
];
const origin = req.headers.origin;
if (ALLOWED_ORIGINS.includes(origin)) {
  res.setHeader('Access-Control-Allow-Origin', origin);
}
```

**验证**:
- [ ] 前端正常访问 Brain API
- [ ] 非白名单 origin 被拒绝

---

## P2: 功能改进

### Task 7: 修复贪婪 JSON 正则

**文件**: `cortex.js`, `desire-formation.js`, `user-profile.js`
**预估**: 30 分钟

**方案**: 将 `/\{[\s\S]*\}/` 改为 `/\{[\s\S]*?\}/` 或使用更健壮的 JSON 提取：

```javascript
function extractJson(text) {
  const match = text.match(/\{[\s\S]*?\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]); }
  catch { return null; }
}
```

### Task 8: 修复警觉级别映射

**文件**: `alertness-actions.js`
**预估**: 20 分钟

确保 `LEVEL_ACTIONS` 或相关映射覆盖所有 5 个级别（0-4），包括 PANIC=4。

### Task 9: 修复 model-profile.js 竞态

**文件**: `model-profile.js` `switchProfile()`
**预估**: 30 分钟

**方案**: 使用 `pool.connect()` + `client.query('BEGIN')` 包裹多步操作。

### Task 10: 内存 Map 清理

**文件**: `notifier.js`, `proposal.js`
**预估**: 30 分钟

为 `_lastSent` 和 `rateLimitBuckets` 添加定期清理逻辑（setInterval 或被动 TTL）。

### Task 11: vps-monitor.js 伪数据标记

**文件**: `vps-monitor.js`
**预估**: 15 分钟

history 端点返回的 jitter 数据应标记为 `mock: true`，或连接真实数据源。

---

## P3: 可选改进（最佳实践）

### Task 12: 提取 MiniMax 共享客户端

**文件**: 新建 `minimax-client.js`，修改 7 个引用文件
**预估**: 1-2 小时

将重复的 MiniMax API key 加载 + 调用逻辑提取为单一模块。

### Task 13: 添加 Brain API 基础认证

**文件**: `server.js` 或新建 `auth-middleware.js`
**预估**: 1-2 小时

为关键操作端点（tick 控制、任务创建、alertness 覆写）添加 Bearer Token 认证。

### Task 14: 清理 TODO/Stub

**文件**: `alertness/escalation.js`, `alertness/healing.js`
**预估**: 1 小时

完善或删除 TODO 标记的 stub 实现。

### Task 15: 减少阻塞 sleep

**文件**: `alertness/healing.js`
**预估**: 30 分钟

将 5 分钟阻塞 sleep 改为非阻塞方案（如 setInterval 回调或分步执行）。

---

## 执行顺序建议

```
Phase 1 (1h): Task 1 + Task 2 — 立即修复 broken 功能
Phase 2 (2h): Task 3 + Task 4 + Task 6 — 安全加固
Phase 3 (1h): Task 5 — SQL 统一参数化
Phase 4 (2h): Task 7-11 — 功能改进
Phase 5 (3h): Task 12-15 — 最佳实践（可选）
```

**总预估**: Phase 1-3 约 4 小时（必须），Phase 4-5 约 5 小时（建议）

---

## 复查标准

修复完成后，需满足以下条件才能从 NEEDS_FIX 升级为 PASS：

1. [ ] 所有 P0 任务完成
2. [ ] 所有 P1 任务完成
3. [ ] 相关测试通过 (`npm test` in packages/brain)
4. [ ] 无新的 SEC 或 L2 发现
5. [ ] CI (brain-ci.yml) 通过
