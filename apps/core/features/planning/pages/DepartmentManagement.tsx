/**
 * Department Management Page
 * CRUD interface for Department entities, grouped by Business
 */

import React, { useState } from 'react';
import { useApi } from '../../shared/hooks/useApi';
import { SkeletonCard } from '../../shared/components/LoadingState';
import {
  fetchDepartments,
  createDepartment,
  deleteDepartment,
  type Department,
  type CreateDepartmentData,
} from '../api/departments.api';
import { fetchBusinesses, type Business } from '../api/businesses.api';

export default function DepartmentManagement() {
  const { data: departments, loading, mutate } = useApi<Department[]>('/api/tasks/departments', {
    fetcher: fetchDepartments,
  });
  const { data: businesses } = useApi<Business[]>('/api/tasks/businesses', {
    fetcher: fetchBusinesses,
  });

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const handleCreate = async (data: CreateDepartmentData) => {
    try {
      await createDepartment(data);
      mutate();
      setShowCreateModal(false);
    } catch (error) {
      console.error('Failed to create department:', error);
      alert('Failed to create department');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteDepartment(id);
      mutate();
      setDeleteConfirm(null);
    } catch (error) {
      console.error('Failed to delete department:', error);
      alert('Failed to delete department');
    }
  };

  if (loading) {
    return (
      <div className="p-6">
        <SkeletonCard count={3} />
      </div>
    );
  }

  // Group departments by business
  const groupedDepts = departments?.reduce((acc, dept) => {
    const businessName = dept.business?.name || 'No Business';
    if (!acc[businessName]) {
      acc[businessName] = [];
    }
    acc[businessName].push(dept);
    return acc;
  }, {} as Record<string, Department[]>) || {};

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Departments</h1>
        <button
          onClick={() => setShowCreateModal(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          + New Department
        </button>
      </div>

      <div className="space-y-6">
        {Object.entries(groupedDepts).map(([businessName, depts]) => (
          <div key={businessName} className="bg-white rounded-lg shadow overflow-hidden">
            <div className="px-6 py-3 bg-gray-50 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">{businessName}</h2>
            </div>
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Name
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Lead
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Description
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {depts.map((dept) => (
                  <tr key={dept.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap font-medium text-gray-900">
                      {dept.name}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {dept.lead || '-'}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500">
                      {dept.description || '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <button
                        onClick={() => setDeleteConfirm(dept.id)}
                        className="text-red-600 hover:text-red-900"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

        {Object.keys(groupedDepts).length === 0 && (
          <div className="bg-white rounded-lg shadow p-12 text-center text-gray-500">
            No departments yet. Create one to get started.
          </div>
        )}
      </div>

      {showCreateModal && businesses && (
        <CreateDepartmentModal
          businesses={businesses}
          onClose={() => setShowCreateModal(false)}
          onCreate={handleCreate}
        />
      )}

      {deleteConfirm && (
        <DeleteConfirmDialog
          onConfirm={() => handleDelete(deleteConfirm)}
          onCancel={() => setDeleteConfirm(null)}
        />
      )}
    </div>
  );
}

function CreateDepartmentModal({
  businesses,
  onClose,
  onCreate,
}: {
  businesses: Business[];
  onClose: () => void;
  onCreate: (data: CreateDepartmentData) => void;
}) {
  const [formData, setFormData] = useState<CreateDepartmentData>({
    business_id: businesses[0]?.id || '',
    name: '',
    lead: '',
    description: '',
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim() || !formData.business_id) {
      alert('Name and Business are required');
      return;
    }
    onCreate(formData);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-md">
        <h2 className="text-xl font-semibold mb-4">Create New Department</h2>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Business <span className="text-red-500">*</span>
              </label>
              <select
                value={formData.business_id}
                onChange={(e) => setFormData({ ...formData, business_id: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {businesses.map((business) => (
                  <option key={business.id} value={business.id}>
                    {business.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g., Content Team, Tech Team"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Lead
              </label>
              <input
                type="text"
                value={formData.lead}
                onChange={(e) => setFormData({ ...formData, lead: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g., 小米, Caramel"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Description
              </label>
              <textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Brief description"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-6">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
            >
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function DeleteConfirmDialog({
  onConfirm,
  onCancel,
}: {
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-sm">
        <h2 className="text-xl font-semibold mb-2">Delete Department?</h2>
        <p className="text-gray-600 mb-6">
          Are you sure you want to delete this department? This action cannot be undone.
        </p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
