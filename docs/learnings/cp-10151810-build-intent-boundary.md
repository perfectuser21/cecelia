# build 范围与控制器记录来源（2026-10-15）

## 根本原因

原意图在 intent/spec 中保留，但 build 只拿规格路径，通用提示词无条件要求测试，文档任务越界后才被 verify 拒绝。正常 publish/QA/Commander 产生的 Markdown 记录又缺来源关系；单纯让模型补索引会把归属权限交给执行者，单按 JSON 文件名豁免也会掩盖真实代码改动。

## 下次预防

- [x] buildintentboundary 真实活动必须收到可读取的原意图路径；通用 TDD 模板服从任务显式范围，禁止仓库测试时采用允许的临时材料或内联真实断言，保留 verify 与失败历史。
- [x] recordsourceatomic 控制器只登记当前任务、阶段及轮次的合法 Markdown，并与记录同提交；原始历史关系字节保持、冲突拒绝、重启幂等，不能删除非 Markdown 证据规避门禁。
- [x] controlledmetadata 来源索引只能由控制器精确维护；build 的 `build_touched_controlled_metadata` 与模型修复 protected-path 守卫拒绝执行者自行改归属，已提交的篡改也不能洗白。
- [x] docsclassification 三个 Git 视图分别验证准确增量；仅豁免索引这一项，源码、非 Markdown、链接和执行位仍受原规则约束。

- [x] buildsourceactivation 来源证明和启用分棒发布；确认正式工具加载后才在新修订启用 marker，以实际基线官方 artifact 和新 HEAD 验证，不拿候选内存预检或旧快照充当正式来源。

本地真实 Git/子进程回归验证程序行为；正式来源、CI、上线与连续两条自然样本仍须各自取证，不能把本次修复追认旧 A 成功。
