import ky, { HTTPError } from 'ky';
import {
  evidenceResponseSchema,
  revisionAcceptedSchema,
  revisionConflictSchema,
  revisionSubmissionSchema,
  type EvidenceResponse,
  type RevisionAccepted,
  type RevisionConflict
} from './schema';

const client = ky.create({ timeout: 10_000, retry: { limit: 1 } });

export async function fetchEvidence(): Promise<EvidenceResponse> {
  const payload = await client.get('/api/evidence').json<unknown>();
  return evidenceResponseSchema.parse(payload);
}

export type RevisionResult =
  | { ok: true; accepted: RevisionAccepted }
  | { ok: false; status: 409; conflict: RevisionConflict }
  | { ok: false; status: 'offline' }
  | { ok: false; status: 'error'; message: string };

/**
 * 提交修订。断网时直接返回 offline，由本地待提交队列接管；
 * 版本过期时返回 409 与服务端当前版本；同一 clientSubmissionId
 * 的重试由服务端幂等返回第一次结果。
 */
export async function submitRevision(input: {
  recordId: string;
  value: number;
  reason: string;
  actor: string;
  baseVersion: number;
  clientSubmissionId: string;
}): Promise<RevisionResult> {
  const payload = revisionSubmissionSchema.parse(input);

  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { ok: false, status: 'offline' };
  }

  try {
    const response = await client.post('/api/evidence', { json: payload });
    const data = await response.json();
    return { ok: true, accepted: revisionAcceptedSchema.parse(data) };
  } catch (error) {
    if (error instanceof HTTPError) {
      if (error.response.status === 409) {
        try {
          const body = await error.response.json();
          return { ok: false, status: 409, conflict: revisionConflictSchema.parse(body) };
        } catch {
          return { ok: false, status: 'error', message: '版本冲突，但无法解析服务端响应' };
        }
      }
      return { ok: false, status: 'error', message: `服务端错误（HTTP ${error.response.status}）` };
    }
    // 网络失败（断网 / 超时 / 跨域）一律视为离线，交由待提交队列按原标识补交
    return { ok: false, status: 'offline' };
  }
}
