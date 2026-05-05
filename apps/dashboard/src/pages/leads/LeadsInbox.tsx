import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Avatar,
  Badge,
  Button,
  Dropdown,
  Empty,
  Input,
  List,
  Modal,
  Popconfirm,
  Progress,
  Select,
  Space,
  Tag,
  Tooltip,
  Typography,
  Upload,
  message as antdMessage,
} from 'antd';
import {
  CheckCircleOutlined,
  CustomerServiceOutlined,
  PaperClipOutlined,
  ReloadOutlined,
  RobotOutlined,
  SendOutlined,
  SmileOutlined,
  StopOutlined,
  UserOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { io, Socket } from 'socket.io-client';
import { leadsApi, takeoverApi } from '../../services/api';
import { useT } from '../../i18n';
import {
  isNotifySupported, notifyDesktop, notifyPermission, playSound,
  rememberDecline, requestNotificationPermission, userDeclinedPrompt,
} from '../../utils/notify';

const COMMON_EMOJIS = [
  '😀', '😂', '😍', '🥰', '😘', '😎', '🤔', '😮', '😢', '😭',
  '👍', '👎', '👏', '🙏', '💪', '🔥', '✨', '🎉', '❤️', '💯',
  '✅', '❌', '⚠️', '⏰', '📞', '📧', '💰', '🎁', '🚀', '👀',
];

const { Title, Text } = Typography;

type Intent = 'cold' | 'warm' | 'hot';
type LeadStatus = 'new' | 'assigned' | 'in_progress' | 'converted' | 'closed';
type TakeoverState = 'ai' | 'human' | 'closed' | 'dnr';
type Sender = 'user' | 'system' | 'human';

interface Reply {
  text: string;
  sentBy: Sender;
  ts: string;
}

interface Lead {
  id: string;
  tgUsername: string | null;
  tgUserId: string;
  tenantId: string | null;
  intent: Intent;
  status: LeadStatus;
  takeoverState: TakeoverState;
  takenOverBy: string;
  takenOverAt: string | null;
  needsHuman: boolean;
  notes: string[] | null;
  replies: Reply[] | null;
  product: string | null;
  budget: string | null;
  createdAt: string;
  updatedAt: string;
}

const INTENT_COLOR: Record<Intent, string> = { cold: 'default', warm: 'orange', hot: 'red' };
const TAKEOVER_LABEL: Record<TakeoverState, { label: string; color: string }> = {
  ai:     { label: 'AI 处理中', color: 'blue' },
  human:  { label: '人工接管', color: 'orange' },
  closed: { label: '已关闭',   color: 'default' },
  dnr:    { label: '永久屏蔽', color: 'red' },
};

const SF_PRO = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, sans-serif';

export default function LeadsInbox() {
  const t = useT();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [selected, setSelected] = useState<Lead | null>(null);
  const [filterIntent, setFilterIntent] = useState<Intent | undefined>();
  const [filterTakeover, setFilterTakeover] = useState<TakeoverState | undefined>();
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [socketConnected, setSocketConnected] = useState(false);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const textareaRef = useRef<any>(null);

  const socketRef = useRef<Socket | null>(null);
  const messageEndRef = useRef<HTMLDivElement>(null);

  // ── REST: load leads ─────────────────────────────────────────────────────
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (filterIntent) params.intent = filterIntent;
      const res = await leadsApi.list(params);
      const list: Lead[] = Array.isArray(res.data) ? res.data : [];
      setLeads(filterTakeover ? list.filter((l) => l.takeoverState === filterTakeover) : list);
      // Refresh selected
      if (selected) {
        const fresh = list.find((l) => l.id === selected.id);
        if (fresh) setSelected(fresh);
      }
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? '加载失败');
    } finally {
      setLoading(false);
    }
  }, [filterIntent, filterTakeover, selected?.id]);

  useEffect(() => { void reload(); }, [reload]);

  // Auto-scroll on new messages
  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [selected?.replies?.length]);

  // ── 桌面通知：检测 AI → HUMAN 转换 → 弹通知 + 响铃 ─────────────────────────
  const prevStatesRef = useRef<Map<string, TakeoverState>>(new Map());
  const [showNotifyBanner, setShowNotifyBanner] = useState(false);

  // 初始化通知 banner（仅在尚未授权且未拒绝过时）
  useEffect(() => {
    if (!isNotifySupported()) return;
    const perm = notifyPermission();
    if (perm === 'default' && !userDeclinedPrompt()) setShowNotifyBanner(true);
  }, []);

  // 监测 leads 变化，记录 prevStates 并检测 AI→HUMAN
  useEffect(() => {
    const prev = prevStatesRef.current;
    for (const lead of leads) {
      const prevState = prev.get(lead.id);
      if (prevState && prevState !== 'human' && lead.takeoverState === 'human') {
        const name = lead.tgUsername ? `@${lead.tgUsername}` : `id:${lead.tgUserId}`;
        const recent = (lead.replies ?? []).filter(r => r.sentBy === 'user').slice(-1)[0]?.text ?? '';
        notifyDesktop({
          title: `🚨 新人工接管请求 - ${name}`,
          body: recent ? recent.slice(0, 120) : '客户触发了转人工',
          tag: `handoff-${lead.id}`,
          onClick: () => setSelected(lead),
        });
        playSound();
      }
      prev.set(lead.id, lead.takeoverState);
    }
  }, [leads]);

  // ── WebSocket: realtime ──────────────────────────────────────────────────
  useEffect(() => {
    const sock = io({
      path: '/socket.io',
      transports: ['websocket'],
      auth: { token: localStorage.getItem('telehubx:token') ?? '' },
    });
    socketRef.current = sock;
    sock.on('connect', () => setSocketConnected(true));
    sock.on('disconnect', () => setSocketConnected(false));
    sock.on('lead-updated', () => { void reload(); });
    sock.on('message', (msg: { leadId: string; sender: Sender; text: string; ts: string }) => {
      setSelected((curr) => {
        if (!curr || curr.id !== msg.leadId) return curr;
        const newReply: Reply = { text: msg.text, sentBy: msg.sender, ts: msg.ts };
        const replies = [...(curr.replies ?? []), newReply];
        return { ...curr, replies };
      });
      // 也刷一下 leads 列表的预览
      setLeads((list) => list.map((l) =>
        l.id === msg.leadId
          ? { ...l, replies: [...(l.replies ?? []), { text: msg.text, sentBy: msg.sender, ts: msg.ts }], updatedAt: msg.ts }
          : l));
    });
    return () => {
      sock.disconnect();
      socketRef.current = null;
    };
  }, [reload]);

  // Subscribe to selected lead's room
  useEffect(() => {
    const sock = socketRef.current;
    if (!sock || !selected) return;
    sock.emit('subscribe', { leadId: selected.id });
    return () => {
      sock.emit('unsubscribe', { leadId: selected.id });
    };
  }, [selected?.id]);

  // ── Actions ──────────────────────────────────────────────────────────────
  const handleTakeover = async (lead: Lead) => {
    try {
      await leadsApi.takeOver(lead.id);
      antdMessage.success('已接管，AI 将停止回复，由你接管');
      void reload();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? '接管失败');
    }
  };

  const handleRelease = async (lead: Lead) => {
    try {
      await leadsApi.release(lead.id);
      antdMessage.success('已释放，AI 重新接管');
      void reload();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? '释放失败');
    }
  };

  const handleClose = async (lead: Lead) => {
    try {
      await leadsApi.setState(lead.id, 'closed');
      antdMessage.success('对话已关闭');
      void reload();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? '关闭失败');
    }
  };

  const insertEmoji = (e: string) => {
    setDraft((d) => d + e);
    setEmojiOpen(false);
    // Refocus textarea
    setTimeout(() => textareaRef.current?.focus(), 0);
  };

  const handleUpload = async (file: File) => {
    if (!selected) return;
    if (selected.takeoverState !== 'human') {
      antdMessage.warning('请先点「接管」再上传文件');
      return;
    }
    setUploadPct(0);
    try {
      const res = await takeoverApi.upload(selected.id, file, (p) => setUploadPct(p));
      if (res.data?.ok) {
        antdMessage.success(`已发送 ${file.name}`);
      } else {
        antdMessage.error(`发送失败: ${res.data?.description ?? 'unknown'}`);
      }
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? '上传失败');
    } finally {
      setUploadPct(null);
    }
  };

  const handleSend = async () => {
    if (!selected || !draft.trim()) return;
    if (selected.takeoverState !== 'human') {
      Modal.warning({
        title: '请先接管',
        content: '该对话目前由 AI 处理。点击右上角「接管」按钮后才能由人工回复。',
        okText: '知道了',
      });
      return;
    }
    const sock = socketRef.current;
    if (!sock || !sock.connected) {
      antdMessage.error('WebSocket 未连接，请刷新页面');
      return;
    }
    setSending(true);
    sock.emit(
      'reply',
      { leadId: selected.id, text: draft.trim() },
      (res: { ok: boolean; error?: string }) => {
        setSending(false);
        if (res?.ok) {
          setDraft('');
        } else {
          antdMessage.error(res?.error ?? '发送失败');
        }
      },
    );
  };

  // ── Helpers ──────────────────────────────────────────────────────────────
  const lastMessagePreview = (l: Lead): { text: string; ts: string | null; sender: Sender | null } => {
    const last = l.replies?.[l.replies.length - 1];
    if (!last) return { text: '尚无消息', ts: null, sender: null };
    return { text: last.text, ts: last.ts, sender: last.sentBy };
  };

  const fmtTime = (iso: string | null) => {
    if (!iso) return '';
    const d = dayjs(iso);
    const diffMin = dayjs().diff(d, 'minute');
    if (diffMin < 1) return '刚刚';
    if (diffMin < 60) return `${diffMin}m`;
    const diffHr = dayjs().diff(d, 'hour');
    if (diffHr < 24) return `${diffHr}h`;
    return d.format('MM-DD');
  };

  const sortedLeads = useMemo(() => {
    return [...leads].sort((a, b) => {
      // Pin 'human' takeover state to top
      if (a.takeoverState === 'human' && b.takeoverState !== 'human') return -1;
      if (b.takeoverState === 'human' && a.takeoverState !== 'human') return 1;
      const ta = dayjs(a.replies?.[a.replies.length - 1]?.ts ?? a.updatedAt);
      const tb = dayjs(b.replies?.[b.replies.length - 1]?.ts ?? b.updatedAt);
      return tb.valueOf() - ta.valueOf();
    });
  }, [leads]);

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 160px)', minHeight: 480, gap: 8 }}>
      {showNotifyBanner && (
        <div style={{
          padding: '8px 16px', background: '#e6f7ff', border: '1px solid #91d5ff', borderRadius: 6,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13,
        }}>
          <span>🔔 启用桌面通知 → 新人工接管请求实时提醒（即使你不在 leads 页也能听到铃声）</span>
          <Space size={4}>
            <Button size="small" type="primary" onClick={async () => {
              const r = await requestNotificationPermission();
              setShowNotifyBanner(false);
              if (r === 'granted') antdMessage.success('已启用桌面通知');
              else if (r === 'denied') antdMessage.warning('已拒绝。如需启用请去浏览器设置打开通知权限');
            }}>启用</Button>
            <Button size="small" type="text" onClick={() => { setShowNotifyBanner(false); rememberDecline(); }}>
              不再提醒
            </Button>
          </Space>
        </div>
      )}
      <div style={{ display: 'flex', flex: 1, gap: 16, minHeight: 0 }}>
      {/* LEFT: lead list */}
      <div style={{ width: 340, borderRight: '1px solid #f0f0f0', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '0 8px 12px', borderBottom: '1px solid #f5f5f5' }}>
          <Title level={5} style={{ margin: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span><CustomerServiceOutlined /> {t('lead.handoff.title')} <Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>({leads.length})</Text></span>
            <Tooltip title={socketConnected ? 'WebSocket 已连接' : 'WebSocket 未连接'}>
              <Badge status={socketConnected ? 'processing' : 'error'} />
            </Tooltip>
          </Title>
          <Space style={{ marginTop: 8 }} size={4}>
            <Select
              size="small"
              placeholder={t('lead.intent')}
              allowClear
              style={{ width: 80 }}
              value={filterIntent}
              onChange={setFilterIntent}
              options={[
                { value: 'cold', label: '冷' },
                { value: 'warm', label: '温' },
                { value: 'hot', label: '热' },
              ]}
            />
            <Select
              size="small"
              placeholder={t('cs.handoff')}
              allowClear
              style={{ width: 96 }}
              value={filterTakeover}
              onChange={setFilterTakeover}
              options={[
                { value: 'ai', label: 'AI' },
                { value: 'human', label: '人工' },
                { value: 'closed', label: '关闭' },
                { value: 'dnr', label: '屏蔽' },
              ]}
            />
            <Button size="small" icon={<ReloadOutlined />} onClick={() => void reload()} loading={loading} />
          </Space>
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {sortedLeads.length === 0 ? (
            <Empty description="尚无线索" style={{ marginTop: 60 }} />
          ) : (
            <List
              dataSource={sortedLeads}
              renderItem={(l) => {
                const preview = lastMessagePreview(l);
                const active = selected?.id === l.id;
                const meta = TAKEOVER_LABEL[l.takeoverState];
                return (
                  <div
                    onClick={() => setSelected(l)}
                    style={{
                      padding: '10px 12px',
                      cursor: 'pointer',
                      background: active ? '#e6f4ff' : undefined,
                      borderLeft: active ? '3px solid #1677ff' : '3px solid transparent',
                      borderBottom: '1px solid #f5f5f5',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Avatar size={32} style={{ backgroundColor: '#229ED9', flexShrink: 0 }}>
                        {(l.tgUsername || l.tgUserId).slice(0, 2).toUpperCase()}
                      </Avatar>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 4 }}>
                          <Text strong style={{ fontSize: 13, fontFamily: SF_PRO, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {l.tgUsername ? `@${l.tgUsername}` : l.tgUserId}
                          </Text>
                          <Text type="secondary" style={{ fontSize: 10, flexShrink: 0 }}>{fmtTime(preview.ts)}</Text>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 4, marginTop: 2 }}>
                          <Text type="secondary" style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {preview.sender === 'user' ? '' : preview.sender === 'system' ? '🤖 ' : preview.sender === 'human' ? '👤 ' : ''}
                            {preview.text}
                          </Text>
                          <Tag color={meta.color} style={{ fontSize: 10, padding: '0 4px', lineHeight: '14px', margin: 0, flexShrink: 0 }}>
                            {meta.label}
                          </Tag>
                        </div>
                      </div>
                    </div>
                    {l.intent !== 'cold' && (
                      <Tag color={INTENT_COLOR[l.intent]} style={{ fontSize: 10, marginTop: 4 }}>
                        {l.intent.toUpperCase()}
                      </Tag>
                    )}
                  </div>
                );
              }}
            />
          )}
        </div>
      </div>

      {/* RIGHT: chat panel */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {!selected ? (
          <Empty description="选择左侧线索开始对话" style={{ margin: 'auto' }} />
        ) : (
          <>
            <div style={{ padding: '8px 16px', borderBottom: '1px solid #f0f0f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Space>
                <Avatar size={36} style={{ backgroundColor: '#229ED9' }}>
                  {(selected.tgUsername || selected.tgUserId).slice(0, 2).toUpperCase()}
                </Avatar>
                <div>
                  <div style={{ fontFamily: SF_PRO, fontWeight: 600 }}>
                    {selected.tgUsername ? `@${selected.tgUsername}` : selected.tgUserId}
                  </div>
                  <Space size={6}>
                    <Tag color={TAKEOVER_LABEL[selected.takeoverState].color} style={{ margin: 0, fontSize: 11 }}>
                      {TAKEOVER_LABEL[selected.takeoverState].label}
                    </Tag>
                    <Tag color={INTENT_COLOR[selected.intent]} style={{ margin: 0, fontSize: 11 }}>{selected.intent}</Tag>
                    {selected.tenantId && <Text type="secondary" style={{ fontSize: 11 }}>tenant {selected.tenantId.slice(0, 8)}</Text>}
                  </Space>
                </div>
              </Space>
              <Space>
                {selected.takeoverState === 'ai' && (
                  <Button type="primary" icon={<UserOutlined />} onClick={() => handleTakeover(selected)}>
                    接管
                  </Button>
                )}
                {selected.takeoverState === 'human' && (
                  <Popconfirm
                    title="释放给 AI？"
                    description="释放后 AI 会重新自动回复客户。如果你的人工沟通还没完成，建议保持接管状态。"
                    onConfirm={() => handleRelease(selected)}
                  >
                    <Button icon={<RobotOutlined />}>释放给 AI</Button>
                  </Popconfirm>
                )}
                {selected.takeoverState !== 'closed' && (
                  <Popconfirm title="关闭此对话？" onConfirm={() => handleClose(selected)}>
                    <Button danger icon={<StopOutlined />}>关闭</Button>
                  </Popconfirm>
                )}
              </Space>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px', background: '#fafafa' }}>
              {(selected.replies ?? []).length === 0 ? (
                <Empty description="对话暂无消息" style={{ marginTop: 40 }} />
              ) : (
                (selected.replies ?? []).map((r, i) => {
                  const isUser = r.sentBy === 'user';
                  return (
                    <div
                      key={i}
                      style={{
                        display: 'flex',
                        justifyContent: isUser ? 'flex-start' : 'flex-end',
                        marginBottom: 8,
                      }}
                    >
                      <div style={{ maxWidth: '70%' }}>
                        <div
                          style={{
                            padding: '8px 12px',
                            borderRadius: isUser ? '4px 12px 12px 12px' : '12px 4px 12px 12px',
                            background: isUser ? '#fff' : (r.sentBy === 'human' ? '#1677ff' : '#52c41a'),
                            color: isUser ? '#000' : '#fff',
                            fontSize: 14,
                            border: isUser ? '1px solid #f0f0f0' : 'none',
                            wordBreak: 'break-word',
                            whiteSpace: 'pre-wrap',
                          }}
                        >
                          {r.text}
                        </div>
                        <div style={{ fontSize: 10, color: '#999', marginTop: 2, textAlign: isUser ? 'left' : 'right' }}>
                          {r.sentBy === 'user' ? '客户' : r.sentBy === 'human' ? '👤 你' : '🤖 AI'}
                          {' · '}
                          {dayjs(r.ts).format('HH:mm:ss')}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={messageEndRef} />
            </div>

            <div style={{ padding: 12, borderTop: '1px solid #f0f0f0', background: '#fff' }}>
              {selected.takeoverState !== 'human' ? (
                <div style={{ textAlign: 'center', color: '#999', padding: 12 }}>
                  <CheckCircleOutlined style={{ marginRight: 6 }} />
                  此对话由 {selected.takeoverState === 'ai' ? 'AI' : '系统'} 处理。点击右上角「接管」由你回复。
                </div>
              ) : (
                <div>
                  {uploadPct !== null && (
                    <Progress percent={uploadPct} size="small" style={{ marginBottom: 8 }} />
                  )}
                  <div style={{ display: 'flex', gap: 4, alignItems: 'flex-end' }}>
                    {/* Emoji picker */}
                    <Dropdown
                      open={emojiOpen}
                      onOpenChange={setEmojiOpen}
                      trigger={['click']}
                      placement="topLeft"
                      dropdownRender={() => (
                        <div style={{
                          background: '#fff',
                          border: '1px solid #f0f0f0',
                          borderRadius: 8,
                          padding: 8,
                          boxShadow: '0 6px 16px rgba(0,0,0,0.08)',
                          width: 280,
                        }}>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(10, 1fr)', gap: 4 }}>
                            {COMMON_EMOJIS.map((e) => (
                              <button
                                key={e}
                                type="button"
                                onClick={() => insertEmoji(e)}
                                style={{
                                  fontSize: 18,
                                  border: 'none',
                                  background: 'transparent',
                                  cursor: 'pointer',
                                  padding: 4,
                                  borderRadius: 4,
                                }}
                                onMouseEnter={(ev) => { (ev.currentTarget as HTMLButtonElement).style.background = '#f0f0f0'; }}
                                onMouseLeave={(ev) => { (ev.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
                              >{e}</button>
                            ))}
                          </div>
                          <Typography.Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 6 }}>
                            提示：操作系统自带 emoji 键盘也可用 (Win+. / Cmd+Ctrl+Space)
                          </Typography.Text>
                        </div>
                      )}
                    >
                      <Button type="text" icon={<SmileOutlined />} disabled={sending} />
                    </Dropdown>

                    {/* File upload */}
                    <Upload
                      showUploadList={false}
                      beforeUpload={(file) => {
                        void handleUpload(file as File);
                        return false; // 阻止默认上传，我们自己控制
                      }}
                      accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.zip,.rar"
                      disabled={sending || uploadPct !== null}
                    >
                      <Tooltip title="发送图片 / 视频 / 文件">
                        <Button type="text" icon={<PaperClipOutlined />} disabled={sending || uploadPct !== null} />
                      </Tooltip>
                    </Upload>

                    <Input.TextArea
                      ref={textareaRef}
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      placeholder={t('lead.replyPlaceholder')}
                      autoSize={{ minRows: 1, maxRows: 4 }}
                      onPressEnter={(e) => {
                        if (!e.shiftKey) {
                          e.preventDefault();
                          void handleSend();
                        }
                      }}
                      disabled={sending}
                      style={{ flex: 1 }}
                    />
                    <Button type="primary" icon={<SendOutlined />} onClick={handleSend} loading={sending}>
                      发送
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
      </div>
    </div>
  );
}
