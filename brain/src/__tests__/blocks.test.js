/**
 * Blocks API Tests
 * Tests for Notion-like Page Content functionality
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';

const { Pool } = pg;

const API_BASE = process.env.API_BASE || 'http://localhost:5221/api/brain';

// Test database connection
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'cecelia',
  user: process.env.DB_USER || 'cecelia',
  password: process.env.DB_PASSWORD || 'CeceliaUS2026'
});

// Test data
const TEST_PARENT_ID = '99999999-9999-9999-9999-999999999999';
const TEST_PARENT_TYPE = 'goal';
let createdBlockId = null;

describe('Blocks API', () => {
  beforeAll(async () => {
    // Clean up any existing test data
    await pool.query('DELETE FROM blocks WHERE parent_id = $1', [TEST_PARENT_ID]);
  });

  afterAll(async () => {
    // Clean up test data
    await pool.query('DELETE FROM blocks WHERE parent_id = $1', [TEST_PARENT_ID]);
    await pool.end();
  });

  describe('POST /api/brain/blocks', () => {
    it('should create a block successfully', async () => {
      const res = await fetch(`${API_BASE}/blocks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parent_id: TEST_PARENT_ID,
          parent_type: TEST_PARENT_TYPE,
          type: 'heading_1',
          content: { text: 'Test Heading' }
        })
      });

      const data = await res.json();
      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.block).toBeDefined();
      expect(data.block.type).toBe('heading_1');
      expect(data.block.content.text).toBe('Test Heading');
      expect(data.block.order_index).toBe(0);

      createdBlockId = data.block.id;
    });

    it('should auto-increment order_index', async () => {
      const res = await fetch(`${API_BASE}/blocks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parent_id: TEST_PARENT_ID,
          parent_type: TEST_PARENT_TYPE,
          type: 'paragraph',
          content: { text: 'Test paragraph' }
        })
      });

      const data = await res.json();
      expect(res.status).toBe(200);
      expect(data.block.order_index).toBe(1);
    });

    it('should return 400 for missing required fields', async () => {
      const res = await fetch(`${API_BASE}/blocks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parent_id: TEST_PARENT_ID
          // missing parent_type and type
        })
      });

      const data = await res.json();
      expect(res.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toContain('Missing required fields');
    });

    it('should return 400 for invalid parent_type', async () => {
      const res = await fetch(`${API_BASE}/blocks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parent_id: TEST_PARENT_ID,
          parent_type: 'invalid_type',
          type: 'paragraph',
          content: { text: 'Test' }
        })
      });

      const data = await res.json();
      expect(res.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toContain('Invalid parent_type');
    });

    it('should return 400 for invalid block type', async () => {
      const res = await fetch(`${API_BASE}/blocks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parent_id: TEST_PARENT_ID,
          parent_type: TEST_PARENT_TYPE,
          type: 'invalid_block_type',
          content: { text: 'Test' }
        })
      });

      const data = await res.json();
      expect(res.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toContain('Invalid block type');
    });
  });

  describe('GET /api/brain/blocks/:parentType/:parentId', () => {
    it('should get all blocks for a parent', async () => {
      const res = await fetch(`${API_BASE}/blocks/${TEST_PARENT_TYPE}/${TEST_PARENT_ID}`);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(Array.isArray(data.blocks)).toBe(true);
      expect(data.blocks.length).toBeGreaterThanOrEqual(2);
    });

    it('should return blocks in order', async () => {
      const res = await fetch(`${API_BASE}/blocks/${TEST_PARENT_TYPE}/${TEST_PARENT_ID}`);
      const data = await res.json();

      expect(data.blocks[0].order_index).toBe(0);
      expect(data.blocks[1].order_index).toBe(1);
    });

    it('should return 400 for invalid parent_type', async () => {
      const res = await fetch(`${API_BASE}/blocks/invalid_type/${TEST_PARENT_ID}`);
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.success).toBe(false);
    });
  });

  describe('PUT /api/brain/blocks/:id', () => {
    it('should update block content', async () => {
      const res = await fetch(`${API_BASE}/blocks/${createdBlockId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: { text: 'Updated Heading' }
        })
      });

      const data = await res.json();
      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.block.content.text).toBe('Updated Heading');
    });

    it('should update block type', async () => {
      const res = await fetch(`${API_BASE}/blocks/${createdBlockId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'heading_2'
        })
      });

      const data = await res.json();
      expect(res.status).toBe(200);
      expect(data.block.type).toBe('heading_2');
    });

    it('should return 400 for no fields to update', async () => {
      const res = await fetch(`${API_BASE}/blocks/${createdBlockId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });

      const data = await res.json();
      expect(res.status).toBe(400);
      expect(data.error).toContain('No fields to update');
    });

    it('should return 404 for non-existent block', async () => {
      const res = await fetch(`${API_BASE}/blocks/00000000-0000-0000-0000-000000000000`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: { text: 'Test' }
        })
      });

      const data = await res.json();
      expect(res.status).toBe(404);
    });
  });

  describe('PUT /api/brain/blocks/reorder', () => {
    it('should reorder blocks', async () => {
      // Get current blocks
      const getRes = await fetch(`${API_BASE}/blocks/${TEST_PARENT_TYPE}/${TEST_PARENT_ID}`);
      const getData = await getRes.json();
      const blocks = getData.blocks;

      // Reverse the order
      const reorderData = blocks.map((b, i) => ({
        id: b.id,
        order_index: blocks.length - 1 - i
      }));

      const res = await fetch(`${API_BASE}/blocks/reorder`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blocks: reorderData })
      });

      const data = await res.json();
      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.updated).toBe(blocks.length);
    });

    it('should return 400 for empty blocks array', async () => {
      const res = await fetch(`${API_BASE}/blocks/reorder`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blocks: [] })
      });

      const data = await res.json();
      expect(res.status).toBe(400);
    });

    it('should return 400 for invalid block format', async () => {
      const res = await fetch(`${API_BASE}/blocks/reorder`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          blocks: [{ id: 'test' }] // missing order_index
        })
      });

      const data = await res.json();
      expect(res.status).toBe(400);
    });
  });

  describe('DELETE /api/brain/blocks/:id', () => {
    it('should delete a block', async () => {
      // Create a block to delete
      const createRes = await fetch(`${API_BASE}/blocks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parent_id: TEST_PARENT_ID,
          parent_type: TEST_PARENT_TYPE,
          type: 'paragraph',
          content: { text: 'To be deleted' }
        })
      });
      const createData = await createRes.json();
      const blockToDelete = createData.block.id;

      // Delete it
      const res = await fetch(`${API_BASE}/blocks/${blockToDelete}`, {
        method: 'DELETE'
      });

      const data = await res.json();
      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.deleted.id).toBe(blockToDelete);
    });

    it('should return 404 for non-existent block', async () => {
      const res = await fetch(`${API_BASE}/blocks/00000000-0000-0000-0000-000000000000`, {
        method: 'DELETE'
      });

      const data = await res.json();
      expect(res.status).toBe(404);
    });
  });
});
