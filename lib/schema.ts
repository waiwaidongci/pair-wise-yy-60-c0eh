import { z } from 'zod';

const revisionStateSchema = z.enum(['复核中', '已确认']);

const revisionSchema = z.object({
  version: z.number().int().positive(),
  value: z.number(),
  reason: z.string(),
  actor: z.string(),
  recordedAt: z.string(),
  state: revisionStateSchema
});

const recordSchema = z.object({
  id: z.string(),
  source: z.string(),
  activity: z.number(),
  unit: z.string(),
  factor: z.number(),
  factorUnit: z.string(),
  timeRange: z.string(),
  evidenceCount: z.number(),
  anomaly: z.number(),
  owner: z.string(),
  status: z.enum(['待核验', '复核中', '已核验', '需补证']),
  revision: z.number().int().nonnegative(),
  revisions: z.array(revisionSchema)
});

export const evidenceResponseSchema = z.object({
  project: z.object({
    id: z.string(),
    name: z.string(),
    methodology: z.string(),
    vintage: z.string(),
    verifier: z.string()
  }),
  summary: z.object({
    period: z.string(),
    reduction: z.number(),
    evidenceRate: z.number(),
    openFindings: z.number(),
    sampled: z.number()
  }),
  records: z.array(recordSchema)
});

export type EvidenceResponse = z.infer<typeof evidenceResponseSchema>;
export type ApiRevision = z.infer<typeof revisionSchema>;
export type ApiRecord = z.infer<typeof recordSchema>;

// 修订提交：baseVersion 为客户端所依据的上一版号，clientToken 为稳定提交标识（幂等键）。
export const correctionRequestSchema = z.object({
  recordId: z.string().min(1),
  value: z.number(),
  reason: z.string().min(1),
  actor: z.string().min(1).default('沈楠'),
  baseVersion: z.number().int().positive(),
  clientToken: z.string().min(8)
});

export type CorrectionRequest = z.infer<typeof correctionRequestSchema>;

export const correctionAcceptedSchema = z.object({
  accepted: z.literal(true),
  idempotent: z.boolean(),
  recordId: z.string(),
  revision: z.number().int().positive(),
  value: z.number(),
  recordedAt: z.string(),
  state: revisionStateSchema
});

export type CorrectionAccepted = z.infer<typeof correctionAcceptedSchema>;

// 409 冲突：版本过期，body 列出当前版本与当前值，供客户端刷新后重试。
export const correctionConflictSchema = z.object({
  error: z.literal('VERSION_CONFLICT'),
  message: z.string(),
  recordId: z.string(),
  currentVersion: z.number().int().nonnegative(),
  currentValue: z.number(),
  currentRevision: revisionSchema.nullable()
});

export type CorrectionConflict = z.infer<typeof correctionConflictSchema>;
