import { useState, useCallback } from 'react';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { Plus, Loader2 } from 'lucide-react';
import { BlockEditorProps, BlockType, BlockContent } from './types';
import { useBlocks } from './useBlocks';
import { Block } from './Block';
import { BlockMenu } from './BlockMenu';

export function BlockEditor({ parentType, parentId, readOnly = false }: BlockEditorProps) {
  const { blocks, loading, error, createBlock, updateBlock, deleteBlock, reorderBlocks } = useBlocks(parentType, parentId);
  const [menuOpen, setMenuOpen] = useState(false);

  const handleDragEnd = useCallback((result: DropResult) => {
    if (!result.destination) return;
    if (result.source.index === result.destination.index) return;

    const reorderedBlocks = Array.from(blocks);
    const [removed] = reorderedBlocks.splice(result.source.index, 1);
    reorderedBlocks.splice(result.destination.index, 0, removed);

    const orderedIds = reorderedBlocks.map(b => b.id);
    reorderBlocks(orderedIds);
  }, [blocks, reorderBlocks]);

  const handleAddBlock = useCallback(async (type: BlockType, content?: BlockContent) => {
    await createBlock(type, content);
  }, [createBlock]);

  const handleUpdateBlock = useCallback((id: string) => (content: BlockContent) => {
    updateBlock(id, content);
  }, [updateBlock]);

  const handleDeleteBlock = useCallback((id: string) => () => {
    deleteBlock(id);
  }, [deleteBlock]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 text-slate-400">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        Loading...
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-4 px-3 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg text-sm">
        Error loading blocks: {error}
      </div>
    );
  }

  return (
    <div className="block-editor pl-8">
      <DragDropContext onDragEnd={handleDragEnd}>
        <Droppable droppableId="blocks">
          {(provided) => (
            <div
              ref={provided.innerRef}
              {...provided.droppableProps}
              className="space-y-1"
            >
              {blocks.map((block, index) => (
                <Draggable
                  key={block.id}
                  draggableId={block.id}
                  index={index}
                  isDragDisabled={readOnly}
                >
                  {(provided, snapshot) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.draggableProps}
                      className={snapshot.isDragging ? 'opacity-50' : ''}
                    >
                      <Block
                        block={block}
                        onUpdate={handleUpdateBlock(block.id)}
                        onDelete={handleDeleteBlock(block.id)}
                        readOnly={readOnly}
                        dragHandleProps={provided.dragHandleProps ?? undefined}
                      />
                    </div>
                  )}
                </Draggable>
              ))}
              {provided.placeholder}
            </div>
          )}
        </Droppable>
      </DragDropContext>

      {/* Add block button */}
      {!readOnly && (
        <div className="relative mt-2">
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="flex items-center gap-2 px-3 py-2 text-sm text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add block
          </button>

          {menuOpen && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setMenuOpen(false)}
              />
              <BlockMenu
                onSelect={handleAddBlock}
                onClose={() => setMenuOpen(false)}
              />
            </>
          )}
        </div>
      )}

      {/* Empty state */}
      {blocks.length === 0 && !readOnly && (
        <div className="py-8 text-center text-slate-400">
          <p className="text-sm">No content yet</p>
          <p className="text-xs mt-1">Click "Add block" to start adding content</p>
        </div>
      )}
    </div>
  );
}
