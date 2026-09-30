# pair-wise-yy-60 碳减排项目监测证据核验与签发准备平台

按监测周期完成活动数据、排放因子、证据来源、异常波动和计算链核验。支持抽样任务、版本化数据修订、发现项闭环和签发前完整性检查。

## 技术栈

Next.js App Router、MUI、Zustand、TanStack Query、ky、Zod、TypeScript。

## 运行

```bash
npm install
npm run dev
```

访问 `http://localhost:62060`。`/api/evidence` 提供分页场景所需的本地 REST 数据接口。

## 修订并发与离线语义

- **追加式版本链**：每条活动数据的修订只追加（`records[].revisions`），`activity / revision / status` 是最新版本的投影，历史版本不覆盖。
- **乐观并发**：修订提交必须携带 `baseVersion`（上一版号）与 `clientToken`（稳定提交标识）。提交时版号落后于服务端当前版本，返回 `409 VERSION_CONFLICT`，body 中给出 `currentVersion / currentValue / currentRevision`，客户端刷新后基于新版本重试。
- **幂等**：同一 `clientToken` 的重试直接返回第一次的处理结果（`idempotent: true`），不会产生新版本；标识复用到其他记录返回 409。
- **修订生效联动**：记录状态回到「复核中」，该记录关联的已关闭发现项重新打开，签发准备中证据链/计算过程/修订追溯三项确认失效、就绪度重算（方法学匹配不受影响）。
- **离线补交**：断网时修订进入本地持久化待提交队列（`yy60-correction-queue`），恢复网络（online 事件、定时兜底、页面重新可见）后按原 `clientToken` 自动补交；不同记录的待提交项互不阻塞，版本过期的条目保留并提示刷新或放弃。

```bash
npm run build
```
