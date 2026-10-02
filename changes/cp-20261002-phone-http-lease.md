## Brain {VERSION} — 手机历史 HTTP 租约身份快照

- 511为手机账本增加独立transport mode与完整Hub/physical HTTP历史版本快照；既有508租约保持SSH/null，不补造身份、创建grant或改当前节点。
- 库内reserveHttp复用既有授权、设备台账与共享整机预约，在锁内从真正持久版本读取身份并写入config digest。快照不可改，缺字段、错版本、错physical身份和caller URL/克隆binding均拒绝。
- 历史lease读取从原账本快照与不可变版本校验取得独立内部品牌；current pointer换版或原grant撤销/过期不改变历史binding。unknown继续占位、不重派，同task跨transport拒绝。
- 本阶段没有HTTP执行接线、controller、activation、grant、canary、cron或部署。HTTP租约执行入口、旧SSH receipt收口与DB执行态仍拒绝；没有把尚未部署的host协调闸当作排他证明，也不生成available。
