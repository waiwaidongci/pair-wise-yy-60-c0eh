// 服务端版本化修订存储（单进程内存实现，演示乐观并发与幂等语义）。
// - 修订只追加：revisions 为 append-only 版本链，record 的 activity/revision/status 是最新版本的投影。
// - 乐观并发：提交必须携带 baseVersion，与当前版本不一致返回 409 并列出当前版本。
// - 幂等：clientToken 作为稳定提交标识，同一标识的重试直接取第一次的处理结果。
import { defaultRecords } from './seed';
import type { ApiRecord, ApiRevision, CorrectionRequest } from './schema';

type StoredAccept = {
  recordId: string;
  result: {
    accepted: true;
    idempotent: boolean;
    recordId: string;
    revision: number;
    value: number;
    recordedAt: string;
    state: '复核中' | '已确认';
  };
};

type ServerStore = {
  records: ApiRecord[];
  tokens: Map<string, StoredAccept>;
};

const globalKey = '__yy60_evidence_store__';

function createStore(): ServerStore {
  return {
    records: defaultRecords.map((record) => ({ ...record, revisions: record.revisions.map((entry) => ({ ...entry })) })),
    tokens: new Map()
  };
}

const globalForStore = globalThis as unknown as { [globalKey]?: ServerStore };

export const serverStore: ServerStore = globalForStore[globalKey] ?? createStore();
if (!globalForStore[globalKey]) {
  globalForStore[globalKey] = serverStore;
}

export function getRecord(recordId: string): ApiRecord | undefined {
  return serverStore.records.find((record) => record.id === recordId);
}

export function latestRevision(record: ApiRecord): ApiRevision | null {
  return record.revisions.length > 0 ? record.revisions[record.revisions.length - 1] : null;
}

export function applyCorrection(request: CorrectionRequest):
  | { outcome: 'accepted'; response: StoredAccept['result']; status: 200 }
  | { outcome: 'conflict'; status: 409; body: Record<string, unknown> }
  | { outcome: 'token_mismatch'; status: 409; body: Record<string, unknown> }
  | { outcome: 'not_found'; status: 404 } {
  // 幂等优先：同一稳定提交标识的重试，无论期间版本如何变化，都返回第一次的结果。
  const stored = serverStore.tokens.get(request.clientToken);
  if (stored) {
    if (stored.recordId !== request.recordId) {
      return {
        outcome: 'token_mismatch',
        status: 409,
        body: { error: 'TOKEN_MISMATCH', message: '该提交标识已用于另一条活动数据，请生成新的提交标识。', recordId: request.recordId, clientToken: request.clientToken }
      };
    }
    return { outcome: 'accepted', status: 200, response: { ...stored.result, idempotent: true } };
  }

  const record = getRecord(request.recordId);
  if (!record) {
    return { outcome: 'not_found', status: 404 };
  }

  // 乐观并发校验：提交依据的上一版号必须等于当前版本，否则后提交者不得覆盖先提交者。
  if (request.baseVersion !== record.revision) {
    const current = latestRevision(record);
    return {
      outcome: 'conflict',
      status: 409,
      body: {
        error: 'VERSION_CONFLICT',
        message: `版本已过期：该数据当前为 V${record.revision}，请基于最新版本重新修订。`,
        recordId: record.id,
        currentVersion: record.revision,
        currentValue: record.activity,
        currentRevision: current ? { ...current } : null
      }
    };
  }

  const now = new Date().toISOString();
  const entry: ApiRevision = {
    version: record.revision + 1,
    value: request.value,
    reason: request.reason,
    actor: request.actor,
    recordedAt: now,
    state: '复核中'
  };
  record.revisions.push(entry);
  record.activity = entry.value;
  record.revision = entry.version;
  // 新修订生效后，活动数据回到复核中，旧的核验结论不再挂用。
  record.status = '复核中';

  const result: StoredAccept['result'] = {
    accepted: true,
    idempotent: false,
    recordId: record.id,
    revision: entry.version,
    value: entry.value,
    recordedAt: now,
    state: entry.state
  };
  serverStore.tokens.set(request.clientToken, { recordId: record.id, result });
  return { outcome: 'accepted', status: 200, response: result };
}
