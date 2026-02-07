/**
 * Departments API
 * CRUD operations for Department entities
 */

export interface Department {
  id: string;
  business_id: string;
  name: string;
  lead?: string;
  description?: string;
  created_at: string;
  updated_at: string;
  business?: {
    id: string;
    name: string;
    owner?: string;
  };
}

export interface CreateDepartmentData {
  business_id: string;
  name: string;
  lead?: string;
  description?: string;
}

export interface UpdateDepartmentData {
  business_id?: string;
  name?: string;
  lead?: string;
  description?: string;
}

const API_BASE = '/api/tasks/departments';

export const fetchDepartments = async (businessId?: string): Promise<Department[]> => {
  const url = businessId ? `${API_BASE}?business_id=${businessId}` : API_BASE;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch departments: ${response.statusText}`);
  }
  return response.json();
};

export const createDepartment = async (data: CreateDepartmentData): Promise<Department> => {
  const response = await fetch(API_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    throw new Error(`Failed to create department: ${response.statusText}`);
  }
  return response.json();
};

export const updateDepartment = async (id: string, data: UpdateDepartmentData): Promise<Department> => {
  const response = await fetch(`${API_BASE}/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    throw new Error(`Failed to update department: ${response.statusText}`);
  }
  return response.json();
};

export const deleteDepartment = async (id: string): Promise<void> => {
  const response = await fetch(`${API_BASE}/${id}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    throw new Error(`Failed to delete department: ${response.statusText}`);
  }
};
