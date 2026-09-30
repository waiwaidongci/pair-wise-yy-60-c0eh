import { QueryClient } from '@tanstack/react-query';

// 共享 QueryClient：UI 与修订同步控制器都用它失效查询缓存。
export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } }
});
