-- Migration 462: 验证 461 里 NOT VALID 的 tasks_executor_kind_check
--
-- 秋米中文 GTD 表接入 Brain 统一调度·PR2 入口（task b7efdbff，决策 b8abd28c）。
-- 461 把 executor_kind 白名单扩到八值（补 'openclaw-agent'）时用了 NOT VALID——
-- 只做目录项登记，毫秒级，不扫存量行；tasks 是高频写表，DROP+ADD 在同一事务里扫全表
-- 会拿 ACCESS EXCLUSIVE 挡住派发/回写。本文件单独跑 VALIDATE CONSTRAINT：只需
-- SHARE UPDATE EXCLUSIVE 锁，与普通 DML 可并发；migrate.js 每文件一个事务，461 的
-- ACCESS EXCLUSIVE 在本文件开始前已随 461 提交释放。拆法与 PR1 的 459/460 一致。
--
-- 本次是放宽约束（七值 → 八值），存量行必然满足，VALIDATE 理论上不会报错；真报错说明
-- 库里有既不在新白名单、也不为 NULL 的 executor_kind，需人工排查具体行再重跑。
-- 幂等：VALIDATE 对已验证的约束是空操作，CI 重放全部 migration 安全。

ALTER TABLE tasks VALIDATE CONSTRAINT tasks_executor_kind_check;

INSERT INTO schema_version (version, description)
VALUES ('462', 'VALIDATE tasks_executor_kind_check（461 的 NOT VALID 收尾，openclaw-agent 入白名单）')
ON CONFLICT (version) DO NOTHING;
