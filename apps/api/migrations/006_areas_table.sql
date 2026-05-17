-- Areas table for PARA alignment
CREATE TABLE IF NOT EXISTS areas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  notion_page_id VARCHAR(255),
  icon VARCHAR(50),
  color VARCHAR(50),
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Initial data (aligned with Notion)
INSERT INTO areas (name, notion_page_id, icon, sort_order) VALUES
  ('AI Systems & Automation', NULL, '🤖', 1),
  ('Social Media', '21b53f413ec580d6bac3d08e55272d24', '📱', 2),
  ('ZenithJoy', '21a53f413ec580a388dadbd501acaa2b', '🏢', 3),
  ('Stock Investment', '00fc3ac69ab54c5d8f77927a75ff775d', '📈', 4),
  ('Learning & Growth', '578795ce589e480fafaa4ddec752e560', '📚', 5),
  ('Hobbies & Creative', '22053f413ec5804ead26edc3b1435b33', '🎨', 6),
  ('Life Management', '22053f413ec58070bcbcf33df92f40bb', '🏠', 7),
  ('Meta', '2c353f413ec580519ceef0e44ac0a8c5', '⚙️', 8),
  ('Cecelia', '2f253f413ec581f182fbf4a1cef5fd5c', '🧠', 9)
ON CONFLICT DO NOTHING;

-- Add area_id to projects table
ALTER TABLE projects ADD COLUMN IF NOT EXISTS area_id UUID REFERENCES areas(id);
