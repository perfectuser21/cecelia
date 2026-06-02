# B56 — loadSkillContent fail-fast（消灭空 SKILL 静默降级）设计

## 背景

fresh run b6e10d97 实证：generator 收到的 prompt（ws1.prompt）缺 harness-generator SKILL 内容（只有"你是 generator + PRD/DoD"，无 commit/push/开 PR 指令）。generator agent 照 prompt 写完代码+测试就"完成"，**从没 commit/push/开 PR** → 无 PR → Final E2E FAIL，成果随 `--rm` 容器蒸发。

## 根因

`packages/brain/src/harness-shared.js` `loadSkillContent`：
- 找不到 SKILL.md（所有搜索路径 miss）时**返回空串**（line 57 注释："找不到返回空串，不抛错，让 prompt 能回退"）
- 且**缓存空串**（`_skillCache.set(name, '')`）→ 一次偶发失败永久化
- 调用方（`buildGeneratorPrompt` 等）拿到空串照样拼进 prompt → **静默降级**，generator 拿空 SKILL 跑出"假成功"

"回退到空 SKILL"不是有效降级——SKILL.md 找不到 = 系统配置坏了，没有合理的"无 SKILL 正常工作"语义。

**诚实声明**：23:35 那次 loadSkillContent 返回空的精确触发未能复现（独立进程现在加载成功，brain 主进程实例 #2 当时 fs 已 ready 15min）。但缓存失败结果 + 静默降级是代码实证的设计缺陷，fail-fast 对未知触发也 robust（把 silent failure 变 loud failure，下次必留证据）。

## 修复

### 单元 1：`loadSkillContent`（harness-shared.js）
- 找不到 SKILL.md（所有路径 miss）→ **throw Error**，message 含尝试过的全部路径（诊断用）
- readFileSync 抛错 → 不吞，继续下一路径；全失败 → throw
- **只在成功读取后缓存**；失败路径不写 cache（移除 `_skillCache.set(name, '')`）
- 成功缓存逻辑不变（保留性能优化）

### 接口契约
- `loadSkillContent(name)` → 返回非空 string（成功）或 **throw**（找不到/读失败）
- 调用方无需改：throw 自然冒泡 → LangGraph 节点 error → task.status=failed + 明确 error reason

## 测试策略（unit）

测试文件：`packages/brain/src/__tests__/load-skill-content.test.js`（新建）

- **复现 bug**：mock `existsSync` 全返回 false → `loadSkillContent('x')` 应 throw（修复前返回空串）
- **不缓存失败**：mock existsSync 首次全 false（throw）→ 恢复某路径 true → 第二次调用返回内容（证明失败没被缓存）
- **成功仍缓存**：mock existsSync true + readFileSync 返回内容 → 两次调用，第二次 readFileSync 不再被调（cache hit）
- **throw message 含路径**：断言 error message 含搜索路径（诊断价值）

## 不包含

- 不改 5 个调用方的 prompt 拼装逻辑（throw 冒泡已足够）
- 不查 23:35 精确触发（已声明未复现，fail-fast 兜底）
- 不动 loadSkillContent 的 SKILL_SEARCH_DIRS 路径列表

## 成功标准

- [ ] loadSkillContent 找不到 SKILL → throw（不返回空串）
- [ ] 失败不缓存，下次可重试
- [ ] 成功结果仍缓存
- [ ] 4 个单元测试覆盖上述行为
- [ ] CI 全绿
