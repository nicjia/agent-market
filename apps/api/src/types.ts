export type CreateTaskRequest = {
  taskSchema: unknown;
  bountyWei: string;
  ttlSeconds: number;
  riskTier?: number;
};

export type SubmitPayloadRequest = {
  payload: unknown;
  payloadCid: string;
  providerStakeWei: string;
};
