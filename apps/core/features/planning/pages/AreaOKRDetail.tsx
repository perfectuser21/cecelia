/**
 * Area OKR Detail - Shows all Objectives and Key Results for an Area
 */

import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { useApi } from '../../shared/hooks/useApi';
import { SkeletonCard } from '../../shared/components/LoadingState';
import { fetchAreaOKR, type AreaDetail, type Objective, type KeyResult } from '../api/okr.api';

const statusColors: Record<string, string> = {
  on_track: 'text-green-600',
  at_risk: 'text-yellow-600',
  behind: 'text-red-600',
};

const priorityColors: Record<string, string> = {
  P0: 'bg-red-100 text-red-800 border-red-300',
  P1: 'bg-orange-100 text-orange-800 border-orange-300',
  P2: 'bg-yellow-100 text-yellow-800 border-yellow-300',
};

function KeyResultItem({ kr }: { kr: KeyResult }) {
  const progress = kr.target_value > 0
    ? Math.round((kr.current_value / kr.target_value) * 100)
    : 0;

  return (
    <div className="p-4 bg-gray-50 rounded-lg">
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1">
          <h4 className="font-medium text-gray-900">{kr.title}</h4>
          {kr.description && (
            <p className="text-sm text-gray-600 mt-1">{kr.description}</p>
          )}
        </div>

        <div className="flex items-center gap-2 ml-4">
          {kr.priority && (
            <span className={`px-2 py-0.5 text-xs font-semibold rounded border ${
              priorityColors[kr.priority] || 'bg-gray-100 text-gray-800'
            }`}>
              {kr.priority}
            </span>
          )}
          <span className={`text-xs font-medium ${statusColors[kr.status]}`}>
            {kr.status}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-4 mb-2">
        <div className="flex-1 bg-gray-200 rounded-full h-2">
          <div
            className="bg-blue-600 h-2 rounded-full transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
        <span className="text-sm font-medium text-gray-700 w-16 text-right">
          {kr.current_value}{kr.unit ? ` ${kr.unit}` : ''} / {kr.target_value}{kr.unit ? ` ${kr.unit}` : ''}
        </span>
      </div>

      {kr.projects && kr.projects.length > 0 && (
        <div className="mt-3 pt-3 border-t border-gray-200">
          <div className="text-xs text-gray-500 mb-2">Contributing Projects:</div>
          <div className="flex flex-wrap gap-2">
            {kr.projects.map(project => (
              <span
                key={project.id}
                className="px-2 py-1 bg-white rounded border border-gray-200 text-xs text-gray-700"
              >
                {project.name}
              </span>
            ))}
          </div>
        </div>
      )}

      {kr.expected_completion_date && (
        <div className="text-xs text-gray-500 mt-2">
          Target: {new Date(kr.expected_completion_date).toLocaleDateString()}
        </div>
      )}
    </div>
  );
}

function ObjectiveItem({ objective }: { objective: Objective }) {
  const avgProgress = objective.key_results?.length
    ? Math.round(
        objective.key_results.reduce((sum, kr) => {
          const progress = kr.target_value > 0 ? (kr.current_value / kr.target_value) * 100 : 0;
          return sum + progress;
        }, 0) / objective.key_results.length
      )
    : 0;

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6">
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1">
          <h3 className="text-lg font-semibold text-gray-900">{objective.title}</h3>
          {objective.description && (
            <p className="text-sm text-gray-600 mt-1">{objective.description}</p>
          )}
        </div>

        <div className="flex items-center gap-2 ml-4">
          <span className={`px-2 py-0.5 text-xs font-semibold rounded border ${
            priorityColors[objective.priority] || 'bg-gray-100 text-gray-800'
          }`}>
            {objective.priority}
          </span>
          {objective.quarter && (
            <span className="text-xs text-gray-500">{objective.quarter}</span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3 mb-4">
        <div className="flex-1 bg-gray-200 rounded-full h-2">
          <div
            className="bg-blue-600 h-2 rounded-full transition-all"
            style={{ width: `${avgProgress}%` }}
          />
        </div>
        <span className="text-sm font-medium text-gray-700 w-12 text-right">
          {avgProgress}%
        </span>
      </div>

      {objective.key_results && objective.key_results.length > 0 && (
        <div className="space-y-3">
          <div className="text-sm font-medium text-gray-700">
            Key Results ({objective.key_results.length})
          </div>
          {objective.key_results.map(kr => (
            <KeyResultItem key={kr.id} kr={kr} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function AreaOKRDetail() {
  const { areaId } = useParams<{ areaId: string }>();
  const navigate = useNavigate();

  const { data: areaData, loading } = useApi<AreaDetail>(
    `/api/okr/areas/${areaId}`,
    {
      fetcher: () => fetchAreaOKR(areaId!),
    }
  );

  if (loading) {
    return (
      <div className="p-6">
        <SkeletonCard count={3} />
      </div>
    );
  }

  if (!areaData) {
    return (
      <div className="p-6">
        <div className="text-center py-12 text-gray-500">
          Area not found
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <button
        onClick={() => navigate('/work/okr')}
        className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-6 transition-colors"
      >
        <ChevronLeft className="w-4 h-4" />
        <span>Back to Dashboard</span>
      </button>

      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">
          {areaData.area.name}
        </h1>
        <p className="text-gray-600 mt-1">
          {areaData.objectives.length} Objective{areaData.objectives.length !== 1 ? 's' : ''}
        </p>
      </div>

      <div className="space-y-4">
        {areaData.objectives.length > 0 ? (
          areaData.objectives.map(objective => (
            <ObjectiveItem key={objective.id} objective={objective} />
          ))
        ) : (
          <div className="text-center py-12 text-gray-500 bg-white rounded-lg border">
            No objectives found for this area
          </div>
        )}
      </div>
    </div>
  );
}
