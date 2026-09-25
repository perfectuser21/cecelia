-- Migration 467: 验证 466 里 NOT VALID 的 tasks_kind_check
--
-- 466 用 NOT VALID 登记约束（只写目录项，不扫存量行），并在同一事务里把全表 kind 回填成
-- 合法值。本文件单独 VALIDATE CONSTRAINT：只需 SHARE UPDATE EXCLUSIVE 锁，与普通 DML
-- 可并发；migrate.js 每文件一个事务，466 的 ACCESS EXCLUSIVE 在本文件开始前已随 466 提交
-- 释放。拆法与 461/462、463/464 一致。
--
-- 466 回填后存量行必然满足（agent/workflow 二选一），VALIDATE 理论上不会报错；真报错说明
-- 466 与本文件之间有人直插了非法 kind（NOT VALID 约束对新写入照样生效，所以几乎不可能），
-- 需人工排查具体行再重跑。幂等：VALIDATE 对已验证的约束是空操作。

ALTER TABLE tasks VALIDATE CONSTRAINT tasks_kind_check;

INSERT INTO schema_version (version, description)
VALUES ('467', 'VALIDATE tasks_kind_check（466 的 NOT VALID 收尾）')
ON CONFLICT (version) DO NOTHING;
