-- 将 features 表更名为 brain_modules，澄清语义：
-- 这张表跟踪的是 Brain 自身的内部意识模块（tick/cortex/memory/quarantine/immune/desire/alertness 等），
-- 对应 brain-manifest.js 的架构分块，不是 ZenithJoy 客户产品功能表。
-- 客户功能表是 journey_features。
ALTER TABLE features RENAME TO brain_modules;
