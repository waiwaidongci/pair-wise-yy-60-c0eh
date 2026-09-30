import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CarbonRecord, Finding, EvidenceResponse, RecordStatus } from '@/lib/schema';
import { submitRevision } from '@/lib/api';

const CURRENT_ACTOR = '沈楠';

const defaultRecords: CarbonRecord[] = [
  { id: 'ACT-0318', source: '电表 E-17 / 四号压缩机组', activity: 428650, unit: 'kWh', factor: 0.5568, factorUnit: 'tCO2/MWh', timeRange: '2026-07-01 至 07-31', evidenceCount: 4, anomaly: 2.3, owner: '项目现场 O2', status: '复核中', revision: 3, revisions: [] },
  { id: 'ACT-0321', source: '蒸汽流量计 ST-04', activity: 2038.4, unit: 'GJ', factor: 0.1100, factorUnit: 'tCO2/GJ', timeRange: '2026-07-01 至 07-31', evidenceCount: 3, anomaly: 0, owner: '能源中心', status: '已核验', revision: 2, revisions: [] },
  { id: 'ACT-0325', source: '柴油消耗台账 / 应急泵', activity: 1846, unit: 'L', factor: 2.6800, factorUnit: 'kgCO2/L', timeRange: '2026-07-01 至 07-31', evidenceCount: 2, anomaly: 8.6, owner: '设备保障部', status: '需补证', revision: 4, revisions: [] },
  { id: 'ACT-0331', source: '光伏逆变器阵列 PV-2', activity: 182460, unit: 'kWh', factor: 0.5568, factorUnit: 'tCO2/MWh', timeRange: '2026-07-01 至 07-31', evidenceCount: 5, anomaly: -1.2, owner: '新能源运维', status: '已核验', revision: 1, revisions: [] },
  { id: 'ACT-0337', source: '天然气流量计 NG-02', activity: 62.8, unit: 'kNm3', factor: 2.1622, factorUnit: 'tCO2/kNm3', timeRange: '2026-07-01 至 07-31', evidenceCount: 1, anomaly: 12.4, owner: '热力站', status: '待核验', revision: 1, revisions: [] }
];

const defaultFindings: Finding[] = [
  { id: 'F-104', recordId: 'ACT-0337', type: '缺失证据', title: '缺少天然气流量计校验证书', detail: '计量记录已提交，但校准有效期证明不足。', assignee: '热力站 · 韩跃', due: '09-30', status: '开放' },
  { id: 'F-105', recordId: 'ACT-0325', type: '异常波动', title: '柴油消耗较上期上升 18.6%', detail: '项目方尚未说明测试运行时长变化。', assignee: '设备保障部 · 姜婷', due: '10-02', status: '补证中' },
  { id: 'F-106', recordId: 'ACT-0318', type: '单位不一致', title: '原始表单位为 MWh，台账记录为 kWh', detail: '需补充单位换算链并保留原始记录。', assignee: '项目现场 · 徐璐', due: '09-30', status: '开放' }
];

const seedRevision = (record: CarbonRecord) => ({
  version: record.revision,
  activity: record.activity,
  reason: '初始监测数据',
  actor: record.owner,
  recordedAt: '2026-07-31T00:00:00.000Z',
  clientSubmissionId: 'seed'
});

const withSeedRevisions = (records: CarbonRecord[]): CarbonRecord[] =>
  records.map((record) => ({ ...record, revisions: record.revisions.length > 0 ? record.revisions : [seedRevision(record)] }));

export type OutboxStatus = 'pending' | 'conflict' | 'accepted';

export type OutboxItem = {
  id: string;
  recordId: string;
  value: number;
  reason: string;
  actor: string;
  baseVersion: number;
  clientSubmissionId: string;
  status: OutboxStatus;
  conflictVersion?: number;
  createdAt: string;
};

export type ConflictInfo = {
  recordId: string;
  currentVersion: number;
  clientSubmissionId: string;
  value: number;
};

type State = {
  records: CarbonRecord[];
  findings: Finding[];
  selectedRecordId: string;
  sampledIds: string[];
  issuanceChecks: Record<string, boolean>;
  outbox: OutboxItem[];
  lastConflict: ConflictInfo | null;
  online: boolean;
  hydrate: (data: EvidenceResponse) => void;
  selectRecord: (id: string) => void;
  toggleSample: (id: string) => void;
  startCorrection: (id: string) => void;
  verifyRecord: (id: string) => void;
  batchVerify: () => void;
  requestEvidence: (findingId: string) => void;
  closeFinding: (findingId: string) => void;
  toggleIssuanceCheck: (id: string) => void;
  submitRevision: (recordId: string, value: number, reason: string) => void;
  retryConflict: (recordId: string) => void;
  dismissConflict: () => void;
  flushOutbox: () => Promise<void>;
  setOnline: (online: boolean) => void;
};

const newId = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

export const useCarbonStore = create<State>()(
  persist(
    (set, get) => ({
      records: withSeedRevisions(defaultRecords),
      findings: defaultFindings,
      selectedRecordId: 'ACT-0318',
      sampledIds: ['ACT-0318', 'ACT-0337'],
      issuanceChecks: { evidence: false, calculation: true, revisions: true, methodology: false },
      outbox: [],
      lastConflict: null,
      online: typeof navigator !== 'undefined' ? navigator.onLine : true,

      hydrate: (data) => set({
        records: data.records,
        findings: data.findings,
        issuanceChecks: data.issuanceChecks
      }),

      selectRecord: (id) => set({ selectedRecordId: id }),
      toggleSample: (id) => set((state) => ({ sampledIds: state.sampledIds.includes(id) ? state.sampledIds.filter((item) => item !== id) : [...state.sampledIds, id] })),
      startCorrection: (id) => set((state) => ({ records: state.records.map((record) => record.id === id ? { ...record, status: '复核中' } : record) })),
      verifyRecord: (id) => set((state) => ({ records: state.records.map((record) => record.id === id ? { ...record, status: '已核验' } : record) })),
      batchVerify: () => set((state) => ({ records: state.records.map((record) => state.sampledIds.includes(record.id) && record.status !== '需补证' ? { ...record, status: '已核验' } : record) })),
      requestEvidence: (findingId) => set((state) => ({ findings: state.findings.map((finding) => finding.id === findingId ? { ...finding, status: '补证中' } : finding) })),
      closeFinding: (findingId) => set((state) => ({ findings: state.findings.map((finding) => finding.id === findingId ? { ...finding, status: '已关闭' } : finding) })),
      toggleIssuanceCheck: (id) => set((state) => ({ issuanceChecks: { ...state.issuanceChecks, [id]: !state.issuanceChecks[id] } })),

      submitRevision: (recordId, value, reason) => {
        const state = get();
        const record = state.records.find((item) => item.id === recordId);
        if (!record || !Number.isFinite(value) || !reason.trim()) return;
        const item: OutboxItem = {
          id: newId('ob'),
          recordId,
          value,
          reason: reason.trim(),
          actor: CURRENT_ACTOR,
          baseVersion: record.revision,
          clientSubmissionId: newId('cs'),
          status: 'pending',
          createdAt: new Date().toISOString()
        };
        set((s) => ({ outbox: [...s.outbox, item] }));
        void get().flushOutbox();
      },

      retryConflict: (recordId) => {
        const state = get();
        const conflict = state.outbox.find((item) => item.recordId === recordId && item.status === 'conflict');
        const record = state.records.find((item) => item.id === recordId);
        if (!conflict || !record) return;
        // 冲突后基于服务端当前版本重新提交，使用新的稳定提交标识。
        const item: OutboxItem = {
          id: newId('ob'),
          recordId,
          value: conflict.value,
          reason: conflict.reason,
          actor: conflict.actor,
          baseVersion: record.revision,
          clientSubmissionId: newId('cs'),
          status: 'pending',
          createdAt: new Date().toISOString()
        };
        set((s) => ({
          outbox: [...s.outbox.filter((o) => o.id !== conflict.id), item],
          lastConflict: null
        }));
        void get().flushOutbox();
      },

      dismissConflict: () => set({ lastConflict: null }),

      flushOutbox: async () => {
        const state = get();
        const pending = state.outbox.filter((item) => item.status === 'pending');
        if (pending.length === 0) return;
        // 各条待提交相互独立：一条冲突或失败不阻塞其他数据补交。
        await Promise.all(pending.map((item) => flushItem(item)));
      },

      setOnline: (online) => set({ online })
    }),
    {
      name: 'yy60-carbon-evidence',
      partialize: (state) => ({
        records: state.records,
        findings: state.findings,
        selectedRecordId: state.selectedRecordId,
        sampledIds: state.sampledIds,
        issuanceChecks: state.issuanceChecks,
        outbox: state.outbox
      })
    }
  )
);

/**
 * 提交单条待提交记录。接受后追加版本、回到复核中、重开关联发现项、
 * 失效签发确认；409 则标记冲突并列出服务端当前版本；离线则保留待提交。
 */
async function flushItem(item: OutboxItem): Promise<void> {
  const result = await submitRevision({
    recordId: item.recordId,
    value: item.value,
    reason: item.reason,
    actor: item.actor,
    baseVersion: item.baseVersion,
    clientSubmissionId: item.clientSubmissionId
  });

  if (result.ok) {
    const { revision, recordedAt, clientSubmissionId } = result.accepted;
    useCarbonStore.setState((state) => ({
      outbox: state.outbox.map((o) => o.id === item.id ? { ...o, status: 'accepted' as const } : o),
      records: state.records.map((record) => record.id === item.recordId ? {
        ...record,
        activity: item.value,
        revision,
        status: '复核中' as RecordStatus,
        revisions: [
          ...record.revisions,
          { version: revision, activity: item.value, reason: item.reason, actor: item.actor, recordedAt, clientSubmissionId }
        ]
      } : record),
      findings: state.findings.map((finding) => finding.recordId === item.recordId && finding.status === '已关闭' ? { ...finding, status: '开放' as const } : finding),
      issuanceChecks: Object.fromEntries(Object.keys(state.issuanceChecks).map((key) => [key, false]))
    }));
    return;
  }

  if (result.status === 409) {
    useCarbonStore.setState((state) => ({
      outbox: state.outbox.map((o) => o.id === item.id ? { ...o, status: 'conflict' as const, conflictVersion: result.conflict.currentVersion } : o),
      lastConflict: {
        recordId: item.recordId,
        currentVersion: result.conflict.currentVersion,
        clientSubmissionId: item.clientSubmissionId,
        value: item.value
      }
    }));
    return;
  }

  if (result.status === 'offline') {
    // 保留 pending，等恢复联网后按原标识补交。
    return;
  }

  // 其他错误：保留 pending 并提示。
  useCarbonStore.setState((state) => ({
    lastConflict: {
      recordId: item.recordId,
      currentVersion: -1,
      clientSubmissionId: item.clientSubmissionId,
      value: item.value
    }
  }));
}
