-- Migration 295: Add kind, group, workflow_ref columns to journey_features
-- kind: 区分 ability（客户价值 workflow）和 feature（使能件）
-- group: Ability Group 聚合字段（对应 Notion Project 层，如 "抖音发布"）
-- workflow_ref: 关联的工作流引用

ALTER TABLE journey_features ADD COLUMN IF NOT EXISTS kind VARCHAR(50) DEFAULT 'feature';
ALTER TABLE journey_features ADD COLUMN IF NOT EXISTS "group" VARCHAR(100);
ALTER TABLE journey_features ADD COLUMN IF NOT EXISTS workflow_ref VARCHAR(255);
