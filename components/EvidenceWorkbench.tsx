'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  AppBar,
  Avatar,
  Badge,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  Drawer,
  IconButton,
  LinearProgress,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  MenuItem,
  Select,
  Stack,
  Tab,
  Tabs,
  TextField,
  Toolbar,
  Tooltip,
  Typography
} from '@mui/material';
import type { AlertColor } from '@mui/material';
import {
  AccountTreeOutlined,
  AssessmentOutlined,
  AssignmentTurnedInOutlined,
  CheckCircleOutlined,
  CloudUploadOutlined,
  DashboardOutlined,
  FactCheckOutlined,
  FindInPageOutlined,
  HistoryOutlined,
  MenuOutlined,
  MoreHorizOutlined,
  NotificationsNoneOutlined,
  RuleOutlined,
  ScienceOutlined,
  SyncOutlined,
  TaskAltOutlined,
  WifiOffOutlined
} from '@mui/icons-material';
import { fetchEvidence, createClientToken } from '@/lib/api';
import { useCarbonStore } from '@/lib/store';
import { useQueueStore } from '@/lib/offlineQueue';
import { drainQueue, refreshFromServer, submitOrQueue } from '@/lib/useCorrectionSync';

const drawerWidth = 232;

type View = 'overview' | 'verify' | 'issuance';

export default function EvidenceWorkbench({ initialView }: { initialView: View }) {
  const [view] = useState<View>(initialView);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [recordFilter, setRecordFilter] = useState('全部');
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [correctionValue, setCorrectionValue] = useState('');
  const [correctionReason, setCorrectionReason] = useState('');
  // 同一修订动作只生成一次稳定提交标识，断网重试/重复点击均沿用。
  const [correctionToken, setCorrectionToken] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [correctionFeedback, setCorrectionFeedback] = useState<{ severity: AlertColor; text: string } | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ['carbon-api'], queryFn: fetchEvidence });
  const store = useCarbonStore();
  const queue = useQueueStore();
  const pendingByRecord = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of queue.queue) {
      map.set(item.recordId, (map.get(item.recordId) ?? 0) + 1);
    }
    return map;
  }, [queue.queue]);
  const selected = store.records.find((record) => record.id === store.selectedRecordId) ?? store.records[0];
  const visibleRecords = useMemo(() => recordFilter === '全部' ? store.records : store.records.filter((record) => record.status === recordFilter), [recordFilter, store.records]);
  const totalReduction = store.records.reduce((total, record) => total + record.activity * record.factor / (record.unit === 'kWh' ? 1000 : record.unit === 'L' ? 1000 : 1), 0);
  const openFindings = store.findings.filter((item) => item.status !== '已关闭');
  const allIssuanceChecked = Object.values(store.issuanceChecks).every(Boolean) && openFindings.length === 0;

  const openCorrection = () => {
    setCorrectionFeedback(null);
    setCorrectionValue(String(selected.activity));
    setCorrectionReason('');
    setCorrectionToken(createClientToken());
    setCorrectionOpen(true);
  };

  // 提交修订：携带上一版号与稳定提交标识。版本过期时展示服务端当前版本；断网则进入本地待提交队列。
  const submitCorrection = async () => {
    if (!correctionToken) return;
    setSubmitting(true);
    setCorrectionFeedback(null);
    const outcome = await submitOrQueue({
      recordId: selected.id,
      value: Number(correctionValue),
      reason: correctionReason.trim(),
      actor: '沈楠',
      baseVersion: selected.revision,
      clientToken: correctionToken
    });
    setSubmitting(false);
    if (outcome.kind === 'accepted') {
      setCorrectionOpen(false);
      setCorrectionReason('');
      setCorrectionToken('');
    } else if (outcome.kind === 'queued') {
      setCorrectionFeedback({ severity: 'warning', text: '当前处于离线状态，修订已保留在本地待提交队列，恢复网络后将按原提交标识自动补交，其他数据的提交不受影响。' });
    } else if (outcome.kind === 'conflict') {
      setCorrectionFeedback({ severity: 'error', text: `版本冲突：${outcome.message} 服务端当前值为 ${outcome.currentValue.toLocaleString()}（V${outcome.currentVersion}）。请刷新到最新版本后重新修订。` });
    } else {
      setCorrectionFeedback({ severity: 'error', text: `提交失败：${outcome.message}` });
    }
  };

  const nav = [
    { id: 'overview', label: '监测期总览', href: '/', icon: DashboardOutlined },
    { id: 'verify', label: '证据与抽样核验', href: '/verify', icon: FindInPageOutlined },
    { id: 'issuance', label: '签发准备', href: '/issuance', icon: AssessmentOutlined }
  ];

  const navDrawer = (
    <Box sx={{ width: drawerWidth, bgcolor: '#f8faf9', height: '100%' }}>
      <Box sx={{ p: 2.2, pt: 3 }}>
        <Typography variant="overline" color="text.secondary">当前项目</Typography>
        <Typography fontWeight={800} fontSize={13} mt={.5}>{data?.project.name ?? '临港工业园区能效提升项目'}</Typography>
        <Typography variant="caption" color="text.secondary">{data?.project.id ?? 'CN-ER-2026-041'}</Typography>
      </Box>
      <Divider />
      <List sx={{ px: 1, py: 1.2 }}>
        {nav.map(({ id, label, href, icon: Icon }) => (
          <ListItemButton key={id} component={Link} href={href} selected={view === id} sx={{ borderRadius: 1, mb: .4, '&.Mui-selected': { bgcolor: '#e4f1ec', color: '#12664f' } }}>
            <ListItemIcon sx={{ minWidth: 36, color: 'inherit' }}><Icon fontSize="small" /></ListItemIcon>
            <ListItemText primary={label} primaryTypographyProps={{ fontSize: 13, fontWeight: view === id ? 750 : 500 }} />
          </ListItemButton>
        ))}
      </List>
      <Box sx={{ p: 2, mt: 2 }}>
        <Box sx={{ p: 1.3, border: '1px solid', borderColor: 'divider', borderRadius: 1, bgcolor: 'white' }}>
          <Stack direction="row" alignItems="center" spacing={1} mb={1}><ScienceOutlined color="primary" fontSize="small" /><Typography fontSize={12} fontWeight={750}>核验状态</Typography></Stack>
          <LinearProgress variant="determinate" value={78} sx={{ height: 5, borderRadius: 2 }} />
          <Typography variant="caption" color="text.secondary" display="block" mt={1}>78% 证据已完成初审</Typography>
        </Box>
      </Box>
    </Box>
  );

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      <AppBar position="fixed" elevation={0} sx={{ zIndex: (theme) => theme.zIndex.drawer + 1, bgcolor: '#173a31', borderBottom: '1px solid rgba(255,255,255,.12)' }}>
        <Toolbar sx={{ minHeight: '62px !important', gap: 1.4 }}>
          <IconButton color="inherit" sx={{ display: { md: 'none' } }} onClick={() => setMobileOpen(true)}><MenuOutlined /></IconButton>
          <Box sx={{ width: 36, height: 36, borderRadius: 1, border: '1px solid #80b6a6', display: 'grid', placeItems: 'center' }}>
            <AccountTreeOutlined fontSize="small" />
          </Box>
          <Box>
            <Typography fontSize={15} fontWeight={800}>碳减排项目监测核验</Typography>
            <Typography fontSize={10} color="#a9c5bc">MRV Evidence & Issuance Readiness</Typography>
          </Box>
          <Box sx={{ flex: 1 }} />
          <Chip size="small" label={`${openFindings.length} 项发现开放`} sx={{ color: '#ffdda7', borderColor: '#a87935', bgcolor: 'rgba(255,255,255,.05)' }} variant="outlined" />
          <IconButton color="inherit"><NotificationsNoneOutlined /></IconButton>
          <Avatar sx={{ width: 30, height: 30, bgcolor: '#e1a45d', fontSize: 12 }}>沈</Avatar>
        </Toolbar>
      </AppBar>
      <Drawer variant="permanent" sx={{ width: drawerWidth, flexShrink: 0, display: { xs: 'none', md: 'block' }, '& .MuiDrawer-paper': { width: drawerWidth, pt: '62px', boxSizing: 'border-box', borderRightColor: '#dce4e0' } }}>{navDrawer}</Drawer>
      <Drawer variant="temporary" open={mobileOpen} onClose={() => setMobileOpen(false)} ModalProps={{ keepMounted: true }} sx={{ display: { xs: 'block', md: 'none' }, '& .MuiDrawer-paper': { width: drawerWidth, pt: '62px' } }}>{navDrawer}</Drawer>

      <Box component="main" sx={{ flexGrow: 1, minWidth: 0, bgcolor: '#f2f5f3', pt: '62px' }}>
        <Box sx={{ p: { xs: 1.5, md: 3 }, maxWidth: 1640, mx: 'auto' }}>
          <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" alignItems={{ xs: 'flex-start', md: 'center' }} spacing={2} mb={2.4}>
            <Box>
              <Typography variant="overline" color="text.secondary" fontWeight={750}>CN-ER-2026-041 / {data?.summary.period ?? '第三监测期'}</Typography>
              <Typography variant="h5" fontWeight={850} mt={.3}>{view === 'overview' ? '监测期总览' : view === 'verify' ? '证据与抽样核验' : '签发准备'}</Typography>
              <Typography variant="body2" color="text.secondary" mt={.5}>{view === 'overview' ? '汇总活动数据、排放因子、证据完整度和异常波动。' : view === 'verify' ? '逐项核对来源、单位、时间范围，并保留修订链。' : '关闭发现项并完成签发前完整性门禁。'}</Typography>
            </Box>
            <Stack direction="row" spacing={1}>
              <Button variant="outlined" startIcon={<CloudUploadOutlined />}>导入监测数据</Button>
              <Button variant="contained" startIcon={<TaskAltOutlined />} disabled={view !== 'issuance' || !allIssuanceChecked}>提交签发准备</Button>
            </Stack>
          </Stack>
          {isLoading && <LinearProgress />}

          {view === 'overview' && (
            <>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', lg: 'repeat(4, 1fr)' }, gap: 1.4, mb: 2 }}>
                {[
                  { label: '减排量', value: data?.summary.reduction.toLocaleString() ?? '18,426', unit: 'tCO₂e', note: '较上期 +6.4%' },
                  { label: '证据完整度', value: `${data?.summary.evidenceRate ?? 92}%`, unit: '', note: '5 份证据待补充' },
                  { label: '开放发现项', value: `${openFindings.length}`, unit: '项', note: '1 项阻塞签发' },
                  { label: '抽样任务', value: `${store.sampledIds.length} / 18`, unit: '', note: '完成率 67%' }
                ].map((item) => <Card elevation={0} variant="outlined" key={item.label}><CardContent sx={{ p: 1.8, '&:last-child': { pb: 1.8 } }}><Typography variant="caption" color="text.secondary">{item.label}</Typography><Stack direction="row" alignItems="baseline" spacing={.6} mt={.5}><Typography variant="h5" fontWeight={850}>{item.value}</Typography><Typography fontSize={12} color="text.secondary">{item.unit}</Typography></Stack><Typography fontSize={11} color="text.secondary" mt={.7}>{item.note}</Typography></CardContent></Card>)}
              </Box>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: 'minmax(0, 1.55fr) minmax(300px, .7fr)' }, gap: 1.5 }}>
                <Card elevation={0} variant="outlined">
                  <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ p: 1.6 }}>
                    <Box><Typography fontWeight={800} fontSize={14}>活动数据与计算链</Typography><Typography fontSize={11} color="text.secondary">选择记录查看公式、来源证据和修订版本</Typography></Box>
                    <Tabs value={recordFilter} onChange={(_, value) => setRecordFilter(value)} variant="scrollable"><Tab value="全部" label="全部" /><Tab value="待核验" label="待核验" /><Tab value="需补证" label="需补证" /><Tab value="已核验" label="已核验" /></Tabs>
                  </Stack>
                  <Divider />
                  <Box sx={{ overflowX: 'auto' }}>
                    <Box sx={{ minWidth: 840 }}>
                      <Box sx={{ display: 'grid', gridTemplateColumns: '1.7fr .9fr .8fr 1fr .7fr .7fr', gap: 1, px: 1.7, py: 1, bgcolor: '#f7f9f8', color: 'text.secondary', fontSize: 11, fontWeight: 750 }}>
                        <span>数据来源</span><span>活动数据</span><span>排放因子</span><span>时间范围</span><span>证据</span><span>状态</span>
                      </Box>
                      {visibleRecords.map((record) => (
                        <Box key={record.id} role="button" tabIndex={0} onClick={() => store.selectRecord(record.id)} sx={{ display: 'grid', gridTemplateColumns: '1.7fr .9fr .8fr 1fr .7fr .7fr', gap: 1, px: 1.7, py: 1.25, borderTop: '1px solid #e8ecea', cursor: 'pointer', bgcolor: selected.id === record.id ? '#eff7f3' : 'white', '&:hover': { bgcolor: '#f6faf8' } }}>
                          <Box><Typography fontSize={12.5} fontWeight={700}>{record.source}</Typography><Typography fontSize={10} color="text.secondary">{record.id} · {record.owner} · V{record.revision}</Typography></Box>
                          <Box><Typography fontSize={12}>{record.activity.toLocaleString()} {record.unit}</Typography><Typography fontSize={10} color={record.anomaly > 5 ? 'secondary.main' : 'text.secondary'}>异常 {record.anomaly > 0 ? '+' : ''}{record.anomaly}%</Typography></Box>
                          <Typography fontSize={12}>{record.factor} <small>{record.factorUnit}</small></Typography>
                          <Typography fontSize={11}>{record.timeRange}</Typography>
                          <Typography fontSize={12}>{record.evidenceCount} 项</Typography>
                          <Stack spacing={.4} alignItems="flex-start">
                            <Chip size="small" label={record.status} color={record.status === '已核验' ? 'success' : record.status === '需补证' ? 'warning' : 'default'} variant={record.status === '已核验' ? 'filled' : 'outlined'} />
                            {pendingByRecord.has(record.id) && <Chip size="small" icon={<WifiOffOutlined sx={{ fontSize: '11px !important' }} />} label="待补交" color="secondary" variant="outlined" sx={{ height: 18, fontSize: 9.5 }} />}
                          </Stack>
                        </Box>
                      ))}
                    </Box>
                  </Box>
                </Card>
                <Stack spacing={1.5}>
                  <Card elevation={0} variant="outlined"><CardContent>
                    <Stack direction="row" justifyContent="space-between" alignItems="center">
                      <Typography fontWeight={800} fontSize={14}>计算链展开</Typography>
                      <Stack direction="row" spacing={.6}>
                        <Chip size="small" label={`当前 V${selected.revision}`} color="primary" variant="outlined" />
                        {selected.revisions.some((entry) => entry.state === '复核中') && <Chip size="small" label="复核中" color="warning" variant="outlined" />}
                        {pendingByRecord.has(selected.id) && <Chip size="small" icon={<WifiOffOutlined />} label={`${pendingByRecord.get(selected.id)} 条待补交`} color="secondary" variant="outlined" />}
                      </Stack>
                    </Stack>
                    <Box sx={{ mt: 1.5, p: 1.3, bgcolor: '#f4f7f5', fontFamily: 'monospace', borderRadius: 1, fontSize: 11 }}>
                    <Box>活动数据 = {selected.activity.toLocaleString()} {selected.unit}</Box>
                    <Box mt={.6}>排放因子 = {selected.factor} {selected.factorUnit}</Box>
                    <Box mt={.6}>换算系数 = 0.001</Box>
                    <Divider sx={{ my: 1 }} />
                    <Box sx={{ color: '#14644f', fontWeight: 800 }}>减排量 = {(selected.activity * selected.factor / 1000).toFixed(2)} tCO₂e</Box>
                  </Box>
                  <Stack direction="row" spacing={1} mt={1.5}><Button size="small" variant="outlined" onClick={openCorrection}>修订数据</Button><Button size="small">查看证据</Button></Stack>
                  <Box mt={1.5}>
                    <Stack direction="row" alignItems="center" spacing={.6} mb={.8}><HistoryOutlined fontSize="small" color="action" /><Typography fontSize={11.5} fontWeight={750}>修订版本链（追加记录，不覆盖）</Typography></Stack>
                    {[...selected.revisions].reverse().map((entry) => (
                      <Stack key={entry.version} direction="row" spacing={1} alignItems="center" sx={{ py: .7, borderTop: '1px solid #edf0ef' }}>
                        <Chip size="small" label={`V${entry.version}`} color={entry.version === selected.revision ? 'primary' : 'default'} variant={entry.version === selected.revision ? 'filled' : 'outlined'} />
                        <Box sx={{ flex: 1, minWidth: 0 }}><Typography fontSize={11.5} fontWeight={700}>{entry.value.toLocaleString()} {selected.unit} · {entry.actor}</Typography><Typography fontSize={10} color="text.secondary" noWrap>{entry.reason}</Typography></Box>
                        <Chip size="small" label={entry.state} color={entry.state === '复核中' ? 'warning' : 'success'} variant="outlined" />
                      </Stack>
                    ))}
                  </Box>
                  </CardContent></Card>
                  <Card elevation={0} variant="outlined"><CardContent><Typography fontWeight={800} fontSize={14} mb={1.2}>核验发现项</Typography>{openFindings.slice(0, 3).map((finding) => <Box key={finding.id} sx={{ py: 1, borderTop: '1px solid #edf0ef' }}><Stack direction="row" spacing={1}><Alert severity={finding.status === '补证中' ? 'warning' : 'error'} sx={{ p: .2, '& .MuiAlert-icon': { mr: .3, fontSize: 17 } }} /><Box><Typography fontSize={12} fontWeight={700}>{finding.title}</Typography><Typography fontSize={10} color="text.secondary" mt={.3}>{finding.assignee} · {finding.due}</Typography></Box></Stack></Box>)}</CardContent></Card>
                </Stack>
              </Box>
            </>
          )}

          {view === 'verify' && (
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: 'minmax(0, 1fr) 340px' }, gap: 1.5 }}>
              <Card elevation={0} variant="outlined">
                <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ xs: 'stretch', sm: 'center' }} spacing={1} sx={{ p: 1.6 }}>
                  <Box><Typography fontWeight={800} fontSize={14}>证据矩阵与抽样任务</Typography><Typography fontSize={11} color="text.secondary">已抽取 {store.sampledIds.length} 条高价值记录</Typography></Box>
                  <Stack direction="row" spacing={1}><Button variant="outlined" onClick={() => useCarbonStore.setState((state) => ({ sampledIds: store.records.filter((item) => Math.abs(item.anomaly) > 5).map((item) => item.id) }))}>按异常抽样</Button><Button variant="contained" onClick={store.batchVerify}>批量核验</Button></Stack>
                </Stack><Divider />
                {store.records.map((record) => (
                  <Box key={record.id} sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '22px minmax(210px, 1.3fr) .8fr .8fr .8fr auto' }, alignItems: 'center', gap: 1.2, px: 1.6, py: 1.3, borderTop: '1px solid #edf0ef' }}>
                    <input type="checkbox" checked={store.sampledIds.includes(record.id)} onChange={() => store.toggleSample(record.id)} aria-label={`抽样 ${record.id}`} />
                    <Box><Typography fontSize={12.5} fontWeight={700}>{record.source}</Typography><Typography fontSize={10} color="text.secondary">{record.id} · 证据 {record.evidenceCount} 份</Typography></Box>
                    <Box><Typography variant="caption" color="text.secondary">来源</Typography><Typography fontSize={11}>原始计量记录</Typography></Box>
                    <Box><Typography variant="caption" color="text.secondary">单位</Typography><Typography fontSize={11}>{record.unit} / {record.factorUnit}</Typography></Box>
                    <Box><Typography variant="caption" color="text.secondary">时间范围</Typography><Typography fontSize={11}>{record.timeRange.includes('至') ? '已覆盖整期' : '待检查'}</Typography></Box>
                    <Stack direction="row" spacing={.7}><Button size="small" variant="outlined" onClick={() => store.startCorrection(record.id)}>复核</Button><Button size="small" variant="contained" disabled={record.status === '需补证'} onClick={() => store.verifyRecord(record.id)}>通过</Button></Stack>
                  </Box>
                ))}
              </Card>
              <Stack spacing={1.5}>
                {queue.queue.length > 0 && (
                  <Card elevation={0} variant="outlined" sx={{ borderColor: 'secondary.light' }}><CardContent>
                    <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1}>
                      <Stack direction="row" spacing={.8} alignItems="center"><WifiOffOutlined color="secondary" fontSize="small" /><Typography fontWeight={800} fontSize={13}>本地待提交 {queue.queue.length} 条</Typography></Stack>
                      <Button size="small" startIcon={<SyncOutlined />} onClick={() => drainQueue()}>立即补交</Button>
                    </Stack>
                    <Typography fontSize={10.5} color="text.secondary" mb={1}>恢复网络后按原提交标识自动补交；每条记录独立处理，互不阻塞。</Typography>
                    {queue.queue.map((item) => (
                      <Box key={item.clientToken} sx={{ borderTop: '1px solid #f0e7e0', py: .9 }}>
                        <Stack direction="row" justifyContent="space-between" alignItems="center">
                          <Typography fontSize={11.5} fontWeight={700}>{item.recordId} → V{item.baseVersion + 1} · {item.value.toLocaleString()}</Typography>
                          <Chip size="small" label={item.status} color={item.status === '版本冲突' ? 'error' : item.status === '提交中' ? 'info' : item.status === '失败' ? 'error' : 'warning'} variant="outlined" />
                        </Stack>
                        <Typography fontSize={10} color="text.secondary" noWrap title={item.reason}>{item.reason}</Typography>
                        {item.status === '版本冲突' && (
                          <Box mt={.6}>
                            <Alert severity="error" sx={{ py: 0, fontSize: 10.5 }}>服务端已是 V{item.conflictVersion}（当前值 {item.conflictValue?.toLocaleString()}），该版本过期。</Alert>
                            <Stack direction="row" spacing={.7} mt={.5}>
                              <Button size="small" onClick={() => { refreshFromServer().catch(() => undefined); }}>刷新并保留</Button>
                              <Button size="small" color="inherit" onClick={() => queue.remove(item.clientToken)}>放弃此提交</Button>
                            </Stack>
                          </Box>
                        )}
                        {item.status === '失败' && <Typography fontSize={10} color="error.main" mt={.3}>{item.lastError}</Typography>}
                      </Box>
                    ))}
                  </CardContent></Card>
                )}
                <Card elevation={0} variant="outlined"><CardContent><Typography fontWeight={800} fontSize={14} mb={1.3}>发现项闭环</Typography>{store.findings.map((finding) => <Box key={finding.id} sx={{ borderTop: '1px solid #edf0ef', py: 1.2 }}><Stack direction="row" justifyContent="space-between"><Typography fontSize={12} fontWeight={700}>{finding.title}</Typography><Chip size="small" label={finding.status} color={finding.status === '已关闭' ? 'success' : finding.status === '补证中' ? 'warning' : 'error'} /></Stack><Typography fontSize={10.5} color="text.secondary" mt={.5}>{finding.detail}</Typography><Stack direction="row" spacing={.7} mt={1}><Button size="small" disabled={finding.status === '已关闭'} onClick={() => store.requestEvidence(finding.id)}>发起补证</Button><Button size="small" disabled={finding.status === '已关闭'} onClick={() => store.closeFinding(finding.id)}>关闭</Button></Stack></Box>)}</CardContent></Card>
                <Alert severity="info">修订以追加版本链保存并携带上一版号与稳定提交标识：后提交覆盖不到先提交，版本过期返回 409；原标识重试只取第一次结果，断网修订恢复后自动补交。</Alert>
              </Stack>
            </Box>
          )}

          {view === 'issuance' && (
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1fr) 380px' }, gap: 1.5 }}>
              <Stack spacing={1.5}>
                {store.issuanceNotice && (
                  <Alert severity="warning" onClose={() => useCarbonStore.setState({ issuanceNotice: null })} sx={{ alignItems: 'center' }}>
                    <Typography fontSize={12.5} fontWeight={700}>签发确认已失效，需基于新版本重新确认并重算就绪度</Typography>
                    <Typography fontSize={11}>{store.issuanceNotice}</Typography>
                  </Alert>
                )}
              <Card elevation={0} variant="outlined">
                <CardContent>
                  <Typography fontWeight={800} fontSize={14}>签发前完整性检查</Typography>
                  <Typography fontSize={11} color="text.secondary" mb={1.5}>所有门禁项必须确认，开放发现项必须关闭。数据修订生效后，证据链、计算过程与修订追溯三项确认自动失效。</Typography>
                  {[
                    { id: 'evidence', title: '证据与计算链完整', detail: '活动数据、排放因子、来源证据与修订说明可追溯。' },
                    { id: 'calculation', title: '计算过程复核通过', detail: '单位和换算系数一致，关键公式由核验员确认。' },
                    { id: 'revisions', title: '历史修订未覆盖原始数据', detail: '所有数据均有版本号和修订原因。' },
                    { id: 'methodology', title: '方法学与监测计划匹配', detail: `项目采用 ${data?.project.methodology ?? 'CMS-052-V01'}。` }
                  ].map((item) => <Box key={item.id} component="label" sx={{ display: 'flex', gap: 1.3, alignItems: 'flex-start', borderTop: '1px solid #edf0ef', py: 1.5, cursor: 'pointer' }}><input type="checkbox" checked={store.issuanceChecks[item.id]} onChange={() => store.toggleIssuanceCheck(item.id)} /><Box><Typography fontSize={12.5} fontWeight={700}>{item.title}</Typography><Typography fontSize={10.5} color="text.secondary" mt={.4}>{item.detail}{['evidence', 'calculation', 'revisions'].includes(item.id) && !store.issuanceChecks[item.id] && '（数据修订后需重新确认）'}</Typography></Box></Box>)}
                </CardContent>
              </Card>
              </Stack>
              <Stack spacing={1.5}>
                <Card elevation={0} variant="outlined"><CardContent>
                  <Typography fontWeight={800} fontSize={14}>签发就绪度</Typography>
                  <Stack direction="row" alignItems="baseline" spacing={1} mt={1}><Typography variant="h4" fontWeight={850}>{Math.round(Object.values(store.issuanceChecks).filter(Boolean).length / 4 * 70 + (openFindings.length === 0 ? 30 : 0))}%</Typography><Typography fontSize={11} color="text.secondary">完成度</Typography></Stack>
                  <LinearProgress variant="determinate" value={Object.values(store.issuanceChecks).filter(Boolean).length / 4 * 100} sx={{ height: 7, borderRadius: 3, mt: 1 }} />
                  <Typography fontSize={11} color="text.secondary" mt={1.2}>还有 {openFindings.length} 个开放发现项；数据修订后就绪度按最新确认自动重算。</Typography>
                </CardContent></Card>
                <Card elevation={0} variant="outlined"><CardContent>
                  <Stack direction="row" justifyContent="space-between" alignItems="center">
                    <Typography fontWeight={800} fontSize={14}>版本与核验意见</Typography>
                    <Select size="small" value={selected.id} onChange={(event) => store.selectRecord(event.target.value)} sx={{ fontSize: 11, '.MuiSelect-select': { py: .4, px: 1 } }}>
                      {store.records.map((record) => <MenuItem key={record.id} value={record.id} sx={{ fontSize: 11 }}>{record.id} · V{record.revision}</MenuItem>)}
                    </Select>
                  </Stack>
                  {[...selected.revisions].reverse().map((entry) => (
                    <Stack key={entry.version} direction="row" spacing={1.2} sx={{ borderTop: '1px solid #edf0ef', py: 1.2 }}>
                      <Chip size="small" label={`V${entry.version}`} color={entry.version === selected.revision ? 'primary' : 'default'} variant={entry.state === '复核中' ? 'outlined' : 'filled'} />
                      <Box sx={{ minWidth: 0 }}>
                        <Typography fontSize={11.5} fontWeight={700}>{entry.actor} · <Box component="span" sx={{ color: entry.state === '复核中' ? 'warning.main' : 'success.main' }}>{entry.state}</Box></Typography>
                        <Typography fontSize={10.5} color="text.secondary">{entry.reason}</Typography>
                      </Box>
                    </Stack>
                  ))}
                </CardContent></Card>
                <Alert severity={allIssuanceChecked ? 'success' : 'warning'}>{allIssuanceChecked ? '全部门禁已完成，可提交签发准备。' : '关闭开放发现项并完成所有检查后可提交。'}</Alert>
              </Stack>
            </Box>
          )}
        </Box>
      </Box>

      <Tooltip title="核验记录会写入审计链"><Button sx={{ position: 'fixed', bottom: 18, right: 18, zIndex: 5 }} variant="contained" size="small" startIcon={<FactCheckOutlined />}>操作均留痕</Button></Tooltip>
      {correctionOpen && (
        <Box sx={{ position: 'fixed', inset: 0, zIndex: 60, bgcolor: 'rgba(15,25,22,.4)', display: 'grid', placeItems: 'center', p: 2 }} onMouseDown={() => !submitting && setCorrectionOpen(false)}>
          <Card sx={{ width: 'min(520px, 100%)' }} onMouseDown={(event) => event.stopPropagation()}><CardContent sx={{ p: 2.2 }}>
            <Typography variant="h6" fontWeight={800}>修订活动数据</Typography>
            <Typography variant="body2" color="text.secondary" mt={.5}>当前值 {selected.activity.toLocaleString()} {selected.unit}（V{selected.revision}）。本次提交将基于上一版号 V{selected.revision} 追加 V{selected.revision + 1}，原始版本保持不变；若期间他人已提交，将返回 409 并提示当前版本。</Typography>
            <TextField fullWidth size="small" label={`修订值 / ${selected.unit}`} value={correctionValue} onChange={(event) => setCorrectionValue(event.target.value)} margin="normal" />
            <TextField fullWidth size="small" label="修订原因" multiline rows={3} value={correctionReason} onChange={(event) => setCorrectionReason(event.target.value)} margin="normal" />
            <Typography fontSize={10} color="text.secondary" mt={.5} title={correctionToken}>提交标识：{correctionToken}（重试沿用同一标识，服务端只取第一次结果）</Typography>
            {!correctionReason.trim() && <Alert severity="warning" sx={{ mt: 1 }}>必须填写修订原因。</Alert>}
            {correctionFeedback && <Alert severity={correctionFeedback.severity} sx={{ mt: 1 }} action={correctionFeedback.severity === 'error' && correctionFeedback.text.startsWith('版本冲突') ? <Button color="inherit" size="small" onClick={() => refreshFromServer().then(() => setCorrectionFeedback(null)).catch(() => undefined)}>刷新当前版本</Button> : undefined}>{correctionFeedback.text}</Alert>}
            <Stack direction="row" spacing={1} justifyContent="flex-end" mt={2}>
              <Button disabled={submitting} onClick={() => setCorrectionOpen(false)}>取消</Button>
              <Button variant="contained" loading={submitting} disabled={!correctionReason.trim() || !Number(correctionValue)} onClick={submitCorrection}>提交新版本</Button>
            </Stack>
          </CardContent></Card>
        </Box>
      )}
    </Box>
  );
}
