# Workflow 派发与公共 Runner

新 `workflow_dispatch`（包含历史 `commander-v2` 标签）统一进入 `workflow-common-runner-adapter.js`，经 `common-runner-dispatch.js` 的正式运行入口执行。业务顺序来自固定 Activity 文件；Commander不再通过SSH消息执行整个流程。任务仍为原task，一个UUID run只登记一次。网络/回执未知后只inspect，禁止重发业务。

## 固定路由

运营侧设置 `WORKFLOW_COMMON_RUNNER_ROUTES_FILE` 为绝对路径的600文件（root/执行用户所有、拒绝符号链接）。结构为 `{"schema_version":1,"routes":{"<workflow_key>":{...}}}`。每条路由必须包含：

| 字段 | 必须对应 |
| --- | --- |
| profile / profile_sha256 / machine_id | Worker固定profile及执行目录grant |
| definition | release_id、workflow_id、workflow_definition_version_id、snapshot_sha256、runtime_snapshot_sha256 |
| components_sha256 | 已冻结release.payload.components的规范JSON SHA256，含code/skill版本 |
| resources | 冻结合同原machine/profile/serial/account_ref |

任务已有definition时必须精确匹配路由；没有时仅能采用保护文件内固定definition。`workflow_input`按冻结input_schema校验，禁止从标题猜发布授权、素材或账号。source适配仅内部进程授权workflow任务；公共HTTP接口仍拒绝payload伪造的workflow权限。无路由/缺输入记录 `workflow_common_preflight_rejected`，保持queued、不能回退旧AI业务循环。

Worker中央manifest及独立验收确认后才归位任务；`execution_unknown=true`一票否决中央终态。Brain手机锁仅在同run cleanup独立pass后释放，未知不释放。旧在途run只读收割/独立验收，prepared/recovering不再启动另一个旧业务循环，不移植run_id、不借机释放锁。

## 发布迁移的真实边界

ZenithJoy新增 `publish-runner-adapter.mjs` 生成公共Runner正式profile：每个slot需要固定executor、独立precondition/validator及原Activity/Step身份，全部源码/Skill必须字节摘要匹配冻结组件。发布最多一次，默认不恢复/不重试。新增 `commander/publish-native-activity.py` 只执行preflight或cleanup，复用原`wf-v2-phone.py`、`wf-v2-shell.py`精确owner锁、原证归档与根目录身份检查；不派生业务agent。

**尚未证明现役发布业务完整可运行**：当前普通工厂brief是Ai办公室账号且要求现造素材；现仓发布合同是人工智能小诺考评账号，要求明确title/body/media_path/hash/authorized输入。现合同prepare/publish/verify的implementation仍标missing，缺正式单slot执行及独立validator manifest。不能将另一个账号profile套用旧任务，不能用旧整块AI执行器包装为一项Activity声称迁移完成。上述缺口必须由合法冻结合同/实际实现补齐再装配路由；本次没有部署或修改生产调度配置。
