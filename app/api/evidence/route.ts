import { NextResponse } from 'next/server';
import { correctionRequestSchema, evidenceResponseSchema } from '@/lib/schema';
import { applyCorrection, serverStore } from '@/lib/store-server';

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
    records: serverStore.records
  }));
}

export async function POST(request: Request) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: 'BAD_REQUEST', message: '请求体不是合法 JSON。' }, { status: 400 });
  }

  const parsed = correctionRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({
      error: 'VALIDATION_FAILED',
      message: '修订参数不完整或不合法。',
      issues: parsed.error.issues
    }, { status: 400 });
  }

  const outcome = applyCorrection(parsed.data);

  if (outcome.outcome === 'not_found') {
    return NextResponse.json({ error: 'NOT_FOUND', message: '活动数据记录不存在。', recordId: parsed.data.recordId }, { status: 404 });
  }

  if (outcome.outcome === 'accepted') {
    return NextResponse.json(outcome.response, {
      headers: { 'Idempotency-Key': parsed.data.clientToken }
    });
  }

  // conflict（版本过期）与 token_mismatch（标识复用冲突）均以 409 返回并列出当前版本信息。
  return NextResponse.json(outcome.body, { status: 409 });
}
