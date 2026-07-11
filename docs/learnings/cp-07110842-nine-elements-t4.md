# T4 回执 collector：对外动作三入口接 action_receipts 台账

### 根本原因
migration 315 建了 action_receipts 表但零写入方——"发出即成功"没有任何一处被挑战，
表空转 3 个月。写入方靠 skill 自觉必然重蹈 golden_path 挂死图覆辙，必须代码级接在
动作发起点（notifier/feishu-alert/deploy webhook）。

### 下次预防
- [ ] 建表的 PR 必须同时接至少一个写入方，否则表就是僵尸（九要素 T1 保鲜守卫已把
      "该写的没写"做成棘轮指标，本表的核销率是指标3）
- [ ] 对外动作模块（notifier 等）保持 DB-free import 图：新增 DB 副作用一律动态
      import + fail-open，测试零 mock 负担
