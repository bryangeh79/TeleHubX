import { useEffect, useState, useCallback, useRef } from 'react';
import {
  Row,
  Col,
  List,
  Card,
  Tag,
  Badge,
  Input,
  Button,
  Select,
  Space,
  Typography,
  Avatar,
  Divider,
  message as antdMessage,
  Empty,
  Modal,
  Form,
  Popconfirm,
  Tooltip,
} from 'antd';
import {
  UserOutlined,
  SendOutlined,
  ReloadOutlined,
  DeleteOutlined,
  TeamOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { leadsApi, slotsApi } from '../../services/api';

const { Title, Text } = Typography;
const { TextArea } = Input;

type Intent = 'cold' | 'warm' | 'hot';
type LeadStatus = 'new' | 'assigned' | 'in_progress' | 'converted' | 'closed';

interface ApiLead {
  id: string;
  tgUsername: string | null;
  tgUserId: string;
  campaignId: string | null;
  product: string | null;
  budget: string | null;
  intent: Intent;
  status: LeadStatus;
  assignedCsAccountId: string | null;
  needsHuman: boolean;
  notes: string[] | null;
  replies: Array<{ text: string; sentBy: 'system' | 'human'; ts: string }> | null;
  createdAt: string;
  updatedAt: string;
}

interface CsOption {
  id: string;
  phoneNumber: string;
  no: number;
  role: string;
}

const INTENT_COLOR: Record<Intent, string> = {
  cold: 'blue',
  warm: 'orange',
  hot:  'red',
};

const STATUS_BADGE: Record<LeadStatus, 'success' | 'default' | 'processing' | 'warning' | 'error'> = {
  new:         'processing',
  assigned:    'success',
  in_progress: 'warning',
  converted:   'success',
  closed:      'default',
};

export default function LeadsInbox() {
  const [leads, setLeads] = useState<ApiLead[]>([]);
  const [csAccounts, setCsAccounts] = useState<CsOption[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [intentFilter, setIntentFilter] = useState<Intent | undefined>();
  const [statusFilter, setStatusFilter] = useState<LeadStatus | undefined>();
  const [needsHumanFilter, setNeedsHumanFilter] = useState<boolean | undefined>();
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [noteOpen, setNoteOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [createForm] = Form.useForm<{ tgUserId: string; tgUsername?: string; intent?: Intent; product?: string; budget?: string }>();
  const bottomRef = useRef<HTMLDivElement>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (statusFilter) params.status = statusFilter;
      if (intentFilter) params.intent = intentFilter;
      if (needsHumanFilter !== undefined) params.needsHuman = String(needsHumanFilter);
      const res = await leadsApi.list(params);
      const list: ApiLead[] = Array.isArray(res.data) ? res.data : [];
      setLeads(list);
      // keep selection if still in list, else pick first
      if (selectedId && list.some(l => l.id === selectedId)) {
        // ok
      } else if (list.length) {
        setSelectedId(list[0].id);
      } else {
        setSelectedId(null);
      }
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? 'Failed to load leads');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, intentFilter, needsHumanFilter, selectedId]);

  // Load CS accounts (for assign dropdown) once
  useEffect(() => {
    void (async () => {
      try {
        const res = await slotsApi.list();
        const slots = Array.isArray(res.data) ? res.data : [];
        const cs = slots
          .filter((s: any) => s.account && (s.account.role === 'cs' || s.account.role === 'hybrid'))
          .map((s: any) => ({
            id: s.account.id,
            phoneNumber: s.account.phoneNumber,
            no: s.no,
            role: s.account.role,
          }));
        setCsAccounts(cs);
      } catch {
        setCsAccounts([]);
      }
    })();
  }, []);

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, intentFilter, needsHumanFilter]);

  const selected = leads.find(l => l.id === selectedId) ?? null;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [selected?.replies?.length]);

  const handleSend = async () => {
    if (!replyText.trim() || !selected) return;
    setSending(true);
    try {
      await leadsApi.reply(selected.id, replyText.trim());
      setReplyText('');
      antdMessage.success('Reply recorded (data-layer audit only — Telegram dispatch lands in agent worker)');
      await reload();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? 'Reply failed');
    } finally {
      setSending(false);
    }
  };

  const handleAssign = async (csId: string) => {
    if (!selected) return;
    try {
      await leadsApi.assign(selected.id, csId);
      antdMessage.success('Lead assigned');
      await reload();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? 'Assign failed');
    }
  };

  const handleAddNote = async () => {
    if (!selected || !noteText.trim()) return;
    try {
      await leadsApi.addNote(selected.id, noteText.trim());
      antdMessage.success('Note added');
      setNoteText('');
      setNoteOpen(false);
      await reload();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? 'Add note failed');
    }
  };

  const handleDelete = async (lead: ApiLead) => {
    try {
      await leadsApi.delete(lead.id);
      antdMessage.success('Lead deleted');
      await reload();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? 'Delete failed');
    }
  };

  const handleCreate = async () => {
    try {
      const values = await createForm.validateFields();
      await leadsApi.create({
        tgUserId: values.tgUserId,
        tgUsername: values.tgUsername || undefined,
        intent: values.intent,
        product: values.product || undefined,
        budget: values.budget || undefined,
      });
      antdMessage.success('Lead created');
      setNewOpen(false);
      createForm.resetFields();
      await reload();
    } catch (err: any) {
      const msg = err?.response?.data?.message;
      if (msg) antdMessage.error(Array.isArray(msg) ? msg.join('; ') : msg);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>
          Leads Inbox{' '}
          <Text type="secondary" style={{ fontSize: 13, fontWeight: 400 }}>({leads.length})</Text>
        </Title>
        <Space>
          <Select
            placeholder="Intent"
            allowClear
            style={{ width: 110 }}
            value={intentFilter}
            onChange={v => setIntentFilter(v)}
            options={[
              { value: 'cold', label: 'Cold' },
              { value: 'warm', label: 'Warm' },
              { value: 'hot',  label: 'Hot' },
            ]}
          />
          <Select
            placeholder="Status"
            allowClear
            style={{ width: 130 }}
            value={statusFilter}
            onChange={v => setStatusFilter(v)}
            options={[
              { value: 'new',         label: 'New' },
              { value: 'assigned',    label: 'Assigned' },
              { value: 'in_progress', label: 'In progress' },
              { value: 'converted',   label: 'Converted' },
              { value: 'closed',      label: 'Closed' },
            ]}
          />
          <Select
            placeholder="Needs human"
            allowClear
            style={{ width: 130 }}
            value={needsHumanFilter}
            onChange={v => setNeedsHumanFilter(v)}
            options={[
              { value: true,  label: 'Yes' },
              { value: false, label: 'No' },
            ]}
          />
          <Button icon={<ReloadOutlined />} onClick={() => void reload()} loading={loading}>
            Refresh
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setNewOpen(true)}>
            New Lead
          </Button>
        </Space>
      </div>

      <Row gutter={16} style={{ height: 'calc(100vh - 220px)', minHeight: 500 }}>
        <Col span={9} style={{ height: '100%', overflowY: 'auto', borderRight: '1px solid #f0f0f0' }}>
          <List
            dataSource={leads}
            loading={loading}
            locale={{ emptyText: <Empty description="No leads yet" /> }}
            renderItem={lead => (
              <List.Item
                key={lead.id}
                onClick={() => setSelectedId(lead.id)}
                style={{
                  cursor: 'pointer',
                  padding: '12px 16px',
                  background: selectedId === lead.id ? '#e6f4ff' : 'transparent',
                  borderRadius: 6,
                  marginBottom: 4,
                }}
              >
                <List.Item.Meta
                  avatar={<Avatar icon={<UserOutlined />} />}
                  title={
                    <Space size={4}>
                      <Text strong style={{ fontSize: 13 }}>
                        {lead.tgUsername ? `@${lead.tgUsername}` : lead.tgUserId}
                      </Text>
                      <Tag color={INTENT_COLOR[lead.intent]} style={{ fontSize: 10, padding: '0 4px' }}>
                        {lead.intent}
                      </Tag>
                      {lead.needsHuman && <Tag color="red" style={{ fontSize: 10 }}>需人工</Tag>}
                      <Badge status={STATUS_BADGE[lead.status]} />
                    </Space>
                  }
                  description={
                    <div>
                      {lead.product && (
                        <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>
                          {lead.product}{lead.budget ? ` · ${lead.budget}` : ''}
                        </Text>
                      )}
                      <Text type="secondary" style={{ fontSize: 10, display: 'block' }}>
                        {dayjs(lead.updatedAt).format('MM-DD HH:mm')}
                      </Text>
                    </div>
                  }
                />
              </List.Item>
            )}
          />
        </Col>

        <Col span={15} style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          {selected ? (
            <>
              <div style={{ padding: '8px 16px', borderBottom: '1px solid #f0f0f0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <Space wrap>
                    <Text strong>{selected.tgUsername ? `@${selected.tgUsername}` : selected.tgUserId}</Text>
                    <Tag color={INTENT_COLOR[selected.intent]}>{selected.intent}</Tag>
                    <Badge status={STATUS_BADGE[selected.status]} text={selected.status} />
                    {selected.needsHuman && <Tag color="red">needs human</Tag>}
                  </Space>
                  <Space>
                    <Tooltip title="Assign to a CS account">
                      <Select
                        size="small"
                        placeholder={<><TeamOutlined /> Assign</>}
                        style={{ width: 200 }}
                        value={selected.assignedCsAccountId ?? undefined}
                        onChange={(v) => v && handleAssign(v)}
                        options={csAccounts.map(c => ({
                          value: c.id,
                          label: `No.${String(c.no).padStart(2, '0')} · ${c.phoneNumber} (${c.role})`,
                        }))}
                        notFoundContent={csAccounts.length ? null : 'No cs/hybrid accounts'}
                      />
                    </Tooltip>
                    <Button size="small" onClick={() => setNoteOpen(true)}>
                      + Note
                    </Button>
                    <Popconfirm
                      title="Delete this lead?"
                      onConfirm={() => handleDelete(selected)}
                      okButtonProps={{ danger: true }}
                    >
                      <Button size="small" danger icon={<DeleteOutlined />} />
                    </Popconfirm>
                  </Space>
                </div>
                <div style={{ fontSize: 11, color: '#8c8c8c' }}>
                  TG ID: <Text code style={{ fontSize: 10 }}>{selected.tgUserId}</Text>
                  {selected.product ? ` · Product: ${selected.product}` : ''}
                  {selected.budget ? ` · Budget: ${selected.budget}` : ''}
                  {selected.assignedCsAccountId ? ` · Assigned to: ${selected.assignedCsAccountId.slice(0, 8)}...` : ''}
                </div>
              </div>

              <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                {selected.notes && selected.notes.length > 0 && (
                  <Card size="small" title="Notes" style={{ background: '#fafafa' }}>
                    {selected.notes.map((n, i) => (
                      <div key={i} style={{ fontSize: 12, marginBottom: 4 }}>• {n}</div>
                    ))}
                  </Card>
                )}

                {(selected.replies && selected.replies.length > 0) ? (
                  selected.replies.map((msg, i) => (
                    <div
                      key={i}
                      style={{ display: 'flex', justifyContent: 'flex-end' }}
                    >
                      <div
                        style={{
                          maxWidth: '70%',
                          padding: '8px 12px',
                          borderRadius: '12px 12px 2px 12px',
                          background: msg.sentBy === 'human' ? '#1677ff' : '#52c41a',
                          color: '#fff',
                        }}
                      >
                        <div style={{ fontSize: 13 }}>{msg.text}</div>
                        <div style={{ fontSize: 10, marginTop: 4, opacity: 0.7, textAlign: 'right' }}>
                          {msg.sentBy} · {dayjs(msg.ts).format('MM-DD HH:mm')}
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description="No replies yet — send the first one below"
                    style={{ marginTop: 40 }}
                  />
                )}
                <div ref={bottomRef} />
              </div>

              <Divider style={{ margin: 0 }} />
              <div style={{ padding: '12px 16px', display: 'flex', gap: 8 }}>
                <TextArea
                  value={replyText}
                  onChange={e => setReplyText(e.target.value)}
                  placeholder="Type a reply... (data-layer audit only for now)"
                  autoSize={{ minRows: 2, maxRows: 5 }}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleSend();
                  }}
                  style={{ flex: 1 }}
                />
                <Button
                  type="primary"
                  icon={<SendOutlined />}
                  loading={sending}
                  onClick={handleSend}
                  disabled={!replyText.trim()}
                  style={{ alignSelf: 'flex-end' }}
                >
                  Send
                </Button>
              </div>
            </>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
              <Empty description="Select a lead to view conversation" />
            </div>
          )}
        </Col>
      </Row>

      <Modal
        title="Add note"
        open={noteOpen}
        onCancel={() => setNoteOpen(false)}
        onOk={handleAddNote}
        okText="Add"
      >
        <TextArea
          rows={4}
          value={noteText}
          onChange={(e) => setNoteText(e.target.value)}
          placeholder="Internal note about this lead"
        />
      </Modal>

      <Modal
        title="Create lead manually"
        open={newOpen}
        onCancel={() => setNewOpen(false)}
        onOk={handleCreate}
        okText="Create"
        destroyOnHidden
      >
        <Form form={createForm} layout="vertical">
          <Form.Item
            name="tgUserId"
            label="Telegram User ID"
            rules={[{ required: true, message: 'Required' }]}
          >
            <Input placeholder="numeric TG user id" />
          </Form.Item>
          <Form.Item name="tgUsername" label="Username">
            <Input placeholder="without @" />
          </Form.Item>
          <Form.Item name="intent" label="Intent">
            <Select
              options={[
                { value: 'cold', label: 'Cold' },
                { value: 'warm', label: 'Warm' },
                { value: 'hot',  label: 'Hot' },
              ]}
              placeholder="default cold"
            />
          </Form.Item>
          <Form.Item name="product" label="Product">
            <Input placeholder="What product they're interested in" />
          </Form.Item>
          <Form.Item name="budget" label="Budget">
            <Input placeholder="e.g. 500-1000 USD" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
