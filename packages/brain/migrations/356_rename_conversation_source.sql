-- Migration 356: 历史 captures.source='conversation' 行改名为 'conversation-claude'
-- decision 39fa77ac-4915-4dae-90df-7f24745f102d：conversation 拆分为按工具区分的三个 source 值
-- (PR#4135 上线期间写入的行全部来自 Claude Code，改名不丢语义)
UPDATE captures SET source = 'conversation-claude' WHERE source = 'conversation';
