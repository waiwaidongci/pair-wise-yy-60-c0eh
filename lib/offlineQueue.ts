import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CorrectionInput } from './api';

export type QueueStatus = '待提交' | '提交中' | '版本冲突' | '失败';

// 断网期间保留在本地的待提交修订；恢复网络后按原 clientToken 补交。
export type PendingCorrection = CorrectionInput & {
  status: QueueStatus;
  // 版本过期时记录服务端当前版本，供用户刷新或放弃。
  conflictVersion?: number;
  conflictValue?: number;
  conflictMessage?: string;
  attempts: number;
  queuedAt: string;
  lastError?: string;
};

type QueueState = {
  queue: PendingCorrection[];
  enqueue: (item: CorrectionInput) => void;
  patch: (clientToken: string, patch: Partial<PendingCorrection>) => void;
  remove: (clientToken: string) => void;
  clearFinished: () => void;
};

export const useQueueStore = create<QueueState>()(
  persist(
    (set) => ({
      queue: [],
      enqueue: (item) => set((state) => state.queue.some((pending) => pending.clientToken === item.clientToken)
        ? state
        : {
            queue: [...state.queue, { ...item, status: '待提交', attempts: 0, queuedAt: new Date().toISOString() }]
          }),
      patch: (clientToken, patch) => set((state) => ({
        queue: state.queue.map((pending) => pending.clientToken === clientToken ? { ...pending, ...patch } : pending)
      })),
      remove: (clientToken) => set((state) => ({ queue: state.queue.filter((pending) => pending.clientToken !== clientToken) })),
      clearFinished: () => set({ queue: [] })
    }),
    { name: 'yy60-correction-queue' }
  )
);
