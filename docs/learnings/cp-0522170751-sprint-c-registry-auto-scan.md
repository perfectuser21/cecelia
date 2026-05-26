## Sprint C — PR 合并后自动扫描 4 张 registry 表（2026-05-22）

### 根本原因

api_registry / db_schema_registry / test_registry / system_registry 4 张表在 Sprint A 做了初始填充，但之后代码变更没有任何机制触发重扫，导致表数据与代码脱节，harness planner 读到的是旧状态。

根因：扫描脚本存在但没有接入任何自动触发点，属于"建了但没接上"的孤岛问题。

### 下次预防

- [ ] **新建表/脚本时同步接入触发点**：只建脚本不接触发点 = 死代码；建完必须检查"谁会在什么时候调用它"
- [ ] **process.cwd() 在 vitest 中指向 packages/brain/**：测试文件里用 `resolve(process.cwd(), '../../scripts/xxx')` 才能到 repo root，不能直接 `'scripts/xxx'`
- [ ] **engine-ship SKILL.md 是活文档**：每次新增 post-merge 动作都应更新 §2，保持收尾流程完整
