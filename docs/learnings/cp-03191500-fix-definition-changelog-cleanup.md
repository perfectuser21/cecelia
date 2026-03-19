# Learning: DEFINITION.md 位置标注与代码不一致 + CHANGELOG 版本缺口

## 概要
DEFINITION.md 中 codex_qa 的位置列标注为 US，但 task-router.js 中 LOCATION_MAP 实际路由到 'xian'。
CHANGELOG.md 停留在 12.93.0，但 package.json 已到 13.3.0，缺少 4 个大版本的记录。
stop.sh.before-refactor 备份文件（15KB）在重构完成后未清理。

### 根本原因
1. codex_qa 最初在 US 运行，后来路由改到西安但 DEFINITION.md 未同步更新
2. 13.x 版本的 CHANGELOG 条目在 feature-registry.yml 中有记录但未同步到 CHANGELOG.md
3. stop.sh 重构后备份文件被遗留，且测试文件检查其存在性形成了"保护锁"

### 下次预防
- [ ] 修改 task-router.js LOCATION_MAP 时，同步更新 DEFINITION.md 对应行
- [ ] 版本 bump 时同步更新 CHANGELOG.md（可加 CI 检查 package.json version vs CHANGELOG 最新条目）
- [ ] 重构完成后及时清理备份文件，不要让测试断言"备份存在"
