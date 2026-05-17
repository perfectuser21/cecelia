// useBlocks - CRUD hook for blocks API
import { useState, useEffect, useCallback } from 'react';
import { Block, BlockType, BlockContent } from './types';

interface UseBlocksResult {
  blocks: Block[];
  loading: boolean;
  error: string | null;
  createBlock: (type: BlockType, content?: BlockContent) => Promise<Block | null>;
  updateBlock: (id: string, content: BlockContent) => Promise<boolean>;
  deleteBlock: (id: string) => Promise<boolean>;
  reorderBlocks: (orderedIds: string[]) => Promise<boolean>;
  refresh: () => void;
}

export function useBlocks(parentType: string, parentId: string): UseBlocksResult {
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchBlocks = useCallback(async () => {
    if (!parentId) {
      setBlocks([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const res = await fetch(`/api/brain/blocks/${parentType}/${parentId}`);
      if (!res.ok) throw new Error('Failed to fetch blocks');
      const data = await res.json();
      setBlocks(data.blocks || []);
      setError(null);
    } catch (err) {
      console.error('Failed to fetch blocks:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
      setBlocks([]);
    } finally {
      setLoading(false);
    }
  }, [parentType, parentId]);

  useEffect(() => {
    fetchBlocks();
  }, [fetchBlocks]);

  const createBlock = useCallback(async (type: BlockType, content: BlockContent = {}): Promise<Block | null> => {
    try {
      const res = await fetch('/api/brain/blocks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parent_id: parentId,
          parent_type: parentType,
          type,
          content,
        }),
      });
      if (!res.ok) throw new Error('Failed to create block');
      const data = await res.json();
      if (data.success && data.block) {
        setBlocks(prev => [...prev, data.block]);
        return data.block;
      }
      return null;
    } catch (err) {
      console.error('Failed to create block:', err);
      return null;
    }
  }, [parentId, parentType]);

  const updateBlock = useCallback(async (id: string, content: BlockContent): Promise<boolean> => {
    try {
      const res = await fetch(`/api/brain/blocks/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) throw new Error('Failed to update block');
      const data = await res.json();
      if (data.success && data.block) {
        setBlocks(prev => prev.map(b => b.id === id ? data.block : b));
        return true;
      }
      return false;
    } catch (err) {
      console.error('Failed to update block:', err);
      return false;
    }
  }, []);

  const deleteBlock = useCallback(async (id: string): Promise<boolean> => {
    try {
      const res = await fetch(`/api/brain/blocks/${id}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to delete block');
      setBlocks(prev => prev.filter(b => b.id !== id));
      return true;
    } catch (err) {
      console.error('Failed to delete block:', err);
      return false;
    }
  }, []);

  const reorderBlocks = useCallback(async (orderedIds: string[]): Promise<boolean> => {
    try {
      const reorderData = orderedIds.map((id, index) => ({
        id,
        order_index: index,
      }));
      const res = await fetch('/api/brain/blocks/reorder', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blocks: reorderData }),
      });
      if (!res.ok) throw new Error('Failed to reorder blocks');

      // Update local state
      setBlocks(prev => {
        const blockMap = new Map(prev.map(b => [b.id, b]));
        return orderedIds
          .map((id, index) => {
            const block = blockMap.get(id);
            return block ? { ...block, order_index: index } : null;
          })
          .filter((b): b is Block => b !== null);
      });
      return true;
    } catch (err) {
      console.error('Failed to reorder blocks:', err);
      return false;
    }
  }, []);

  return {
    blocks,
    loading,
    error,
    createBlock,
    updateBlock,
    deleteBlock,
    reorderBlocks,
    refresh: fetchBlocks,
  };
}
