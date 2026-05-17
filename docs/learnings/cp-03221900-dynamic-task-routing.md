# Learning: 动态任务类型路由配置

**Branch**: cp-03221900-dynamic-task-routing
**Date**: 2026-03-22

## 背景

将 B类非编码 Codex 任务路由从 hardcoded LOCATION_MAP 改为 DB 动态配置，前台可实时调整。

### 根本原因

每次调整 B类任务路由（如把 strategy_session 从 xian 改到 us）都需要发 PR，属于把「运行时配置」写成「编译时常量」的反模式。

## 设计决策

### 分层策略铁律
- **A类**（dev/cecelia_run）：hardcoded US，改了会破坏 worktree 流程
- **Coding pathway B类**（code_review/decomp_review/initiative_plan 等）：hardcoded US + 本机 Codex，需要读代码上下文
- **其余 Codex B类**（strategy_session/knowledge/scope_plan 等）：DB 动态配置

### null fallback 机制
`getCachedLocation` 返回 `null` 表示「不在动态缓存」，调用方用 `??` fallback 到 LOCATION_MAP。这确保：
1. A类和 Coding pathway 不受动态缓存影响
2. 即使缓存加载失败，路由也不会中断（graceful degradation）

### REVIEW_TASK_TYPES 双重保护
即使有人手动往 task_type_configs 插入 code_review 等编码类任务，REVIEW_TASK_TYPES 检查在路由决策第 0 步，优先级最高，确保绕不过。

## 下次预防

- [ ] 新增任务类型时，先判断是否需要读代码 → 是则 hardcoded US+Codex；否则插入 task_type_configs
- [ ] task_type_configs 初始数据用 ON CONFLICT DO NOTHING，保证幂等
- [ ] executor 字段未来可加枚举白名单验证（code_review_gate 审查已指出）

## 技术细节

```
task_type_configs (DB)
    ↓ Brain 启动时 loadCache(pool)
task-type-config-cache.js (内存 Map)
    ↓ getCachedLocation(taskType)
executor.js triggerCeceliaRun
    ↓ dynamicLocation ?? getTaskLocation()
路由决策（hk/xian/us）
```

API：GET /api/brain/task-type-configs → PUT → updateConfig → refreshCache（立即生效）
