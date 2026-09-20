export type RedactableOrder = {
  originalNote: string | null;
  snapshotPayload: unknown | null;
  providerPayload: unknown | null;
  providerResponse: unknown | null;
  mappedValues: Array<{ rawValue: string | null }>;
  customerId: string | null;
};

export function redactPersonalContent<T extends RedactableOrder>(row: T): T {
  return {
    ...row,
    originalNote: null,
    snapshotPayload: null,
    providerPayload: null,
    providerResponse: null,
    customerId: null,
    mappedValues: row.mappedValues.map((v) => ({ ...v, rawValue: null })),
  };
}

export function containsPersonalContent(row: RedactableOrder): boolean {
  if (row.originalNote) return true;
  if (row.snapshotPayload) return true;
  if (row.providerPayload) return true;
  if (row.providerResponse) return true;
  return row.mappedValues.some((v) => v.rawValue != null && v.rawValue !== "");
}
