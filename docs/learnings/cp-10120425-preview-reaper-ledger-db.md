## 预览 reaper 连错台账库 + start 503 原因被吞（2026-10-12）

### 根本原因
- MMV 上 preview-agent 的台账库是 DB_NAME=cecelia_staging，MMV 根本没有 cecelia 库；preview-reaper.sh 却写死 `-d cecelia`（或不带 -d 连与用户同名的库），源 C/源 D/闲置查询/UPDATE/DB_EXISTS 全部失败，每小时打印「表状态更新失败」7000+ 次仍照报「回收完成」。已关闭的 6220 只被删了目录，台账行和预览库永久占着 6 个名额之一，新 PR 预览 503 too_many_active。
- preview-env-start.sh 早已改成 `LEDGER_DB=${PREVIEW_LEDGER_DB:-${DB_NAME:-cecelia}}`，reaper 漏改；reaper 测试的 psql mock 只按 SQL 文本分支、不看 -d，所以抓不到连错库。
- request-preview-start.sh 用 `curl -f`，503 响应体（含 reason）被丢，CI 日志只剩 `curl: (22) ... 503`，too_many_active 一直没被定位；容量类拒绝还白白重试 12×5s。

### 下次预防
- [ ] 同一张表的读写者（agent / start / reaper）必须共用同一个台账库变量口径，新增读写者照抄 LEDGER_DB 那一行
- [ ] 连库的 mock 必须严格校验 -d（错库就 FATAL 退出），只按 SQL 文本分支的 mock 会掩盖连错库
- [ ] 后台对账脚本关键依赖（台账库）不可达时要非零退出 + P1 日志，「更新失败但照报完成」等于静默空转
- [ ] HTTP 调用不要用 curl -f 吞响应体；拒绝类响应先打印原因再决定重试与否
- [ ] main 上修了预览脚本不等于 MMV 生效：crontab/plist 固定在 cecelia-preview-releases 的旧快照，需走预览主机发布（B2/B2'）
