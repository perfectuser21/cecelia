-- 538 回滚：删裁判结果表与只追加触发器函数（裁判史随之丢弃；spans/对账逻辑不受影响）
BEGIN;

DROP TABLE IF EXISTS activity_judgments;
DROP FUNCTION IF EXISTS activity_judgments_append_only();

DELETE FROM schema_version WHERE version = '538';

COMMIT;
