/**
 * Businesses API
 * CRUD operations for Business entities
 */

export interface Business {
  id: string;
  name: string;
  description?: string;
  owner?: string;
  status: 'active' | 'inactive';
  created_at: string;
  updated_at: string;
}

export interface CreateBusinessData {
  name: string;
  description?: string;
  owner?: string;
  status?: 'active' | 'inactive';
}

export interface UpdateBusinessData {
  name?: string;
  description?: string;
  owner?: string;
  status?: 'active' | 'inactive';
}

const API_BASE = '/api/tasks/businesses';

export const fetchBusinesses = async (): Promise<Business[]> => {
  const response = await fetch(API_BASE);
  if (!response.ok) {
    throw new Error(`Failed to fetch businesses: ${response.statusText}`);
  }
  return response.json();
};

export const createBusiness = async (data: CreateBusinessData): Promise<Business> => {
  const response = await fetch(API_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    throw new Error(`Failed to create business: ${response.statusText}`);
  }
  return response.json();
};

export const updateBusiness = async (id: string, data: UpdateBusinessData): Promise<Business> => {
  const response = await fetch(`${API_BASE}/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    throw new Error(`Failed to update business: ${response.statusText}`);
  }
  return response.json();
};

export const deleteBusiness = async (id: string): Promise<void> => {
  const response = await fetch(`${API_BASE}/${id}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    throw new Error(`Failed to delete business: ${response.statusText}`);
  }
};
