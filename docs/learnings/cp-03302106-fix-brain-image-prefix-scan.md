# Learning: 修复 Brain API 图片扫描前缀匹配

## 根本原因

图片生成器在文件名中附加了内容描述词后缀（如 `dankoe-01-failures.png`），而原来的 `GET /api/brain/pipelines/:id/output` 扫描逻辑只用精确文件名 `dankoe-01.png` 进行 `existsSync` 检查，无法匹配带后缀的文件，导致 `image_urls` 始终返回空数组。

## 解决方案

将精确匹配循环替换为 `readdirSync(IMAGES_DIR)` + `filter` 前缀扫描：
- 过滤条件：`f.startsWith(\`${topic}-\`) && f.endsWith('.png')`
- 封面识别：文件名含 `-cover.`
- 卡片识别：其余文件按字母排序依次分配 index

## 下次预防

- [ ] 图片生成器输出文件名时，若格式会变动，需同步更新 API 扫描逻辑
- [ ] 扫描逻辑应优先使用目录遍历（`readdirSync` + 前缀过滤），而非枚举固定文件名
- [ ] Pipeline Rescue 流程：孤儿 worktree 已有 task card + .dev-mode，直接恢复 step_2_code 继续执行即可
