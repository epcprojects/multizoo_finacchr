import { apiClient } from './client';

export interface LoginResponse {
  accessToken: string;
  user: {
    id: string;
    email: string;
    fullName: string;
    roles: string[];
    permissions: string[];
  };
}

export async function login(email: string, password: string) {
  const { data } = await apiClient.post<LoginResponse>('/auth/login', {
    email,
    password,
  });
  return data;
}

export async function acceptInvite(token: string, password: string) {
  const { data } = await apiClient.post('/auth/accept-invite', {
    token,
    password,
  });
  return data;
}

export async function getMyself() {
  const { data } = await apiClient.get('/users/me');
  return data;
}
