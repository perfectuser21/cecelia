-- Migration 254: 修复 nas-backup smoke_cmd
-- /api/brain/status 无 .status 字段，改用 /api/brain/health

UPDATE features
SET smoke_cmd = 'curl -sf http://localhost:5221/api/brain/health | jq -e ''.status == "healthy"'''
WHERE id = 'nas-backup';
