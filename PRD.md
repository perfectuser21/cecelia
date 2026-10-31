# Cecelia 最小可靠 CI

Task: c88027df-e674-437a-9d45-24dc1d4e6e17
GP-Anchor: none(infra)

用户目标：彻底厘清现有 CI 中过时概念和无效检查，交付最基本、保底能用的保障。

正常路径：提交 PR → 选择完整相关组件 → 凭据/漏洞扫描、真实单测、类型/构建、镜像与专用 PG 任务生命周期验收 → 全部实际成功才给出「源码保底通过」→ 经 GitHub 保护正常合并 → main 对应版本再次验证。

错误路径：测试非零/信号退出、空执行集合、范围检测失败、审计报告缺失、准备失败、检查取消或跳过，均不能产生合并资格。迁移之前必须验证 DB_* 与 DATABASE_URL 指向同一个本机专用 scratch。测试服务只停止本人 PID，禁止复用生产账号或共享 Brain。

结构：主 ci.yml 只有 plan/security/checks/ci-passed 四个顶层任务；Checks 使用显式组件矩阵。现役服务全量包括 Brain 六片、runtime、image、Engine、Quality、MCP、API、Dashboard、Ops、scripts。Android 的相关客户端改动执行 Gradle，旧 frontend 仅验证自身改动。历史 Sprint、在线 AI review、旧全池 smoke 和常驻 staging 假设退出自动通用门禁；数据库深度回归、Walking 与 Map Manifest 有独立夜间 owner。

来源准入和生产发布继续独立保护；cecelia_source_only 禁止生产发布的逻辑不变。旧源码绿灯不能沿用新资格：新检查使用新名字，切换保护时先加新要求，确认新候选成功，再替换旧检查；strict、管理员受限、禁止强推和 PR 要求保留。

完整边界、旧入口去向和复核命令见 docs/current/CI_PIPELINE.md。外部规则读回和 main 对应 SHA 的真实 CI 通过之前，本任务不算完成。

审计后的清理范围：归并意图识别与判级的同环境重复副本，保留独有回归语义；账龄测试只保留一个真实实现入口，补齐计数、重试参数、间隔和异常行为；Dashboard 全景测试直接导入实际组件，不再验收测试内的复制实现。仅清理实现已删除、用例永久停用的旧图合同；现役 API 缺环境、watchdog 失败债务、故意拒绝旧入口复活的负例继续保留，不能作为垃圾删除。测试能力通过专用隔离副本的错误变体验证，不在共享源码上瞬时改坏生产实现。
