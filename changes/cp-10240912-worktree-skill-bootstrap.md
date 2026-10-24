## Brain {VERSION} — 新工作区固定技能来源准备

- runner在依赖安装后执行既有固定Skill来源恢复与校验，再启动模型和本地CI预检。
- 恢复失败停止准备；skipNpmCi仅跳过npm，不跳技能；无固定来源声明的仓库保持原行为。
- 修复正式CI发现的既有运行依赖审计阻塞，更新body-parser/multer/zod及兼容Zod4的OpenAI SDK，不改审计白名单。
