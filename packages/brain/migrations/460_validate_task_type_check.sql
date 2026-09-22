-- Migration 460: 验证 459 里 NOT VALID 的 tasks_task_type_check
--
-- 秋米中文 GTD 表接入 Brain 统一调度·PR1 地基（task 15f42776，决策 b8abd28c）。
-- 终审 Important #1：459 把重建 CHECK、回填 tenant_id、重建去重索引四类重活挤在
-- 同一个事务，其中"DROP+ADD CONSTRAINT 需要扫全表验证"这一步最重——尤其 tasks 是
-- 高频写表，长事务持锁会挡住派发/回写。459 已把 ADD CONSTRAINT 改成 NOT VALID
-- （只做目录项登记，毫秒级，不扫存量行），本文件单独跑 VALIDATE CONSTRAINT——
-- 只需要 SHARE UPDATE EXCLUSIVE 锁，不阻塞并发的 SELECT/INSERT/UPDATE/DELETE
-- （Postgres 官方语义：VALIDATE CONSTRAINT 的扫描与普通 DML 可并发），且本文件是
-- 独立的迁移文件、独立的事务（migrate.js 每文件一个 BEGIN/COMMIT），459 的
-- ACCESS EXCLUSIVE 锁（索引重建那步）在本文件开始前已经随 459 提交释放。
--
-- 若存量行确实有不合规 task_type（理论上不该有——CHECK 从 457 起就覆盖全部历史
-- 值，NOT VALID 只是不重新扫描，不代表放宽了约束本身），VALIDATE 会直接报错，
-- 此时需要人工排查具体行再重跑本迁移（幂等：VALIDATE 对已验证的约束是空操作）。
--
-- 全部 DDL 幂等：CI 会重放全部 migration。

ALTER TABLE tasks VALIDATE CONSTRAINT tasks_task_type_check;
