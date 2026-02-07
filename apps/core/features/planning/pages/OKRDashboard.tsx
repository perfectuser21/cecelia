/**
 * OKR Dashboard - Single-layer Area OKR architecture
 */

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useApi } from '../../shared/hooks/useApi';
import { SkeletonCard } from '../../shared/components/LoadingState';
import { fetchAreas, type Area } from '../api/okr.api';

function getCurrentQuarter(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const quarter = Math.ceil(month / 3);
  return `${year} Q${quarter}`;
}

function calculateQuarter(baseQuarter: string, offset: number): string {
  const [yearStr, qStr] = baseQuarter.split(' Q');
  let year = parseInt(yearStr);
  let q = parseInt(qStr);

  q += offset;
  while (q > 4) { q -= 4; year += 1; }
  while (q < 1) { q += 4; year -= 1; }

  return `${year} Q${q}`;
}

export default function OKRDashboard() {
  const navigate = useNavigate();
  const [quarter, setQuarter] = useState(getCurrentQuarter());

  const { data: areas, loading } = useApi<Area[]>(
    `/api/okr/areas?quarter=${quarter}`,
    {
      fetcher: () => fetchAreas(quarter),
    }
  );

  const totalObjectives = areas?.reduce((sum, a) => sum + a.objectives_count, 0) || 0;
  const avgProgress = areas?.length
    ? Math.round(areas.reduce((sum, a) => sum + a.avg_progress, 0) / areas.length)
    : 0;

  if (loading) {
    return (
      <div className="p-6">
        <SkeletonCard count={3} />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-gray-900">OKR Dashboard</h1>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setQuarter(calculateQuarter(quarter, -1))}
            className="p-2 rounded-lg hover:bg-gray-100"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <span className="px-4 py-2 bg-gray-100 rounded-lg text-sm font-medium">
            {quarter}
          </span>
          <button
            onClick={() => setQuarter(calculateQuarter(quarter, 1))}
            className="p-2 rounded-lg hover:bg-gray-100"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div className="bg-white rounded-lg border p-6">
        <div className="grid grid-cols-3 gap-6">
          <div>
            <div className="text-sm text-gray-500">Areas</div>
            <div className="text-3xl font-semibold">{areas?.length || 0}</div>
          </div>
          <div>
            <div className="text-sm text-gray-500">Total Objectives</div>
            <div className="text-3xl font-semibold">{totalObjectives}</div>
          </div>
          <div>
            <div className="text-sm text-gray-500">Avg Progress</div>
            <div className="text-3xl font-semibold">{avgProgress}%</div>
          </div>
        </div>
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-4">Areas</h2>

        {areas && areas.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {areas.map(area => (
              <div
                key={area.id}
                onClick={() => navigate(`/work/okr/area/${area.id}`)}
                className="bg-white rounded-lg border p-6 hover:border-blue-500 hover:shadow-lg transition-all cursor-pointer"
              >
                <h3 className="text-lg font-semibold mb-4">{area.name}</h3>

                <div className="space-y-3">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Objectives</span>
                    <span className="font-semibold">{area.objectives_count}</span>
                  </div>

                  <div>
                    <div className="flex justify-between text-sm mb-2">
                      <span className="text-gray-500">Progress</span>
                      <span className="font-semibold">{area.avg_progress}%</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div
                        className="bg-blue-600 h-2 rounded-full"
                        style={{ width: `${area.avg_progress}%` }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-12 text-gray-500 bg-white rounded-lg border">
            No areas found for this quarter
          </div>
        )}
      </div>
    </div>
  );
}
