# Notion 推送两类 400 每轮重试永不自愈（09-29）

### 根本原因
- 推送自愈只认 404 与错库 400（schema 不符）。页或所在库被移进 Notion 回收站时返回的是 400「Can't edit page on block with an archived ancestor」，既不是 404 也不匹配错库判据，只记日志，每 5 分钟重试一次永远失败。tasks、skill_registry、统一引擎、relay project 四处各自写判据，同病。
- pushIssues 把 issues.status 原样写进 Notion status 属性。Notion Issues 库只有 Open / Triage / In progress / Closed，表里的 Backlog、Done、open、closed 全部 400「Invalid status option」。

### 下次预防
- [ ] 「页不可用」判据统一用引擎导出的 isPageGoneError，新推送函数禁止再手写 /404/ 正则
- [ ] 往 Notion status/select 属性写值前必须经映射函数收敛到库里真实存在的选项，未知值给兜底而不是原样透传
- [ ] 推送失败日志同一文案每轮重复出现即视为缺自愈分支，按错误文案补判据并加回归测试
