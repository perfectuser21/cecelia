# Learning: Self-Drive tags 格式修复

## 分支
`cp-03191736-fix-selfdrive-tags`

### 根本原因
createTask 的 tags 参数期望 string[] 数组，但 Self-Drive 传了 JSON.stringify() 字符串，PostgreSQL 报 malformed array literal。

### 下次预防
- [ ] 调用 createTask 前确认参数类型与函数签名一致
