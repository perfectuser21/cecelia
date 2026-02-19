# Tick 启动稳定性分析 - 文档导航

**分析完成时间**: 2026-02-18  
**分析工程师**: Claude Code  
**分析工具**: File Search, Grep, Code Reading

---

## 文档列表

### 1. [ANALYSIS_SUMMARY.txt](./ANALYSIS_SUMMARY.txt) - 执行摘要
**推荐阅读**: 第一次看
**内容**: 
- 执行摘要（500 字）
- 启动流程 6 个步骤
- 可观测性缺口（6 个）
- 建议 Tasks（优先级）
- 快速诊断步骤

**时间**: 5 分钟
**适合**: 管理者、架构师

---

### 2. [TICK_STARTUP_QUICK_REFERENCE.md](./TICK_STARTUP_QUICK_REFERENCE.md) - 快速参考
**推荐阅读**: 第二次看，需要快速查询
**内容**:
- 一句话总结
- 启动流程表（6 步）
- startup_errors 数据结构
- 环境变量配置
- 可观测性现状
- 快速诊断脚本

**时间**: 10 分钟
**适合**: 开发者、SRE

---

### 3. [TICK_STARTUP_ANALYSIS.md](./TICK_STARTUP_ANALYSIS.md) - 完整分析
**推荐阅读**: 深入理解时阅读
**内容**:
- 启动流程详细分析（6 个 Step）
- startup_errors 数据结构详解
- 现有 API 分析
- 重试机制详析
- 可观测性缺口识别（6 个）
- 建议 Tasks 详细说明（6 个）
- 现有测试覆盖分析
- 推荐优化方案
- 关键代码片段

**时间**: 30 分钟
**适合**: 系统设计者、深度贡献者

---

## 快速导航

### 我想...

**快速了解现状**
→ 阅读 [ANALYSIS_SUMMARY.txt](./ANALYSIS_SUMMARY.txt)（5 分钟）

**查询特定信息**
→ 使用 [TICK_STARTUP_QUICK_REFERENCE.md](./TICK_STARTUP_QUICK_REFERENCE.md)（表格化查询）

**深入理解架构**
→ 阅读 [TICK_STARTUP_ANALYSIS.md](./TICK_STARTUP_ANALYSIS.md)（完整分析）

**快速诊断问题**
→ 参考 [QUICK_REFERENCE.md](./TICK_STARTUP_QUICK_REFERENCE.md) 中的"快速诊断脚本"

**实现建议的 Tasks**
→ 阅读 [ANALYSIS.md](./TICK_STARTUP_ANALYSIS.md) 中的"建议 Tasks"部分

---

## 关键发现一览

| 发现 | 详情 | 影响 |
|------|------|------|
| ✅ 启动有重试机制 | 3 次重试，10 秒间隔 | 故障自愈能力强 |
| ❌ 缺 API 可观测性 | 无端点暴露启动错误 | 无法快速诊断 |
| ✅ 错误持久化到 DB | working_memory.startup_errors | 错误信息不丢失 |
| ❌ 无启动历史表 | 重启后丢失历史 | 无法长期追踪 |
| ✅ 重试逻辑完整 | Step 4-6 都有重试 | 关键步骤有保障 |
| ❌ 非重试步骤无记录 | Step 1-3 无 DB 记录 | 无法观测 Alertness 等初始化 |

---

## 建议 Tasks 优先级

### 立即做（P0 - 共 3 小时）
1. Task 1: `/api/brain/startup/diagnostics` 端点 (2h)
2. Task 2: 增强 `tick/status` 返回启动信息 (1h)

### 本周做（P1 - 共 5 小时）
3. Task 4: 启动日志持久化 (3h)
4. Task 5: 启动健康检查 Probe (2h)

### 本月做（P2 - 共 5 小时）
5. Task 3: 启动失败告警 API (2h)
6. Task 6: 错误分类与自动修复建议 (3h)

---

## 核心数字

| 参数 | 值 | 说明 |
|------|-----|------|
| 最大重试次数 | 3 | 默认配置 |
| 重试间隔 | 10 秒 | 两次重试之间的等待 |
| 最大失败时间 | 30 秒 | 3 × 10 秒 |
| 保留错误数 | 20 条 | startup_errors.errors |
| 启动步骤数 | 6 个 | Step 1-6 |
| 重试覆盖率 | 50% | Step 4-6 有重试 |

---

## 文件地图

```
/home/xx/perfect21/cecelia/core/
├── brain/src/
│   ├── tick.js (L257-325: initTickLoop())
│   ├── tick.js (L227-249: _recordStartupError())
│   ├── executor.js (L558-616: cleanupOrphanProcesses())
│   ├── alertness/index.js (initAlertness())
│   ├── routes.js (L699-706: GET /api/brain/tick/status)
│   └── __tests__/init-tick-retry.test.js
├── DEFINITION.md
├── CLAUDE.md
└── .claude/
    ├── TICK_STARTUP_ANALYSIS.md (本次分析 - 完整版)
    ├── TICK_STARTUP_QUICK_REFERENCE.md (本次分析 - 快速参考)
    ├── ANALYSIS_SUMMARY.txt (本次分析 - 摘要)
    └── TICK_ANALYSIS_INDEX.md (本文)
```

---

## 相关命令

### 快速诊断
```bash
# 查询启动错误
SELECT value_json FROM working_memory WHERE key = 'startup_errors' \G

# 查询 tick 状态
curl http://localhost:5221/api/brain/tick/status | jq '.enabled'

# 查询 DB 连接
SELECT version();
```

### 运行现有测试
```bash
npm test -- __tests__/init-tick-retry.test.js
```

---

## 接下来的步骤

### 如果是第一次看
1. 阅读本索引（2 分钟）
2. 阅读 ANALYSIS_SUMMARY.txt（5 分钟）
3. 扫一遍 QUICK_REFERENCE.md（5 分钟）
4. 决定是否深入

### 如果需要实现 Tasks
1. 选择要实现的 Task
2. 在 ANALYSIS.md 中找到详细说明
3. 按照 CLAUDE.md 的 DevGate 规则实施
4. 参考相关代码片段（在 ANALYSIS.md 附录中）

### 如果要诊断问题
1. 参考 QUICK_REFERENCE.md 中的"快速诊断脚本"
2. 执行 SQL 查询或 API 调用
3. 查看 startup_errors 中的错误信息
4. 根据错误类型查看建议修复步骤

---

## 常见问题

### Q: 我怎样才能知道启动是否失败？
A: 暂时需要直接查 DB（参考快速诊断脚本）。Task 1 会添加 API 端点，更方便。

### Q: startup_errors 的数据会被清理吗？
A: 当前不会。超过 20 条会自动删除旧的，但没有 TTL。如果需要，可在 Task 4 中设置 TTL。

### Q: 为什么 Step 1-3 不重试？
A: 因为这些步骤主要是初始化和清理，失败只记日志。只有 DB 依赖的步骤才重试。

### Q: 现有的重试机制有问题吗？
A: 没有。只是可观测性缺失。建议按优先级实施 Tasks 增强监控能力。

---

## 反馈

如果发现本分析有错误或遗漏，请提交 issue 或 PR。

---

**分析档案完成日期**: 2026-02-18  
**分析档案版本**: 1.0.0  
**最后更新**: 2026-02-18

