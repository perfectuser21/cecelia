# Cecelia Core - Development Learnings

记录开发过程中的经验教训，帮助避免重复踩坑。

---

### [2026-02-07] Brain 学习闭环实现

**功能**：实现 Brain 自动从失败中学习并调整策略的闭环系统。

**Bug**：
1. **版本同步问题** - CI 失败因为版本号不同步
   - 问题：更新 `brain/package.json` 后忘记更新 `DEFINITION.md` 和 `.brain-versions`
   - 解决：手动同步所有版本号文件
   - 影响程度：High（阻塞 PR 合并）

2. **测试 Schema 版本过期** - `selfcheck.test.js` 期望 schema version 011，实际是 012
   - 问题：创建新迁移脚本后忘记更新测试断言
   - 解决：更新测试期望值 `expect(EXPECTED_SCHEMA_VERSION).toBe('012')`
   - 影响程度：High（CI 失败）

3. **CI 环境数据库列缺失** - `learning.test.js` 在 CI 环境失败
   - 问题：测试假设 `brain_config.metadata` 列存在，但 CI 环境的数据库可能没有这个列
   - 解决：在测试的 `beforeAll` 中添加 `ALTER TABLE brain_config ADD COLUMN IF NOT EXISTS metadata JSONB`
   - 影响程度：High（CI 失败）

4. **迁移脚本 SQL 错误** - schema_version 表更新语句错误
   - 问题：使用 `UPDATE schema_version SET version = '012' WHERE id = 1`，但表没有 `id` 列
   - 解决：改用 `INSERT INTO schema_version (version, description) VALUES ('012', '...')`
   - 影响程度：Medium（迁移失败但本地可手动修复）

**优化点**：
1. **版本更新自动化**
   - 建议：创建脚本自动同步 package.json → DEFINITION.md → .brain-versions
   - 影响程度：High（防止版本不同步错误）

2. **测试健壮性增强**
   - 建议：测试应该自己准备数据库结构，不依赖迁移脚本执行顺序
   - 已实施：在 `beforeAll` 中添加 `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`
   - 影响程度：Medium（提高测试可靠性）

3. **迁移脚本标准化**
   - 建议：检查所有迁移脚本的 schema_version 更新语句格式是否一致
   - 影响程度：Medium（避免迁移失败）

**收获**：
- 学习了 Brain 学习闭环的完整实现流程
- 理解了 Cortex RCA 系统与 Learning 系统的集成方式
- 掌握了策略参数白名单验证机制（ADJUSTABLE_PARAMS）
- 实践了 PostgreSQL JSONB 字段的使用

**下次改进**：
- 版本更新时运行 `scripts/check-version-sync.sh` 提前发现不同步
- 创建新迁移脚本时同步更新相关测试的 schema version 期望值
- 测试中确保数据库结构准备充分，不依赖外部迁移状态
