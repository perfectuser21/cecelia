# Learning: Content Publish 任务路由修复

**日期**: 2026-04-05  
**分支**: cp-04050716-448791a8-7c53-4f54-9c13-d96548

---

## 根本原因

`content_publish` 任务被创建为 `queued` 状态，但 Brain 的 dispatch 逻辑缺少 `content_publish` 的任务类型映射，导致 58 个发布任务堆积无法执行。

核心问题在于：
- `TASK_TYPE_AGENT_MAP` 中未定义 `content_publish` 类型
- 即使定义了，也需要根据 `platform` 字段进行二级路由（zhihu/douyin/xiaohongshu 等）
- 原有的单一映射模式无法支持多平台发布

## 修复内容

1. **在 TASK_TYPE_AGENT_MAP 中添加 `content_publish` 条目**
   - 映射到通用处理函数（而非单一 Skill）

2. **新增 PLATFORM_SKILL_MAP 常量**
   ```javascript
   const PLATFORM_SKILL_MAP = {
     zhihu: '/zhihu-publisher',
     douyin: '/douyin-publisher',
     xiaohongshu: '/xiaohongshu-publisher',
     weibo: '/weibo-publisher',
     wechat: '/wechat-publisher',
     toutiao: '/toutiao-publisher',
     kuaishou: '/kuaishou-publisher',
     shipinhao: '/shipinhao-publisher'
   };
   ```

3. **修改 routeTask() 函数的 dispatch 逻辑**
   - 对 `content_publish` 任务提取 `payload.platform` 字段
   - 根据 platform 查找对应的发布 Skill
   - 若 platform 缺失或无映射，降级到通用处理

4. **修改任务创建 API 或调度器**
   - 确保 `content_publish` 任务创建时包含 `platform` 字段
   - 或在路由时从相关上下文推导 platform

## 预期影响

- ✅ 58 个堆积的 `queued` content_publish 任务被激活
- ✅ 内容发布链路恢复
- ✅ 内容生成 KR 进度 → 30%+
- ✅ 自动发布 KR 进度 → 30%+
- ✅ 任务成功率 → 60%+

---

## 下次预防

- [ ] 新增任务类型时，先检查是否需要二级路由（platform/priority/account 等）
- [ ] TASK_TYPE_AGENT_MAP 和 routeTask() 函数需要同步审查，确保映射完整
- [ ] 对于多模式任务，考虑在任务 schema 中明确要求必填字段（如 platform）
- [ ] 建议在 Brain 启动时检查 TASK_TYPE_AGENT_MAP 的覆盖率，warn 未映射的类型
- [ ] 考虑为新 Skill 部署添加自动化注册步骤（减少手工配置遗漏）
