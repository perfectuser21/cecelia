# 纯文档 QA 固化范围修复

Task: 9c85169e-1023-4236-a411-23efa1b4f158
GP-Anchor: none(infra)

真实文档 canary 在 QA/Astra PASS 后因健康检查自动固化 smoke，违反原合同 S1/INV45cd。仅当 Git 证明产品与记录差异全为普通 .md 文档时提前返回并留 smoke_note；不按标题/模型自述判断，不修改旧任务、报告、合并批准或服务。

使用既有 pr-kind 分类模块与 qa-solidify 入口。合并祖先、已提交改动、暂存/工作区改动、未跟踪文件分别核验，不能相互抵消；复用 qa-gate 既有 isRecordFile：当前合法 -cw-<task8> 对应 sprint 的 05/06/07 与 qa-rN 产物、顶层 changes.md 为流程记录；不放行整个 sprint。剩余产品必须非空普通 .md；非 Markdown 产品、未知差异、可执行或链接不获豁免。真实 canary 旧 PNG/CJS 记录 mode 均为100644，保留不删。API/代码固化与缺失门保留。

验收：真实 Git + 本地隔离 HTTP health PASS 首红；文档不产生脚本/登记且不额外预跑，API仍产生脚本；混合、源文件改名、未提交代码、失败diff、空diff保守；运行相邻 solidify/runner 回归，独审后 PR 正常 CI。
