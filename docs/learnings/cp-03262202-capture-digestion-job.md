# Learning: feat(capture) — Brain Digestion Job

**分支**: cp-03262202-capture-digestion-job
**日期**: 2026-03-26

## 完成了什么

1. 新增 `capture-digestion.js` — Brain 后台消化 job
2. 在 tick.js 10.4 位置注册调用（fire-and-forget 模式，跟 conversation-digest 一致）
3. LLM prompt 定义了 6 种 target_type × N 种 target_subtype 的完整分类体系
4. extractJsonArray 支持三种 JSON 提取模式（直接解析/code block/bracket match）

### 根本原因

Brain tick 模块使用 fire-and-forget 模式（`Promise.resolve().then(fn).catch(warn)`）执行非关键后台任务。
这个模式的优点是不阻塞 tick 主循环，缺点是失败只有 console.warn，不会中断调度。
capture-digestion 作为非关键路径（失败时 capture 恢复到 inbox 下次重试），fire-and-forget 是合适的模式。
cortex.js 的 `callCortexLLM` 需要动态 import 避免在 tick 测试中触发 mock 链（跟 conversation-digest 相同模式）。

### 下次预防

- [ ] 新增 Brain 后台 job 时统一用动态 import 加载 cortex（避免 mock 链污染）
- [ ] LLM 返回 JSON 时始终用 extractJsonArray 三层容错提取
- [ ] Brain tick 测试中对新模块 import 加 vi.mock 避免副作用
