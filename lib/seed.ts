// 活动数据记录与修订链的共享领域模型与种子数据。
// 修订只追加（append-only），记录上的 activity/revision/status 始终是最新一条修订的投影。

export type RecordStatus = '待核验' | '复核中' | '已核验' | '需补证';

export type RevisionState = '复核中' | '已确认';

export type RevisionEntry = {
  version: number;
  value: number;
  reason: string;
  actor: string;
  recordedAt: string;
  state: RevisionState;
};

export type CarbonRecord = {
  id: string;
  source: string;
  activity: number;
  unit: string;
  factor: number;
  factorUnit: string;
  timeRange: string;
  evidenceCount: number;
  anomaly: number;
  owner: string;
  status: RecordStatus;
  revision: number;
  revisions: RevisionEntry[];
};

export type Finding = {
  id: string;
  recordId: string;
  type: '缺失证据' | '单位不一致' | '时间范围' | '异常波动';
  title: string;
  detail: string;
  assignee: string;
  due: string;
  status: '开放' | '补证中' | '已关闭';
};

type RecordSeed = Omit<CarbonRecord, 'revisions'>;

// 当前活动值的修订原因，用于生成种子修订链最后一条。
const currentRevisionMeta: Record<string, { reason: string; actor: string }> = {
  'ACT-0318': { reason: '按现场抄表复核结果修正压缩机组电量口径', actor: '项目现场 · 徐璐' },
  'ACT-0321': { reason: '扣除冷凝水回收对应蒸汽量', actor: '能源中心 · 周珩' },
  'ACT-0325': { reason: '补入应急泵月末柴油领用记录', actor: '设备保障部 · 姜婷' },
  'ACT-0331': { reason: '按逆变器导出电量首录', actor: '新能源运维 · 林澈' },
  'ACT-0337': { reason: '按流量计首录天然气用量', actor: '热力站 · 韩跃' }
};

const recordSeeds: RecordSeed[] = [
  { id: 'ACT-0318', source: '电表 E-17 / 四号压缩机组', activity: 428650, unit: 'kWh', factor: 0.5568, factorUnit: 'tCO2/MWh', timeRange: '2026-07-01 至 07-31', evidenceCount: 4, anomaly: 2.3, owner: '项目现场 O2', status: '复核中', revision: 3 },
  { id: 'ACT-0321', source: '蒸汽流量计 ST-04', activity: 2038.4, unit: 'GJ', factor: 0.1100, factorUnit: 'tCO2/GJ', timeRange: '2026-07-01 至 07-31', evidenceCount: 3, anomaly: 0, owner: '能源中心', status: '已核验', revision: 2 },
  { id: 'ACT-0325', source: '柴油消耗台账 / 应急泵', activity: 1846, unit: 'L', factor: 2.6800, factorUnit: 'kgCO2/L', timeRange: '2026-07-01 至 07-31', evidenceCount: 2, anomaly: 8.6, owner: '设备保障部', status: '需补证', revision: 4 },
  { id: 'ACT-0331', source: '光伏逆变器阵列 PV-2', activity: 182460, unit: 'kWh', factor: 0.5568, factorUnit: 'tCO2/MWh', timeRange: '2026-07-01 至 07-31', evidenceCount: 5, anomaly: -1.2, owner: '新能源运维', status: '已核验', revision: 1 },
  { id: 'ACT-0337', source: '天然气流量计 NG-02', activity: 62.8, unit: 'kNm3', factor: 2.1622, factorUnit: 'tCO2/kNm3', timeRange: '2026-07-01 至 07-31', evidenceCount: 1, anomaly: 12.4, owner: '热力站', status: '待核验', revision: 1 }
];

const revisionReasons = [
  { reason: '首录计量数据', actor: '系统' },
  { reason: '统一电量单位并附原始记录', actor: '徐璐' },
  { reason: '要求补充流量计校准证据', actor: '沈楠' },
  { reason: '补充测试运行时长说明', actor: '姜婷' }
];

function seedRevisions(seed: RecordSeed): RevisionEntry[] {
  const entries: RevisionEntry[] = [];
  for (let version = 1; version <= seed.revision; version += 1) {
    const isCurrent = version === seed.revision;
    const meta = isCurrent
      ? currentRevisionMeta[seed.id]
      : revisionReasons[Math.min(version - 1, revisionReasons.length - 1)];
    entries.push({
      version,
      // 历史值与当前值略有差异，仅用于演示版本链，不影响计算链的当前结果。
      value: isCurrent ? seed.activity : Math.round(seed.activity * (1 - (seed.revision - version) * 0.012) * 10) / 10,
      reason: meta.reason,
      actor: meta.actor,
      recordedAt: `2026-07-${String(2 + version).padStart(2, '0')}T09:30:00.000Z`,
      // 最新修订如果还在复核中，其确认结论也仍在复核；更早版本均已确认。
      state: isCurrent && seed.status === '复核中' ? '复核中' : '已确认'
    });
  }
  return entries;
}

export const defaultRecords: CarbonRecord[] = recordSeeds.map((seed) => ({ ...seed, revisions: seedRevisions(seed) }));

export const defaultFindings: Finding[] = [
  { id: 'F-104', recordId: 'ACT-0337', type: '缺失证据', title: '缺少天然气流量计校验证书', detail: '计量记录已提交，但校准有效期证明不足。', assignee: '热力站 · 韩跃', due: '09-30', status: '开放' },
  { id: 'F-105', recordId: 'ACT-0325', type: '异常波动', title: '柴油消耗较上期上升 18.6%', detail: '项目方尚未说明测试运行时长变化。', assignee: '设备保障部 · 姜婷', due: '10-02', status: '补证中' },
  { id: 'F-106', recordId: 'ACT-0318', type: '单位不一致', title: '原始表单位为 MWh，台账记录为 kWh', detail: '需补充单位换算链并保留原始记录。', assignee: '项目现场 · 徐璐', due: '09-30', status: '开放' }
];
