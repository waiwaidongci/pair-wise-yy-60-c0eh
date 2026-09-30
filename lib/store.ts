import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { defaultFindings, defaultRecords } from './seed';
import type { CarbonRecord, Finding, RecordStatus, RevisionEntry, RevisionState } from './seed';
import type { ApiRecord, ApiRevision } from './schema';

export type { CarbonRecord, Finding, RecordStatus, RevisionEntry, RevisionState };

// 修订生效后需要失效重算的签发门禁项：均为数据相关确认；方法学匹配不受数据修订影响。
const DATA_DEPENDENT_CHECKS = ['evidence', 'calculation', 'revisions'] as const;

type State = {
  records: CarbonRecord[];
  findings: Finding[];
  selectedRecordId: string;
  sampledIds: string[];
  issuanceChecks: Record<string, boolean>;
  // 最近一次导致门禁失效的修订说明，用于在签发准备页提示确认为何被重置。
  issuanceNotice: string | null;
  selectRecord: (id: string) => void;
  toggleSample: (id: string) => void;
  startCorrection: (id: string) => void;
  verifyRecord: (id: string) => void;
  batchVerify: () => void;
  requestEvidence: (findingId: string) => void;
  closeFinding: (findingId: string) => void;
  toggleIssuanceCheck: (id: string) => void;
  // 以服务端数据为准同步记录（含完整修订链）。
  syncFromServer: (records: ApiRecord[]) => void;
  // 提交被接受后落地新版本（幂等重试时不会重复追加）。
  applyCommittedRevision: (input: {
    recordId: string;
    version: number;
    value: number;
    reason: string;
    actor: string;
    recordedAt: string;
    state: RevisionState;
  }) => void;
};

function toClientRevision(entry: ApiRevision): RevisionEntry {
  return {
    version: entry.version,
    value: entry.value,
    reason: entry.reason,
    actor: entry.actor,
    recordedAt: entry.recordedAt,
    state: entry.state
  };
}

export const useCarbonStore = create<State>()(
  persist(
    (set) => ({
      records: defaultRecords,
      findings: defaultFindings,
      selectedRecordId: 'ACT-0318',
      sampledIds: ['ACT-0318', 'ACT-0337'],
      issuanceChecks: { evidence: false, calculation: true, revisions: true, methodology: false },
      issuanceNotice: null,
      selectRecord: (id) => set({ selectedRecordId: id }),
      toggleSample: (id) => set((state) => ({ sampledIds: state.sampledIds.includes(id) ? state.sampledIds.filter((item) => item !== id) : [...state.sampledIds, id] })),
      startCorrection: (id) => set((state) => ({ records: state.records.map((record) => record.id === id ? { ...record, status: '复核中' } : record) })),
      verifyRecord: (id) => set((state) => ({
        records: state.records.map((record) => {
          if (record.id !== id) return record;
          // 修订链中处于复核中的结论随核验通过一并确认。
          return {
            ...record,
            status: '已核验',
            revisions: record.revisions.map((entry) => entry.state === '复核中' ? { ...entry, state: '已确认' } : entry)
          };
        })
      })),
      batchVerify: () => set((state) => ({
        records: state.records.map((record) => state.sampledIds.includes(record.id) && record.status !== '需补证'
          ? { ...record, status: '已核验', revisions: record.revisions.map((entry) => entry.state === '复核中' ? { ...entry, state: '已确认' } : entry) }
          : record)
      })),
      requestEvidence: (findingId) => set((state) => ({ findings: state.findings.map((finding) => finding.id === findingId ? { ...finding, status: '补证中' } : finding) })),
      closeFinding: (findingId) => set((state) => ({ findings: state.findings.map((finding) => finding.id === findingId ? { ...finding, status: '已关闭' } : finding) })),
      toggleIssuanceCheck: (id) => set((state) => ({ issuanceChecks: { ...state.issuanceChecks, [id]: !state.issuanceChecks[id] } })),
      syncFromServer: (incoming) => set((state) => ({
        records: incoming.map((record) => ({ ...record, revisions: record.revisions.map(toClientRevision) })),
        selectedRecordId: incoming.some((record) => record.id === state.selectedRecordId) ? state.selectedRecordId : incoming[0]?.id ?? state.selectedRecordId
      })),
      applyCommittedRevision: (input) => set((state) => {
        const target = state.records.find((record) => record.id === input.recordId);
        if (!target) return state;
        // 幂等重试：同一版本已落地则保持第一次的结果，不重复追加。
        if (target.revisions.some((entry) => entry.version === input.version)) {
          return state;
        }

        const entry: RevisionEntry = {
          version: input.version,
          value: input.value,
          reason: input.reason,
          actor: input.actor,
          recordedAt: input.recordedAt,
          state: input.state
        };

        return {
          records: state.records.map((record) => record.id === input.recordId ? {
            ...record,
            activity: entry.value,
            revision: entry.version,
            // 修订生效：活动数据回到复核中，旧核验结论不再挂用。
            status: '复核中',
            revisions: [...record.revisions, entry]
          } : record),
          // 该数据的关联发现项重新打开（已关闭的回到开放，补证中/开放维持原状）。
          findings: state.findings.map((finding) => finding.recordId === input.recordId && finding.status === '已关闭'
            ? { ...finding, status: '开放' }
            : finding),
          // 签发准备中数据相关的人工确认全部失效，需要基于新版本重新确认；就绪度按新勾选重算。
          issuanceChecks: Object.fromEntries(
            Object.entries(state.issuanceChecks).map(([key, value]) => [key, DATA_DEPENDENT_CHECKS.includes(key as (typeof DATA_DEPENDENT_CHECKS)[number]) ? false : value])
          ),
          issuanceNotice: `${input.recordId} 的 V${input.version} 修订已生效，活动数据回到复核中，证据链、计算过程与修订追溯的确认已失效，请基于新版本重新复核。`
        };
      })
    }),
    {
      name: 'yy60-carbon-evidence',
      version: 1,
      // 旧版本本地状态没有 append-only 修订链，直接丢弃其中的记录（加载后会由服务端数据同步）。
      migrate: (persisted) => {
        const previous = (persisted ?? {}) as Partial<State>;
        return {
          records: defaultRecords,
          findings: previous.findings ?? defaultFindings,
          selectedRecordId: previous.selectedRecordId ?? 'ACT-0318',
          sampledIds: previous.sampledIds ?? ['ACT-0318', 'ACT-0337'],
          issuanceChecks: previous.issuanceChecks ?? { evidence: false, calculation: true, revisions: true, methodology: false },
          issuanceNotice: null
        } as State;
      }
    }
  )
);
