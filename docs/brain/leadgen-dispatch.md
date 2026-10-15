# 四独立获客正规任务入口

来源：Task 7071f6c9-8558-4eec-b0c6-31d49430d7c5。Brain `workflow_dispatch` 的60秒调度周期消费任务；本文不声明生产已激活或自动Skill兜底。

| workflow_key | 正式执行目标 | 显式上游 | 业务输出 |
|---|---|---|---|
| douyin_video_discovery | M4登记手机 | 公司已启用搜索配置 | 视频与真实地址落库 |
| douyin_video_processing | M4登记手机 | 101真实tag+external binding run | 合格视频、评论与原生身份原件 |
| douyin_comment_scoring | MMV，mmv-scoring/none | 102真实tag+external binding run | 原公司政策评分、线索与桥接队列 |
| douyin_lead_outreach | M4登记且公司授权手机 | 正式合格队列 | 原审批/暂停/配额保护下触达、写回 |

正常 POST `/api/brain/tasks`，`task_type=workflow_dispatch`，payload必须包含：

```json
{
  "workflow_key":"douyin_comment_scoring",
  "workflow_definition":{
    "release_id":"实际MMV当前生产release UUID",
    "observation_id":"对应当前ACK observation UUID",
    "workflow_definition_version_id":"当前完整冻结103 version UUID",
    "snapshot_sha256":"该version真实payload_sha256"
  },
  "leadgen":{
    "line":"jinuo",
    "company_id":"实际启用公司UUID",
    "source_run":"实际102批次tag",
    "source_binding_run_id":"douyin_video_processing-实际102批次tag__a1",
    "limit":5
  }
}
```

101不传source字段。102将上游改成101；额外可传comment_limit（1–50）。101/102/104必须提供profile与serial，均通过中央手机台账及公司已核账号配置；103禁止这两个字段。104必须明确send_authorized=true，不接受source或任意env。limit为1–50（104上限10）。计划与目标发布、实际manifest精确固定后才调用原正式CLI。

治理入口 PATCH `/api/brain/workflows/<四正式UUID>/runtime-status` 只接受内网授权。先正常登记并认领治理Task，payload.actor为实际执行者，payload.workflow_runtime_scope为获准控制的workflow UUID数组；请求携task_id/actor/reason/status。启用还必须提供上例workflow_definition中的四个固定字段（放请求顶层）。启用严格要求当前同源完整版本、正确生产目标和真实部署ACK；暂停无需破损发布先恢复。变更、事件和读回在同一事务。默认状态保持paused；该入口不替代每个业务任务的批次、公司、手机及发送授权核验。

调度controller run为`wfd-<task UUID>`；external业务run独立为`<workflow_key>-brain<去横线task UUID>__a1`，两者不得混用。中央任务payload保留显式关联。控制器首次启动用原子预留，SSH未知后只读恢复；不自动重发。进程退出、冻结原件/ACK、中央binding及完整span路径核实后才能完成任务。104空队列不能记成已发送。跨机未知或MMV controller死亡不能证明M4业务停止；设备锁由专属真实收割释放，人工处理也须先核实际业务终态。
