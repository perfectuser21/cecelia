# 需求 — 看门狗PG全天与精确边界增强

任务7a8a09a6-b00c-4cf0-b182-acebeb7fef8e，父0994ab2a-0033-4225-9168-485350c5fc39。

main537ff5已包含自然日S-TREND与独立S-STALE48h/S-FRESH1h基础夹具修复，不重复该成果。本任务剩余范围仅明确测试连接UTC与无时区列解释，使用SQL北京自然日绝对落点增强0/6/12/18/23时，以及恰好24h/超过1ms严格边界；产品SQL、阈值和既有stale/fresh/idle断言保持。25h stale使边界覆盖靠近产品24h阈值。

验收：UTC/上海各8项真实PG通过，原生入口真实执行两时区，完整当前head CI与正规Evaluator/Judge。历史RED7dd及b639/a2db bundle、旧run3684基础设施阻塞与seal c54保留。旧规划合同不得当新scope验收；最新基线需要受控新planning、新seal/currentrun候选。基础修复已合并，不把旧CI失败重新记为未合并成果。
