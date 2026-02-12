/**
 * Failure Signatures List Page
 *
 * 失败签名列表页 - 显示所有失败签名和统计信息
 */

import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { immuneApi } from '../../api/immune.api';
import type { FailureSignature } from '../../types/immune';

export default function SignaturesList() {
  const [signatures, setSignatures] = useState<FailureSignature[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadSignatures();
  }, []);

  const loadSignatures = async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await immuneApi.fetchSignatures({
        limit: 20,
        min_count: 1,
      });
      setSignatures(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load signatures');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-6">Failure Signatures</h1>
        <div className="animate-pulse space-y-3">
          <div className="h-16 bg-gray-200 dark:bg-gray-700 rounded-lg" />
          <div className="h-16 bg-gray-200 dark:bg-gray-700 rounded-lg" />
          <div className="h-16 bg-gray-200 dark:bg-gray-700 rounded-lg" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-6">Failure Signatures</h1>
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <p className="text-red-700 dark:text-red-400">{error}</p>
          <button
            onClick={loadSignatures}
            className="mt-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Failure Signatures</h1>

      {/* Signatures Table */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
        {signatures.length === 0 ? (
          <div className="p-8 text-center text-gray-500 dark:text-gray-400">No failure signatures found</div>
        ) : (
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-900">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Signature
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Count
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Policies
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  First / Last Seen
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {signatures.map((sig) => (
                <tr key={sig.signature} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                  <td className="px-6 py-4">
                    <Link
                      to={`/immune/signatures/${encodeURIComponent(sig.signature)}`}
                      className="text-blue-600 dark:text-blue-400 hover:underline font-mono text-sm"
                    >
                      {sig.signature}
                    </Link>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{sig.count}</span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600 dark:text-gray-400">
                    {sig.active_policies > 0 && (
                      <span className="text-green-600 dark:text-green-400">{sig.active_policies} active</span>
                    )}
                    {sig.active_policies > 0 && sig.probation_policies > 0 && ', '}
                    {sig.probation_policies > 0 && (
                      <span className="text-amber-600 dark:text-amber-400">{sig.probation_policies} probation</span>
                    )}
                    {sig.active_policies === 0 && sig.probation_policies === 0 && (
                      <span className="text-red-600 dark:text-red-400">⚠️ No policies</span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-xs text-gray-500 dark:text-gray-400">
                    <div>{new Date(sig.first_seen).toLocaleString('zh-CN')}</div>
                    <div>{new Date(sig.last_seen).toLocaleString('zh-CN')}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
