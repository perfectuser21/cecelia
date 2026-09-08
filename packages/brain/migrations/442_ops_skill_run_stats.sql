-- 442: skill 级运行统计（运行舱刀8-A，task 3002108d）
-- 来源：n8n execution_data 阶段级归因（每个「阶段 X」节点的 executionStatus/executionTime）。
-- 价值：流程级 success ≠ 每阶段都成功——实测 40 条 run 里仅 19 条走到首阶段之后，
-- 逐 skill 真实成功率只能从阶段级来。有了它，DisCo 档位才能自动判（不再全是"等人确认"）。
ALTER TABLE ops_skills ADD COLUMN IF NOT EXISTS runs INTEGER;
ALTER TABLE ops_skills ADD COLUMN IF NOT EXISTS run_success INTEGER;
ALTER TABLE ops_skills ADD COLUMN IF NOT EXISTS run_success_rate INTEGER;
ALTER TABLE ops_skills ADD COLUMN IF NOT EXISTS run_avg_sec INTEGER;
ALTER TABLE ops_skills ADD COLUMN IF NOT EXISTS run_stats_at TIMESTAMPTZ;
