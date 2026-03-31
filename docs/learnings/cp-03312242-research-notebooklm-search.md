# Learning: executeResearch 加入 NotebookLM web search 步骤

## 背景
内容 pipeline research 阶段用 NotebookLM 收集素材，但之前实现只对空 notebook 直接 ask，导致返回空内容或无意义回答。

### 根本原因
`executeResearch` 没有在 ask 前先调用 `notebooklm source add-research` 搜索并导入 web sources。空 notebook 无法提供有价值的回答。

### 修复方案
在 ask 之前插入：
1. 清空旧 sources（notebook 复用）
2. `notebooklm source add-research "{keyword}" --mode deep --no-wait`
3. `notebooklm research wait --timeout 300 --import-all`

研究结束后再次清空 sources，让同一 notebook 可被多次复用。

### 下次预防
- [ ] 新增 NotebookLM 相关功能时，先查阅 `notebooklm --help` 了解完整命令（source add-research、research wait 等）
- [ ] pipeline executor 集成 NotebookLM 时验证 notebook 是否有 sources，空 notebook ask 应有明确错误提示
