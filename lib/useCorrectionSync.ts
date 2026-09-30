'use client';

import { useEffect, useRef } from 'react';
import { fetchEvidence, submitEvidenceCorrection, VersionConflictError, type CorrectionInput } from './api';
import { useCarbonStore } from './store';
import { useQueueStore } from './offlineQueue';
import { queryClient } from './queryClient';

// 正在补交的提交标识，避免 online 事件与定时器重复触发同一请求。
const inFlight = new Set<string>();

export type SubmitOutcome =
  | { kind: 'accepted'; revision: number; idempotent: boolean }
  | { kind: 'queued'; clientToken: string }
  | { kind: 'conflict'; currentVersion: number; currentValue: number; message: string }
  | { kind: 'error'; message: string };

async function flushItem(item: CorrectionInput): Promise<'accepted' | 'offline' | 'conflict' | 'error'> {
  if (inFlight.has(item.clientToken)) return 'offline';
  inFlight.add(item.clientToken);
  const queue = useQueueStore.getState();
  const previous = queue.queue.find((pending) => pending.clientToken === item.clientToken);
  queue.patch(item.clientToken, { status: '提交中', attempts: (previous?.attempts ?? 0) + 1 });
  try {
    const result = await submitEvidenceCorrection(item);
    useCarbonStore.getState().applyCommittedRevision({
      recordId: result.recordId,
      version: result.revision,
      value: result.value,
      reason: item.reason,
      actor: item.actor,
      recordedAt: result.recordedAt,
      state: result.state
    });
    useQueueStore.getState().remove(item.clientToken);
    queryClient.invalidateQueries({ queryKey: ['carbon-api'] });
    return 'accepted';
  } catch (error) {
    if (error instanceof VersionConflictError) {
      queue.patch(item.clientToken, {
        status: '版本冲突',
        conflictVersion: error.currentVersion,
        conflictValue: error.currentValue,
        conflictMessage: error.message,
        lastError: error.message
      });
      return 'conflict';
    }
    if (error instanceof TypeError && error.message === 'OFFLINE') {
      queue.patch(item.clientToken, { status: '待提交', lastError: '网络不可用，等待恢复后补交' });
      return 'offline';
    }
    queue.patch(item.clientToken, {
      status: '失败',
      lastError: error instanceof Error ? error.message : '提交失败'
    });
    return 'error';
  } finally {
    inFlight.delete(item.clientToken);
  }
}

// 依次补交队列；每条修订独立处理，某条失败或版本冲突不影响其他记录（不同数据不互卡）。
export async function drainQueue(): Promise<void> {
  const items = useQueueStore.getState().queue.filter((item) => item.status !== '版本冲突');
  await Promise.allSettled(items.map((item) => flushItem(item)));
}

// 修订提交入口：在线直接提交；断网先留本地待提交，恢复后按原标识补交。
export async function submitOrQueue(input: CorrectionInput): Promise<SubmitOutcome> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    useQueueStore.getState().enqueue(input);
    return { kind: 'queued', clientToken: input.clientToken };
  }
  try {
    const result = await submitEvidenceCorrection(input);
    useCarbonStore.getState().applyCommittedRevision({
      recordId: result.recordId,
      version: result.revision,
      value: result.value,
      reason: input.reason,
      actor: input.actor,
      recordedAt: result.recordedAt,
      state: result.state
    });
    queryClient.invalidateQueries({ queryKey: ['carbon-api'] });
    return { kind: 'accepted', revision: result.revision, idempotent: result.idempotent };
  } catch (error) {
    if (error instanceof VersionConflictError) {
      return { kind: 'conflict', currentVersion: error.currentVersion, currentValue: error.currentValue, message: error.message };
    }
    if (error instanceof TypeError && error.message === 'OFFLINE') {
      useQueueStore.getState().enqueue(input);
      return { kind: 'queued', clientToken: input.clientToken };
    }
    return { kind: 'error', message: error instanceof Error ? error.message : '提交失败' };
  }
}

// 拉取服务端最新数据（409 后刷新或重新可见时调用），随后继续补交本地队列。
export async function refreshFromServer(): Promise<void> {
  const payload = await fetchEvidence();
  useCarbonStore.getState().syncFromServer(payload.records);
  await drainQueue();
}

// 挂载在根部：负责初始同步、online 事件补交、定时兜底，以及把 GET 结果写入 store。
export function EvidenceSync() {
  const syncedRef = useRef(false);

  useEffect(() => {
    if (syncedRef.current) return;
    syncedRef.current = true;

    const sync = () => {
      refreshFromServer().catch(() => undefined);
    };
    sync();

    const handleOnline = () => drainQueue().catch(() => undefined);
    const handleVisible = () => {
      if (document.visibilityState === 'visible') sync();
    };
    window.addEventListener('online', handleOnline);
    document.addEventListener('visibilitychange', handleVisible);
    const timer = window.setInterval(() => {
      if (navigator.onLine && useQueueStore.getState().queue.length > 0) {
        drainQueue().catch(() => undefined);
      }
    }, 15_000);

    return () => {
      window.removeEventListener('online', handleOnline);
      document.removeEventListener('visibilitychange', handleVisible);
      window.clearInterval(timer);
    };
  }, []);

  return null;
}
