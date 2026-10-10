## Brain {VERSION} — coding harness：截图校验只取图片路径，不把说明文字当路径

- 金丝雀 3（PR #6220）第 1 轮真人 QA 报告写「截图: qa-r1/q8-a-default-category.png（分类留空：弹窗已关，列表首条为 …）、qa-r1/q8-b-bad-category.png（…）」，screenshotProblems 按空白/逗号切词，把说明文字当成路径，报出一串 screenshot_missing，评估被判不合格（#6198 引入）。
- 改为只从截图行提取图片路径（.png/.jpg/.webp），用真实报告行做回归测试。
