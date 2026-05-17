import { useState } from 'react';
import {
  Clock,
  Cpu,
  MemoryStick,
  ChevronRight,
  PlayCircle,
  AlertCircle,
} from 'lucide-react';
import type { VpsSlot } from '../../../../api/brain.api';

export interface TaskCardProps {
  slot: VpsSlot;
  onClick?: (slot: VpsSlot) => void;
}

export function TaskCard({ slot, onClick }: TaskCardProps) {
  const [isHovered, setIsHovered] = useState(false);

  const getStatusColor = (taskType: string | null) => {
    // Running tasks are always blue/animated
    return 'bg-blue-100 text-blue-700 border-blue-200';
  };

  const getPriorityColor = (priority: string | null) => {
    switch (priority) {
      case 'P0':
        return 'bg-red-100 text-red-700';
      case 'P1':
        return 'bg-orange-100 text-orange-700';
      case 'P2':
        return 'bg-yellow-100 text-yellow-700';
      default:
        return 'bg-gray-100 text-gray-700';
    }
  };

  const getTaskTypeColor = (taskType: string | null) => {
    switch (taskType) {
      case 'short':
        return 'bg-green-100 text-green-700';
      case 'long':
        return 'bg-purple-100 text-purple-700';
      default:
        return 'bg-gray-100 text-gray-700';
    }
  };

  const formatDuration = (startTime: string) => {
    try {
      const start = new Date(startTime);
      const now = new Date();
      const diffMs = now.getTime() - start.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      const diffSecs = Math.floor((diffMs % 60000) / 1000);

      if (diffMins > 0) {
        return `${diffMins}m ${diffSecs}s`;
      }
      return `${diffSecs}s`;
    } catch {
      return 'N/A';
    }
  };

  const formatCpu = (cpu: string) => {
    try {
      const value = parseFloat(cpu);
      return `${value.toFixed(1)}%`;
    } catch {
      return cpu;
    }
  };

  const formatMemory = (memory: string) => {
    // Memory is already formatted (e.g., "256 MB")
    return memory;
  };

  const handleClick = () => {
    if (onClick) {
      onClick(slot);
    }
  };

  const isClickable = !!onClick;

  return (
    <div
      className={`
        bg-white rounded-xl border-2 border-gray-200 p-5
        transition-all duration-200
        ${isClickable ? 'cursor-pointer' : ''}
        ${isHovered && isClickable ? 'shadow-lg border-blue-300 scale-105' : 'shadow-sm'}
      `}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={handleClick}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1 min-w-0">
          <h3 className="text-base font-semibold text-gray-900 mb-1 truncate">
            {slot.taskTitle || 'Untitled Task'}
          </h3>
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-full border ${getStatusColor(
                slot.taskType
              )}`}
            >
              <PlayCircle className="w-3 h-3" />
              Running
            </span>
            {slot.taskPriority && (
              <span
                className={`px-2 py-1 text-xs font-medium rounded-full ${getPriorityColor(
                  slot.taskPriority
                )}`}
              >
                {slot.taskPriority}
              </span>
            )}
            {slot.taskType && (
              <span
                className={`px-2 py-1 text-xs font-medium rounded-full ${getTaskTypeColor(
                  slot.taskType
                )}`}
              >
                {slot.taskType}
              </span>
            )}
          </div>
        </div>
        {isClickable && (
          <ChevronRight
            className={`w-5 h-5 text-gray-400 flex-shrink-0 transition-transform ${
              isHovered ? 'translate-x-1' : ''
            }`}
          />
        )}
      </div>

      {/* Metrics */}
      <div className="space-y-2 mb-4">
        <div className="flex items-center gap-2 text-sm">
          <Clock className="w-4 h-4 text-gray-500" />
          <span className="text-gray-600">Duration:</span>
          <span className="font-medium text-gray-900">
            {slot.startedAt ? formatDuration(slot.startedAt) : 'N/A'}
          </span>
        </div>

        <div className="flex items-center gap-2 text-sm">
          <Cpu className="w-4 h-4 text-gray-500" />
          <span className="text-gray-600">CPU:</span>
          <span className="font-medium text-gray-900">
            {formatCpu(slot.cpu)}
          </span>
        </div>

        <div className="flex items-center gap-2 text-sm">
          <MemoryStick className="w-4 h-4 text-gray-500" />
          <span className="text-gray-600">Memory:</span>
          <span className="font-medium text-gray-900">
            {formatMemory(slot.memory)}
          </span>
        </div>
      </div>

      {/* Footer - Task/Run ID */}
      {(slot.taskId || slot.runId) && (
        <div className="pt-3 border-t border-gray-200">
          <div className="flex items-center gap-2 text-xs text-gray-500">
            {slot.taskId && (
              <span className="truncate" title={slot.taskId}>
                Task: {slot.taskId.substring(0, 8)}
              </span>
            )}
            {slot.runId && (
              <span className="truncate" title={slot.runId}>
                Run: {slot.runId.substring(0, 8)}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
