import { NextResponse } from 'next/server';
import {
  evidenceResponseSchema,
  revisionAcceptedSchema,
  revisionConflictSchema,
  revisionSubmissionSchema,
  type CarbonRecord,
  type Finding,
  type Revision
} from '@/lib/schema';

const seedRecords: CarbonRecord[] = [
  { id: 'ACT-0318', source: '电表 E-17 / 四号压缩机组', activity: 428650, unit: 'kWh', factor: 0.5568, factorUnit: 'tCO2/MWh', timeRange: '2026-07-01 至 07-31', evidenceCount: 4, anomaly: 2.3, owner: '项目现场 O2', status: '复核中', revision: 3, revisions: [] },
  { id: 'ACT-0321', source: '蒸汽流量计 ST-04', activity: 2038.4, unit: 'GJ', factor: 0.1100, factorUnit: 'tCO2/GJ', timeRange: '2026-07-01 至 07-31', evidenceCount: 3, anomaly: 0, owner: '能源中心', status: '已核验', revision: 2, revisions: [] },
  { id: 'ACT-0325', source: '柴油消耗台账 / 应急泵', activity: 1846, unit: 'L', factor: 2.6800, factorUnit: 'kgCO2/L', timeRange: '2026-07-01 至 07-31', evidenceCount: 2, anomaly: 8.6, owner: '设备保障部', status: '需补证', revision: 4, revisions: [] },
  { id: 'ACT-0331', source: '光伏逆变器阵列 PV-2', activity: 182460, unit: 'kWh', factor: 0.5568, factorUnit: 'tCO2/MWh', timeRange: '2026-07-01 至 07-31', evidenceCount: 5, anomaly: -1.2, owner: '新能源运维', status: '已核验', revision: 1, revisions: [] },
  { id: 'ACT-0337', source: '天然气流量计 NG-02', activity: 62.8, unit: 'kNm3', factor: 2.1622, factorUnit: 'tCO2/kNm3', timeRange: '2026-07-01 至 07-31', evidenceCount: 1, anomaly: 12.4, owner: '热力站', status: '待核验', revision: 1, revisions: [] }
];

const seedFindings: Finding[] = [
  { id: 'F-104', recordId: 'ACT-0337', type: '缺失证据', title: '缺少天然气流量计校验证书', detail: '计量记录已提交，但校准有效期证明不足。', assignee: '热力站 · 韩跃', due: '09-30', status: '开放' },
  { id: 'F-105', recordId: 'ACT-0325', type: '异常波动', title: '柴油消耗较上期上升 18.6%', detail: '项目方尚未说明测试运行时长变化。', assignee: '设备保障部 · 姜婷', due: '10-02', status: '补证中' },
  { id: 'F-106', recordId: 'ACT-0318', type: '单位不一致', title: '原始表单位为 MWh，台账记录为 kWh', detail: '需补充单位换算链并保留原始记录。', assignee: '项目现场 · 徐璐', due: '09-30', status: '开放' }
];

const initialRevision = (record: CarbonRecord): Revision => ({
  version: record.revision,
  activity: record.activity,
  reason: '初始监测数据',
  actor: record.owner,
  recordedAt: '2026-07-31T00:00:00.000Z',
  clientSubmissionId: 'seed'
});

/** 服务端权威状态：修订以追加形式存入 revisions，绝不覆盖历史版本。 */
const state = {
  records: seedRecords.map((record) => ({ ...record, revisions: [initialRevision(record)] })),
  findings: seedFindings.map((finding) => ({ ...finding })),
  issuanceChecks: { evidence: false, calculation: true, revisions: true, methodology: false }
};

/** 已接受提交的幂等表：同一 clientSubmissionId 重试返回第一次结果。 */
const acceptedSubmissions = new Map<string, ReturnType<typeof revisionAcceptedSchema.parse>>();

const project = {
  id: 'CN-ER-2026-041',
  name: '临港工业园区能效提升项目',
  methodology: 'CMS-052-V01',
  vintage: '2026 监测年度',
  verifier: '华碳认证 · 核验组 B'
};

const summary = {
  period: '2026 年第三监测期',
  reduction: 18426,
  evidenceRate: 92,
  openFindings: 3,
  sampled: 18
};

export async function GET() {
  return NextResponse.json(evidenceResponseSchema.parse({
    project,
    summary,
    records: state.records,
    findings: state.findings,
    issuanceChecks: state.issuanceChecks
  }));
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ accepted: false, error: 'invalid_json' }, { status: 400 });
  }

  const parsed = revisionSubmissionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ accepted: false, error: 'invalid_request', details: parsed.error.flatten() }, { status: 400 });
  }
  const { recordId, value, reason, actor, baseVersion, clientSubmissionId } = parsed.data;

  // 幂等：同一稳定提交标识重试，直接返回第一次接受的结果，不重复追加版本。
  const prior = acceptedSubmissions.get(clientSubmissionId);
  if (prior) {
    return NextResponse.json(prior, { status: 200 });
  }

  const record = state.records.find((item) => item.id === recordId);
  if (!record) {
    return NextResponse.json({ accepted: false, error: 'not_found', recordId }, { status: 404 });
  }

  // 乐观并发：提交所基于的版本必须等于服务端当前版本，否则 409 并列出当前版本。
  if (record.revision !== baseVersion) {
    const conflict = revisionConflictSchema.parse({
      accepted: false,
      error: 'version_conflict',
      recordId,
      currentVersion: record.revision,
      currentRevision: record.revisions[record.revisions.length - 1],
      clientSubmissionId
    });
    return NextResponse.json(conflict, { status: 409 });
  }

  // 追加式修订：版本号递增，历史版本保留不动。
  const newVersion = record.revision + 1;
  const revision: Revision = {
    version: newVersion,
    activity: value,
    reason,
    actor,
    recordedAt: new Date().toISOString(),
    clientSubmissionId
  };
  record.revisions.push(revision);
  record.activity = value;
  record.revision = newVersion;
  record.status = '复核中';

  // 关联发现项重新打开：修订后原核验结论失效。
  for (const finding of state.findings) {
    if (finding.recordId === recordId && finding.status === '已关闭') {
      finding.status = '开放';
    }
  }

  // 签发准备确认失效：所有门禁项回到未确认，待重新计算。
  for (const key of Object.keys(state.issuanceChecks) as Array<keyof typeof state.issuanceChecks>) {
    state.issuanceChecks[key] = false;
  }

  const accepted = revisionAcceptedSchema.parse({
    accepted: true,
    recordId,
    revision: newVersion,
    previousVersion: baseVersion,
    recordedAt: revision.recordedAt,
    clientSubmissionId,
    status: '复核中'
  });
  acceptedSubmissions.set(clientSubmissionId, accepted);
  return NextResponse.json(accepted, { status: 200 });
}
