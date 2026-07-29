# Reviewer Feedback 第1轮 → Proposer 第2轮

verdict: REVISION
judgments_written: 7

## P1 阻塞项（必须修复才能进 generator）

### F-01 D2 (.conversation-mode 写/删机制) 缺行为测试和 E2E 验证命令
- `packages/brain/src/lib/conversation-agent.js` 当前无任何 `.conversation-mode` 写/删逻辑（D2 尚未实现）
- 合同未将 GP-2 标注为 TDD Red，存在误导
- tests/ 目录中无 D2 对应测试文件
- GP-2 验证命令仅做 grep 静态检查

**要求**：
1. 在 contract-dod.md 中新增 B-08 BEHAVIOR 断言（conversation-agent spawn/resolve 路径写/删 `.conversation-mode`）
2. 新增对应测试文件（conversation-agent-lock.test.ts）
3. 明确标注 TDD Red（D2 待实现）

### F-02 E2E-4 Playwright 全流程在 contract-e2e.sh 中完全缺失
- PRD 要求 mac_web Playwright 验收（WarRoomLineCommandPage → 开对话 → decision_saved → DB 验证）
- contract-e2e.sh 中无对应步骤，GP-5 无可执行命令体

**要求**（二选一）：
1. 在 contract-e2e.sh 中补充 Playwright E2E-4 全流程步骤
2. 或在合同中明确声明「全流程 E2E 延至 staging 阶段由 evaluator 执行」，并在 staging 预览闸步骤 B 给出具体命令

## P2 项（强烈建议修复）

### F-03 无标记 block（D3 第二分支）缺独立 BEHAVIOR 断言
- contract-dod.md B-01~B-07 无「末轮无 [TURN:...] + .conversation-mode 存在 → exit 2」的独立条目
- evaluator 无法对此分支单独 judgment

**要求**：在 contract-dod.md 新增 B-08/B-09 断言，引用 E2E-4 脚本，标注 TDD Red

### F-04 合同测试与已有单测重叠，未声明差异化价值
- tests/conversation-ttl-archiver-contract.test.ts 与 packages/brain/src/__tests__/conversation-ttl-archiver.test.js 高度重叠

**要求**：在文件头注释说明差异化价值（合同层关注 SQL 字面量 + INV-7 语义断言），或合并并标注区别
