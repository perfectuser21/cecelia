# 秋米回写遇已归档中文行无限重试（09-28）

### 根本原因
- pushQiumiStatus 只判断中文行是否处于人工态，没判断页面已归档；主理人删掉的行 PATCH 必然 400 Cannot edit archived block。
- 指纹只在写成功后才 stamp，失败不 stamp → 每 30s 捞回来重试；且单行抛错中止整步回写，排在它后面的行都推不上去。

### 下次预防
- [ ] 对 Notion 页做 PATCH 前，GET 结果里的 archived/in_trash 必须当作终态处理
- [ ] 批量回写的循环里，单行永久性失败要 stamp 掉，不能让它挡住后面的行
