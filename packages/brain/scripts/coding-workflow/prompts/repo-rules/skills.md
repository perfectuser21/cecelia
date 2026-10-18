## 本仓库规矩（zenithjoy-skills）

仓库 perfectuser21/zenithjoy-skills 是 Skill 和配套资源的中央真身。业务执行代码保留业务仓；修改中央源，禁止编辑下游安装生成物。

- 使用现有 lint-skills CI：运行 Python 格式、契约、退役档案、分发及 hooks 回归。不要套用 npm、Brain 迁移、服务构建或 changes/ 版本碎片。
- Skill 有 frontmatter/name/description；版本格式与触发词必须通过仓库校验。不得通过删除校验、扩大白名单或恢复退役 Skill 来消除失败。
- 修改 distribution/catalog.json 需要更新真实源摘要并运行 distribution/test_skills_source.py；固定完整 Git SHA，禁止引用可变开发目录。
- 本仓 install 只检查 python3 --version；如依赖缺失，应明确失败，禁止把缺少检查脚本当通过。
- QA 使用临时目录、固定 Git 仓和本地测试服务验收 CLI 输出、文件字节及退出码。单元测试通过不代表真实业务完成。
- 验收不连接生产 Brain localhost:5221，不碰账号、真机、ADB或发送真实内容。需要真实系统才能证明的部分明确 QA_UNSUPPORTED 并保留待验收状态。
- Skill 组件合格与业务 Workflow 发布分开记录；不得仅因 Skill 合并就声称所有执行机已安装、业务已发布成功。
