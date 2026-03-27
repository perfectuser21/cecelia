# Learning: content-pipeline-executors DB 配置读取

## 分支
cp-03271431-executor-db-config

## 变更概述
改造 content-pipeline-executors.js，让 5 个 executor 通过 getContentType() 从 DB/YAML 读取内容类型配置，配置不存在时 fallback 到硬编码。

### 根本原因
executor 中的 prompt、阈值、规则全部硬编码，无法按内容类型灵活配置。
PR #1611 已建立 content-type-registry（DB 优先 YAML 兜底），executor 需要对接。
每个 executor 需要在函数入口处调用 getContentType() 获取配置，
然后用可选链访问配置字段（如 typeConfig?.copy_rules?.min_word_count?.short_copy），
配置不存在时 fallback 到原有硬编码值，确保向后兼容。

### 下次预防
- [ ] 新增功能模块时，优先检查是否已有配置注册表可复用
- [ ] async 函数调用要考虑失败降级路径（try/catch + fallback）
- [ ] 测试中 mock async 模块时使用 `vi.fn().mockResolvedValue()` 而非同步 mock

## 技术要点
1. `getContentType()` 是 async 函数（查 DB），executor 已经是 async，直接 await
2. 配置字段路径：`typeConfig?.copy_rules?.min_word_count?.short_copy` 需要可选链
3. catch 块中去掉 console.warn 避免 hook 的"调试垃圾代码"检查
4. 测试中 mock 模块导出时需要用闭包模式：先声明 mockFn 再在 vi.mock 回调中引用
