# Learning: Cleanup 自动触发

### 根本原因
Stop Hook 检测到 PR 合并后只告诉 AI "去执行 Step 5 Clean"，但不自动调用 cleanup.sh。
如果 AI 跳过了（context 用完、会话超时等），cleanup 就永远不执行，留下垃圾文件。

### 下次预防
- [ ] 自动化流程不应依赖 AI "记得"执行某个步骤
- [ ] 关键清理操作应由代码自动触发，不靠 prompt 指示
