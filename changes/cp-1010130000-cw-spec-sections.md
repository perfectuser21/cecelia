## Brain {VERSION} — coding harness：规格必须登记未真验的链路，判定点写库，推迟必须带任务

- 决策 a1fdbc51 审计 P2 批次 D，对应旧 proposer / reviewer 规矩：
  - #10：02 必须有 `## 未覆盖真实链路`（可写「无：理由」），spec-check 强制；publish 把这一段原样放进 PR 正文。
  - #11 / #12 / #13：spec prompt 要求写真实调用方的请求 shape 与出处、第三方至少一条 Q-n 真调（调不了登记进未覆盖链路）、对外改动写失败语义与输入对抗面、可选 `## 判定点`（五要素齐全才算，缺要素判 `judgment_invalid`）；合同对抗的「漏了真实路径」点名这些。
  - #14：合同对抗结束时，`## 判定点` 写进 Brain decisions（category=judgment，topic `判定点[<task 前 8 位>#n]: 名称` 去重，重跑不重复写），回读条数记 `outputs.gan.judgments_written`。写不进去不挡合同，升级 `judgments_write_failed`。
  - #16：开发方以「后续再做/另开/下一期」驳回却没给 Brain 任务 ID → 下一轮 `UNTRACKED_DEFERRALS` 点名，QA 必须坚持，关掉判格式不合格。
