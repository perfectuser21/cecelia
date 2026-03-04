-- Migration 116: Add execution_mode column to projects table
-- Stores who is responsible for executing a project: 'cecelia' / 'xx' / null (unset)
-- Synced from Notion Projects DB "Execution Mode" select property

ALTER TABLE projects ADD COLUMN IF NOT EXISTS execution_mode VARCHAR(20);

COMMENT ON COLUMN projects.execution_mode IS 'Execution owner: cecelia = auto-dispatch, xx = user handles, null = unset (treated as cecelia)';
