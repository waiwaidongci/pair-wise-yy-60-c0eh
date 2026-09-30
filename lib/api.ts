import ky, { type HTTPError } from 'ky';
import { correctionAcceptedSchema, correctionConflictSchema, evidenceResponseSchema } from './schema';

const client = ky.create({ timeout: 10_000, retry: { limit: 0 } });

export async function fetchEvidence() {
  const payload = await client.get('/api/evidence').json<unknown>();
  return evidenceResponseSchema.parse(payload);
}

export type CorrectionInput = {
  recordId: string;
  value: number;
  reason: string;
  actor: string;
  // 提交所依据的上一版号；与服务端当前版本不一致即判定版本过期。
  baseVersion: number;
  // 稳定提交标识：断网重试/重复点击都复用同一标识，服务端对同标识只取第一次结果。
  clientToken: string;
};

// 409 版本过期：携带服务端当前版本，供调用方刷新后基于新版本重新修订。
export class VersionConflictError extends Error {
  readonly currentVersion: number;
  readonly currentValue: number;
  readonly recordId: string;
  readonly currentRevision: unknown;

  constructor(detail: { recordId: string; currentVersion: number; currentValue: number; currentRevision: unknown }) {
    super(`版本已过期：${detail.recordId} 当前为 V${detail.currentVersion}，请刷新后重试。`);
    this.name = 'VersionConflictError';
    this.recordId = detail.recordId;
    this.currentVersion = detail.currentVersion;
    this.currentValue = detail.currentValue;
    this.currentRevision = detail.currentRevision;
  }
}

function isOfflineError(error: unknown): boolean {
  if (error instanceof TypeError) return true; // fetch 在断网时抛出 TypeError: Failed to fetch
  if (error && typeof error === 'object' && 'response' in error) {
    return (error as { response?: { status?: number } }).response?.status === 0;
  }
  return false;
}

export async function submitEvidenceCorrection(input: CorrectionInput) {
  try {
    const payload = await client.post('/api/evidence', { json: input }).json<unknown>();
    return correctionAcceptedSchema.parse(payload);
  } catch (error) {
    if ((error as HTTPError)?.response?.status === 409) {
      const body = await (error as HTTPError).response.json<unknown>().catch(() => null);
      const conflict = correctionConflictSchema.safeParse(body);
      if (conflict.success) {
        throw new VersionConflictError({
          recordId: conflict.data.recordId,
          currentVersion: conflict.data.currentVersion,
          currentValue: conflict.data.currentValue,
          currentRevision: conflict.data.currentRevision
        });
      }
      // 409 但不是版本冲突（例如提交标识被复用到其他记录），原样抛出由调用方提示。
      throw new Error((body as { message?: string } | null)?.message ?? '提交冲突，请生成新的提交标识后重试。');
    }
    if (isOfflineError(error)) {
      throw new TypeError('OFFLINE');
    }
    throw error;
  }
}

// 生成稳定提交标识：同一修订动作从创建到最终成功只生成一次，重试沿用。
export function createClientToken(): string {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `rev-${random}`;
}
