# Skill固定Git来源核验

任务：bf367ca8-1fb4-4f00-82c3-ddc62a1fa3e0。整体实施：19c76939-b2c1-4dbc-82b3-dafebe8143af。
GP-Anchor: none(infra)

读取当前安装Skill目录与本地Git固定提交，归一仓库地址、比较每个文件字节摘要。必须包含SKILL.md；本地改动、删除、未跟踪及ignore文件、链接、缺来源、含凭据remote、HEAD漂移均不得冒充已核实。只输出路径和摘要，不保存源正文。

CLI只读输入注册表快照，输出权限600的核验结果，不调用网络、数据库或调度器。核验范围是本地Git与安装字节一致，remote来自本地配置；尚未证明远端Git存在该提交，明确remote_revision_verified=false。后续生产回填须沿用身份层证据及部署门禁。
