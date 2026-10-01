# 需求 — rescan CI远端SHA夹具隔离

任务79ed8593-9613-45df-a1e8-707b1172fe41，父0994ab2a-0033-4225-9168-485350c5fc39，关联8804与7a8既有候选。

PR5791 current881dd的金字塔CI中，rescan测试先保存线上main SHA、随后各case实时重读；自动版本提交在测试中途推进，导致四个断言因夹具竞态失败。永久测试用外层git首次111…40、随后222…40稳定模拟推进，RED准确8通过4失败。

仅测试自身ls-remote origin refs/heads/main由固定完整SHA夹具提供；其他git命令转发原真实binary。产品scripts/scan/rescan-if-changed.sh零改，SHA变化、TTL、成功记账、失败不记账、锁和超时断言全部保留。测试outer/inner锁只使用自有TMPD与既有RESCAN_LOCK_DIR seam，不触主机全局锁；此不构成生产默认全局锁运行验收。

永久边界回归加入同一CI job。验收要求全部12原行为case执行、无离线跳过，边界回归和原生入口真实通过、当前head完整CI及正规Evaluator/Judge；不重试刷绿，不修改旧失败/审批/receipt。
