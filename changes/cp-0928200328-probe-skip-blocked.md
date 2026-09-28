## Brain {VERSION} — 探针判定：阶段没跑（blocked）不判（任务 4ca3b584）

- `business-probe-judge.handleRunFinished`：`result.stage_status === 'blocked'`（not_in_profile / no_cards / lock_busy / push=0 skipped，阶段根本没跑）直接 `skipped: stage_not_run`，不写回执、不翻格子色。此前账本 init 开跑即写 scoring blocked 占位工件，探针读到「本批 0 条待分拣」判 PASS，评分格子整天假绿
- `failed`（跑了但失败）照判，不受影响
