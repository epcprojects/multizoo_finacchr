import { apiClient } from './client';

export interface UserRecord {
  id: string;
  email: string;
  fullName: string;
  isActive: boolean;
  isInvitationAccepted: boolean;
  lastLoginAt: string | null;
  roles: string[];
  permissions: string[];
}

export async function listUsers(): Promise<UserRecord[]> {
  const { data } = await apiClient.get<UserRecord[]>('/users');
  return data;
}

export async function inviteUser(payload: {
  email: string;
  fullName: string;
  roleId: string;
}) {
  const { data } = await apiClient.post('/users/invite', payload);
  return data;
}

export async function updateUserRole(userId: string, roleId: string) {
  const { data } = await apiClient.patch(`/users/${userId}/role`, { roleId });
  return data;
}

export async function deleteUser(userId: string) {
  const { data } = await apiClient.delete(`/users/${userId}`);
  return data;
}
