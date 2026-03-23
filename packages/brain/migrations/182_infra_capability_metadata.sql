-- Migration 182: 补充 INFRA 能力的 related_skills / key_tables 元数据
--
-- 问题：PR #1463 为 capability-scanner 添加了 INFRA_DEPLOYED_CAPABILITIES 白名单，
-- 但以下 5 个能力在 DB 中没有任何 related_skills / key_tables，
-- 导致扫描器完全依赖 JS 硬编码集合判断，无法自主积累证据。
--
-- 修正策略：为有间接证据的 INFRA 能力补充 DB 元数据，
-- 使其在白名单不存在时仍可通过 taskUsageMap / tableCountCache 检测为 active：
--
--   branch-protection-hooks: related_skills=['dev']
--     dev 任务正在执行 = branch-protect hooks 在运行（taskUsageMap['dev'] 有 30 条）
--
--   ci-devgate-quality: related_skills=['dev']
--     dev PR 流经 CI = DevGate 门禁有效（同上）
--
--   brain-deployment: related_skills=['dev']
--     dev 合并触发 Brain 部署（auto-version.yml）
--
--   cecelia-dashboard: key_tables=['tasks']
--     Dashboard 核心功能读取 tasks 表，表存在且有数据 = Dashboard 部署有效
--
--   zenithjoy-dashboard: key_tables=['tasks']
--     ZenithJoy Dashboard 同样读取 tasks 表显示 OKR/任务进度
--
-- 剩余 4 个纯基础设施能力（cloudflare-tunnel-routing / nas-file-storage /
-- tailscale-internal-network / vpn-service-management）无 DB 可查证据，
-- 继续由 INFRA_DEPLOYED_CAPABILITIES 白名单处理，不在此 migration 修改。

UPDATE capabilities
SET related_skills = ARRAY['dev']
WHERE id IN ('branch-protection-hooks', 'ci-devgate-quality', 'brain-deployment')
  AND (related_skills IS NULL OR related_skills = '{}');

UPDATE capabilities
SET key_tables = ARRAY['tasks']
WHERE id IN ('cecelia-dashboard', 'zenithjoy-dashboard')
  AND (key_tables IS NULL OR key_tables = '{}');
