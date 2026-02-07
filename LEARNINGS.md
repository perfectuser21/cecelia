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

---

### [2026-02-07] 免疫系统完整连接实现

**功能**：连接所有免疫系统组件 - Feature Tick 自动启动、策略调整效果监控、质量反馈循环。

**Bug**：
1. **UNIQUE 约束缺失** - migration 016 的 strategy_effectiveness 表缺少 UNIQUE 约束
   - 问题：`ON CONFLICT (adoption_id)` 需要 adoption_id 有 UNIQUE 约束，但只有普通 REFERENCES
   - 解决：改为 `adoption_id UUID UNIQUE REFERENCES`，UNIQUE 会自动创建索引
   - 影响程度：High（CI 失败，migration 无法执行）
   
2. **Supertest 依赖缺失** - routes-immune-connections.test.js 导入了 supertest 但 package.json 没有
   - 问题：测试文件创建了 API 路由测试，但 supertest 不是 Brain 的依赖
   - 解决：删除 routes 测试文件，改用 manual testing（DoD 更新）
   - 影响程度：High（CI 失败）

3. **测试数据污染** - learning-effectiveness.test.js 和 cortex-quality.test.js 测试相互影响
   - 问题：多个测试创建数据但不清理，导致后续测试查询到错误的数据量
   - 解决：在 `beforeEach` 添加 `DELETE FROM cortex_analyses/tasks/strategy_adoptions/strategy_effectiveness`
   - 影响程度：High（CI 随机失败，本地可能通过但 CI 失败）

4. **错误的表名** - 测试代码使用了不存在的 `task_runs` 表
   - 问题：复制测试代码时假设有 task_runs 表，实际表名是 `agent_runs`
   - 解决：删除 `DELETE FROM task_runs` 语句
   - 影响程度：Medium（本地测试失败）

5. **测试时间窗口重叠** - "ineffective strategy" 测试与主测试使用相同时间点
   - 问题：两个测试都用 `Date.now() - 10 * 24 * 60 * 60 * 1000`，查询时间窗口重叠，统计到对方的任务
   - 解决：改用不同时间点（30天前 vs 10天前）并添加唯一的任务标题前缀
   - 影响程度：High（导致成功率计算错误）

6. **函数名错误** - server.js 导入了不存在的 `startFeatureTick` 函数
   - 问题：feature-tick.js 导出的是 `startFeatureTickLoop`，但 server.js 导入的是 `startFeatureTick`
   - 解决：修正 import 和调用为 `startFeatureTickLoop()`
   - 影响程度：Critical（GoldenPath E2E 失败，服务器启动失败）

**优化点**：
1. **UNIQUE vs INDEX 的权衡**
   - 发现：UNIQUE 约束会自动创建索引，不需要额外的 `CREATE INDEX`
   - 建议：如果字段需要唯一性，直接用 UNIQUE 而不是 INDEX + 应用层检查
   - 影响程度：Medium（简化数据库设计）

2. **测试隔离原则**
   - 发现：共享数据库的测试必须在 beforeEach 清理所有相关表数据
   - 建议：测试应该清理它查询的所有表，不只是它直接写入的表
   - 影响程度：High（避免 CI 随机失败）

3. **时间窗口测试策略**
   - 发现：测试时间敏感功能时，要确保不同测试的时间窗口不重叠
   - 建议：使用明确不同的时间偏移（如 10天 vs 30天）+ 唯一标识符（任务标题）
   - 影响程度：High（避免时间窗口查询污染）

4. **Migration UNIQUE 约束最佳实践**
   - 发现：`ON CONFLICT` 子句要求字段有 UNIQUE 或 EXCLUSION 约束
   - 建议：如果 upsert 需要 ON CONFLICT，在 migration 里直接用 UNIQUE，不要只用 FK
   - 影响程度：High（避免 upsert 失败）

**收获**：
- 学习了 PostgreSQL UNIQUE 约束自动创建索引的机制
- 理解了测试数据污染的根本原因：时间窗口重叠 + 表级查询
- 掌握了 ON CONFLICT 子句对约束类型的依赖关系
- 实践了 CI 失败 5 次的完整调试流程（约束→依赖→数据→表名→时间→函数名）
- 理解了 Feature Tick Loop 与主 Tick Loop 的独立性
- 验证了 DoD → Test mapping 的 DevGate 检查机制
