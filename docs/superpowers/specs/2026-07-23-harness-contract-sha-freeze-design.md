# Harness 合同 SHA 冻结设计

## 问题

Kernel reviewer 已批准的 `contract-draft.md` 与 `contract-dod.md` 位于远端
`cp-harness-propose-rN-*` 分支，不在任务 worktree。当前 loop 却从任务 worktree
读取，导致真实链路在 APPROVED 后以 `approved_but_contract_artifacts_missing`
失败。只改成读分支名仍不够：分支可移动，批准证据会和最终冻结内容脱钩。

## 设计

1. `ground-truth` 从同一条 `git ls-remote` 记录同时采集 propose branch 与 tip SHA。
2. reviewer TaskBundle 携带 `contract_branch`、`contract_round`、`contract_sha`。
3. callback 只从服务端保存的 TaskBundle 复制 SHA 到 append-only
   `verdict:reviewer`，不信任 worker 回传 SHA。
4. derive 前的观测只接受 round 与当前 branch tip SHA 都匹配的 verdict；旧 verdict
   没有 SHA 时仅为本次在途 fire drill 兼容，绑定物化当刻的当前 tip。
5. loop 从 verdict 锚定 SHA 读取
   `sprint-prd.md`、`contract-draft.md`、`contract-dod.md`，再用现有单条 PostgreSQL
   CTE 原子冻结内容并挂接 run。任务 worktree 不被污染。
6. Git 文件读取封装为独立模块，使用 `execFileSync` 参数数组，拒绝非 40 位 SHA、
   绝对路径和 `..` 路径。

## 错误处理

- SHA 缺失或非法：run 明确失败为 `approved_but_no_contract_sha`。
- SHA 中缺任一合同文件：run 明确失败为
  `approved_but_contract_artifacts_missing`。
- branch tip 在 reviewer 回调后移动：旧 verdict 视为 stale，重新派 reviewer，不冻结。

## 测试策略

- Unit：ls-remote SHA 解析、stale SHA verdict、TaskBundle SHA、callback verdict SHA、
  loop 从 SHA 读取而非 worktree。
- Integration：临时真实 Git 仓库证明 branch 移动后仍按旧 SHA 读到被批准内容；现有
  PostgreSQL contract-store 集成测试继续覆盖原子物化。
- Smoke：真实运行 Git artifact reader 的路径/SHA 保护和 Brain 语法检查。
- Fire drill：部署后复用现有 hop35 APPROVED，验证创建 approved contract row，随后
  generator 必须为 `codex/team3`。

## 不包含

- 不改 derive/gates 的控制流。
- 不自动合并最终 QuickCheck 功能 PR。
- 部署 webhook 首次取不到生产 SHA 的竞态另立 bug，不和本修复混在同一 PR。
