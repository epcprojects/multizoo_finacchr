import { apiClient } from './client';

export type CostCentreCharge = 'UNIT' | 'PARTNER';

export interface CostCentreRecord {
  id: string;
  code: string;
  name: string;
  description: string | null;
  chargeTo: CostCentreCharge;
  partner: { id: string; name: string; shortName: string } | null;
  businessUnit: { id: string; code: string; name: string } | null;
  isActive: boolean;
  createdAt: string;
  /** Only on the list. */
  spent?: string;
  entryCount?: number;
}

export interface CostCentreReport {
  costCentre: CostCentreRecord;
  from: string | null;
  to: string | null;
  total: string;
  byCategory: { category: string; amount: string }[];
  byMonth: { month: string; amount: string; byCategory: Record<string, string> }[];
  /** chargedTo: a partner's short name, or null for the paying unit's own P&L. */
  byCharge: { chargedTo: string | null; amount: string }[];
  byUnit: { unit: string; amount: string }[];
}

export async function listCostCentres() {
  const { data } = await apiClient.get<CostCentreRecord[]>('/cost-centres');
  return data;
}

export async function getCostCentre(id: string) {
  const { data } = await apiClient.get<CostCentreRecord>(`/cost-centres/${id}`);
  return data;
}

export async function createCostCentre(payload: {
  code: string;
  name: string;
  description?: string;
  chargeTo: CostCentreCharge;
  partnerId?: string;
  businessUnitId?: string | null;
}) {
  const { data } = await apiClient.post<CostCentreRecord>('/cost-centres', payload);
  return data;
}

export async function updateCostCentre(
  id: string,
  payload: Partial<{
    code: string;
    name: string;
    description: string | null;
    chargeTo: CostCentreCharge;
    partnerId: string | null;
    businessUnitId: string | null;
    isActive: boolean;
  }>,
) {
  const { data } = await apiClient.patch<CostCentreRecord>(`/cost-centres/${id}`, payload);
  return data;
}

export async function getCostCentreReport(id: string, params: { from?: string; to?: string; businessUnitId?: string } = {}) {
  const { data } = await apiClient.get<CostCentreReport>(`/cost-centres/${id}/report`, { params });
  return data;
}
