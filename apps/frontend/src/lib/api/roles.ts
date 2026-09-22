import { apiClient } from './client';

export interface RoleClaimRecord {
  id: string;
  roleId: string;
  claimType: string;
  claimValue: string;
}

export interface RoleRecord {
  id: string;
  name: string;
  normalizedName: string;
  description: string | null;
  roleClaims: RoleClaimRecord[];
  createdAt: string;
}

export async function listRoles(): Promise<RoleRecord[]> {
  const { data } = await apiClient.get<RoleRecord[]>('/roles');
  return data;
}

export async function createRole(payload: {
  name: string;
  description?: string;
  permissions: string[];
}) {
  const { data } = await apiClient.post<RoleRecord>('/roles', payload);
  return data;
}

export async function updateRole(
  id: string,
  payload: { name?: string; description?: string; permissions?: string[] },
) {
  const { data } = await apiClient.patch<RoleRecord>(`/roles/${id}`, payload);
  return data;
}

export async function deleteRole(id: string) {
  const { data } = await apiClient.delete(`/roles/${id}`);
  return data;
}
