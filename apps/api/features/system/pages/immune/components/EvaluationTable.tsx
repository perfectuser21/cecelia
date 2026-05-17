/**
 * Evaluation Table Component
 *
 * 评估历史表格 - 显示策略的评估记录
 */

import React from 'react';
import type { PolicyEvaluation } from '../../../types/immune';

interface EvaluationTableProps {
  evaluations: PolicyEvaluation[];
  loading?: boolean;
}

export function EvaluationTable({ evaluations, loading }: EvaluationTableProps) {
  if (loading) {
    return (
      <div className="animate-pulse">
        <div className="h-10 bg-gray-200 dark:bg-gray-700 rounded mb-2" />
        <div className="h-10 bg-gray-200 dark:bg-gray-700 rounded mb-2" />
        <div className="h-10 bg-gray-200 dark:bg-gray-700 rounded mb-2" />
      </div>
    );
  }

  if (evaluations.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500 dark:text-gray-400">No evaluations yet</div>
    );
  }

  const getModeColor = (mode: PolicyEvaluation['mode']) => {
    switch (mode) {
      case 'simulate':
        return 'text-blue-600 dark:text-blue-400';
      case 'apply':
        return 'text-green-600 dark:text-green-400';
      case 'promote':
        return 'text-purple-600 dark:text-purple-400';
      default:
        return 'text-gray-600 dark:text-gray-400';
    }
  };

  const getResultColor = (result: PolicyEvaluation['result']) => {
    if (result === 'success' || result === 'would_succeed') {
      return 'text-green-600 dark:text-green-400';
    } else {
      return 'text-red-600 dark:text-red-400';
    }
  };

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
        <thead className="bg-gray-50 dark:bg-gray-800">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              Time
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              Mode
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              Result
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              Task ID
            </th>
          </tr>
        </thead>
        <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-700">
          {evaluations.map((evaluation) => (
            <tr key={evaluation.eval_id} className="hover:bg-gray-50 dark:hover:bg-gray-800">
              <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">
                {new Date(evaluation.evaluated_at).toLocaleString('zh-CN')}
              </td>
              <td className={`px-4 py-3 whitespace-nowrap text-sm font-medium ${getModeColor(evaluation.mode)}`}>
                {evaluation.mode}
              </td>
              <td className={`px-4 py-3 whitespace-nowrap text-sm font-medium ${getResultColor(evaluation.result)}`}>
                {evaluation.result}
              </td>
              <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400 font-mono">
                {evaluation.task_id}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
