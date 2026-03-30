# Learning: 修复 Brain API 图片扫描前缀匹配（2026-03-30）

### 根本原因

图片生成器在文件名中附加了内容描述词后缀（如 `dankoe-01-failures.png`），
而原来的 `GET /api/brain/pipelines/:id/output` 扫描逻辑只用精确文件名 `dankoe-01.png`
进行 `existsSync` 检查，无法匹配带后缀的文件，导致 `image_urls` 始终返回空数组。

### 下次预防

- [ ] 图片生成器输出文件名格式变动时，需同步更新 API 扫描逻辑
- [ ] 扫描逻辑应优先使用目录遍历（`readdirSync` + 前缀过滤），而非枚举固定文件名
- [ ] DoD Test 命令不能使用本地绝对路径，必须使用仓库根目录相对路径（CI 环境可执行）
