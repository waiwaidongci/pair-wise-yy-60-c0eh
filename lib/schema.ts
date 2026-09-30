import { z } from 'zod';

export const recordStatusSchema = z.enum(['待核验', '复核中', '已核验', '需补证']);
export type RecordStatus = z.infer<typeof recordStatusSchema>;

export const findingStatusSchema = z.enum(['开放', '补证中', '已关闭']);
export type FindingStatus = z.infer<typeof findingStatusSchema>;

export const findingTypeSchema = z.enum(['缺失证据', '单位不一致', '时间范围', '异常波动']);
export type FindingType = z.infer<typeof findingTypeSchema>;

/**
 * 追加式修订记录：每次修订都生成一条不可变的版本记录，
 * 原始版本保留在 revisions 数组中，不会被覆盖。
 */
export const revisionSchema = z.object({
  version: z.number(),
  activity: z.number(),
  reason: z.string(),
  actor: z.string(),
  recordedAt: z.string(),
  clientSubmissionId: z.string()
});
export type Revision = z.infer<typeof revisionSchema>;

export const carbonRecordSchema = z.object({
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
  status: recordStatusSchema,
  /** 当前版本号，等于 revisions 中最后一条的 version */
  revision: z.number(),
  /** 追加式修订链，按版本号递增 */
  revisions: z.array(revisionSchema)
});
export type CarbonRecord = z.infer<typeof carbonRecordSchema>;

export const findingSchema = z.object({
  id: z.string(),
  recordId: z.string(),
  type: findingTypeSchema,
  title: z.string(),
  detail: z.string(),
  assignee: z.string(),
  due: z.string(),
  status: findingStatusSchema
});
export type Finding = z.infer<typeof findingSchema>;

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
  records: z.array(carbonRecordSchema),
  findings: z.array(findingSchema),
  issuanceChecks: z.record(z.boolean())
});
export type EvidenceResponse = z.infer<typeof evidenceResponseSchema>;

/**
 * 修订提交载荷：带上所基于的上一版本号与稳定提交标识。
 */
export const revisionSubmissionSchema = z.object({
  recordId: z.string(),
  value: z.number(),
  reason: z.string().min(1),
  actor: z.string(),
  baseVersion: z.number(),
  clientSubmissionId: z.string().min(1)
});
export type RevisionSubmission = z.infer<typeof revisionSubmissionSchema>;

export const revisionAcceptedSchema = z.object({
  accepted: z.literal(true),
  recordId: z.string(),
  revision: z.number(),
  previousVersion: z.number(),
  recordedAt: z.string(),
  clientSubmissionId: z.string(),
  status: recordStatusSchema
});
export type RevisionAccepted = z.infer<typeof revisionAcceptedSchema>;

/**
 * 版本冲突响应（HTTP 409）：列出服务端当前版本与当前修订。
 */
export const revisionConflictSchema = z.object({
  accepted: z.literal(false),
  error: z.literal('version_conflict'),
  recordId: z.string(),
  currentVersion: z.number(),
  currentRevision: revisionSchema,
  clientSubmissionId: z.string()
});
export type RevisionConflict = z.infer<typeof revisionConflictSchema>;
