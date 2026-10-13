# Agent与Skill身份、来源版本治理

任务：7df1d524-298e-49d8-98f2-6bc503d6ec38。整体实施：19c76939-b2c1-4dbc-82b3-dafebe8143af。
GP-Anchor: none(infra)

Agent使用稳定UUID，采集整数ID与来源位置通过有证据的链接关联；移动与改名保留身份。Skill固定Git提交与文件摘要形成不可变源版本；旧generation继续作为评估代次，不冒充源版本。同名只登记未核实候选。链接变动同事务自动留事件。

仅显式安装cecelia_scratch的独立schema，源表通过外键保持真实关系。安装包摘要不同则拒绝覆盖；不进自动migration，不启动调度器或Notion同步。源版本写入限定READ COMMITTED，避免旧快照绕过固定来源冲突检查。Git文件采集、Agent配置版本、依赖组合及生产回填为后续批次，不以本批完成代表整体完成。
