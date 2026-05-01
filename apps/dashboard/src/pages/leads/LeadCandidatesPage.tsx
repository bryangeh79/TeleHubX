import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
  message as antdMessage,
} from 'antd';
import {
  DeleteOutlined,
  ExportOutlined,
  ReloadOutlined,
  SendOutlined,
  TeamOutlined,
  UserAddOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { leadCandidatesApi, tasksApi } from '../../services/api';

const { Title, Text } = Typography;

interface Candidate {
  id: string;
  tenantId: string;
  tgUserId: string;
  tgUsername: string | null;
  firstName: string | null;
  lastName: string | null;
  sourceGroupId: string | null;
  sourceGroupTitle: string | null;
  phone: string | null;
  lastSeenAt: string | null;
  isPremium: boolean;
  isBot: boolean;
  scrapedByAccountId: string | null;
  huntTaskId: string | null;
  scrapedAt: string;
  priorityScore: number;
  status: 'pending' | 'contacted' | 'replied' | 'converted' | 'blocked' | 'expired';
  contactedAt: string | null;
  contactedByAccountId: string | null;
  notes: string | null;
}

const STATUS_META: Record<string, { label: string; color: string }> = {
  pending:   { label: '未联系', color: 'default' },
  contacted: { label: '已联系', color: 'processing' },
  replied:   { label: '已回复', color: 'cyan' },
  converted: { label: '已转 Lead', color: 'success' },
  blocked:   { label: '黑名单', color: 'error' },
  expired:   { label: '已过期', color: 'warning' },
};

const TENANT_KEY = 'telehubx:tenantId';

export default function LeadCandidatesPage() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [stats, setStats] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string | undefined>();
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [contactOpen, setContactOpen] = useState(false);
  const [contactForm] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);

  // 默认 tenant：先从 localStorage 取，若无则用 default
  const tenantId = useMemo(
    () => localStorage.getItem(TENANT_KEY) ?? 'default',
    [],
  );

  // 支持 URL ?huntTaskId=xxx 跳转过滤 (从任务详情 Modal 跳过来)
  const huntTaskId = useMemo(() => {
    if (typeof window === 'undefined') return undefined;
    return new URL(window.location.href).searchParams.get('huntTaskId') ?? undefined;
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = { tenantId, status: filterStatus };
      if (huntTaskId) params.huntTaskId = huntTaskId;
      const [listRes, statsRes] = await Promise.all([
        leadCandidatesApi.list(params),
        leadCandidatesApi.stats(tenantId),
      ]);
      let arr = Array.isArray(listRes.data) ? listRes.data : [];
      if (huntTaskId) arr = arr.filter((c: any) => c.huntTaskId === huntTaskId);
      setCandidates(arr);
      setStats(statsRes.data ?? {});
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? '加载候选池失败');
    } finally {
      setLoading(false);
    }
  }, [tenantId, filterStatus, huntTaskId]);

  useEffect(() => { void reload(); }, [reload]);

  const handleDelete = async (id: string) => {
    try {
      await leadCandidatesApi.remove(id);
      antdMessage.success('已删除');
      void reload();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? '删除失败');
    }
  };

  const handleBatchContact = async () => {
    contactForm.resetFields();
    setContactOpen(true);
  };

  const submitContactTask = async (values: any) => {
    const selected = candidates.filter((c) => selectedRowKeys.includes(c.id));
    if (!selected.length) {
      antdMessage.warning('请先选择候选人');
      return;
    }
    setSubmitting(true);
    try {
      const targets = selected
        .filter((c) => c.tgUsername)
        .map((c) => ({
          candidateId: c.id,
          username: c.tgUsername,
          firstName: c.firstName,
          lastName: c.lastName,
        }));
      if (!targets.length) {
        antdMessage.error('选中的候选人都没有 username — 暂不支持纯 phone 模式批量');
        setSubmitting(false);
        return;
      }
      await tasksApi.create({
        name: values.taskName,
        type: values.mode === 'campaign' ? 'campaign_single' : 'contact_add',
        accountId: values.accountId,
        scheduledAt: new Date().toISOString(),
        payload:
          values.mode === 'campaign'
            ? {
                targets,
                variants: values.variants.split('\n').map((s: string) => s.trim()).filter(Boolean),
                intervalSec: [60, 300],
              }
            : {
                mode: 'username',
                targets,
                maxPerDay: targets.length,
                greetingText: values.greetingText,
              },
      } as any);
      antdMessage.success(`已派发任务（${targets.length} 个候选人）`);
      setContactOpen(false);
      setSelectedRowKeys([]);
      void reload();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? '派发失败');
    } finally {
      setSubmitting(false);
    }
  };

  const exportCsv = () => {
    const header = [
      'tgUserId', 'tgUsername', 'firstName', 'lastName',
      'phone', 'lastSeenAt', 'isPremium',
      'sourceGroupId', 'sourceGroupTitle',
      'priorityScore', 'status', 'scrapedAt', 'huntTaskId',
    ];
    const esc = (v: any) => {
      if (v == null) return '';
      const s = String(v);
      return s.includes(',') || s.includes('"') || s.includes('\n')
        ? `"${s.replace(/"/g, '""')}"`
        : s;
    };
    const rows = candidates.map((c) => [
      c.tgUserId, c.tgUsername, c.firstName, c.lastName,
      c.phone, c.lastSeenAt, c.isPremium ? '是' : '',
      c.sourceGroupId, c.sourceGroupTitle,
      c.priorityScore, c.status, c.scrapedAt, c.huntTaskId,
    ].map(esc).join(','));
    const csv = '﻿' + [header.join(','), ...rows].join('\n'); // UTF-8 BOM 防 Excel 乱码
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lead-candidates-${dayjs().format('YYYYMMDD-HHmm')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const columns: ColumnsType<Candidate> = [
    {
      title: 'TG 用户', key: 'tg', width: 240,
      render: (_, c) => (
        <div>
          <Space size={4}>
            <Text strong>
              {c.firstName ?? ''} {c.lastName ?? ''}
              {!c.firstName && !c.lastName && <Text type="secondary">(无名)</Text>}
            </Text>
            {c.isPremium && <Tag color="gold" style={{ fontSize: 10 }}>⭐ Premium</Tag>}
          </Space>
          <br />
          <Text type="secondary" style={{ fontSize: 11 }}>
            {c.tgUsername ? `@${c.tgUsername}` : `id:${c.tgUserId}`}
            {c.phone && <span style={{ marginLeft: 6 }}>📞 {c.phone}</span>}
          </Text>
        </div>
      ),
    },
    {
      title: '来源群', key: 'source', width: 200,
      render: (_, c) => (
        c.sourceGroupTitle || c.sourceGroupId ? (
          <div>
            <Text style={{ fontSize: 12 }}>{c.sourceGroupTitle ?? '(未知群名)'}</Text>
            <br />
            <Text type="secondary" style={{ fontSize: 10 }}>{c.sourceGroupId?.slice(0, 18)}</Text>
          </div>
        ) : <Text type="secondary">—</Text>
      ),
    },
    {
      title: '最后在线', dataIndex: 'lastSeenAt', key: 'lastSeenAt', width: 110,
      render: (t: string | null) => t
        ? <Text style={{ fontSize: 11 }}>{dayjs(t).format('MM-DD HH:mm')}</Text>
        : <Text type="secondary" style={{ fontSize: 11 }}>未知</Text>,
    },
    {
      title: '优先级', dataIndex: 'priorityScore', key: 'priorityScore', width: 90,
      sorter: (a, b) => a.priorityScore - b.priorityScore,
      render: (s: number) => <Tag color={s >= 70 ? 'green' : s >= 50 ? 'blue' : 'default'}>{s}</Tag>,
    },
    {
      title: '状态', dataIndex: 'status', key: 'status', width: 110,
      render: (s: string) => {
        const m = STATUS_META[s] ?? { label: s, color: 'default' };
        return <Tag color={m.color as any}>{m.label}</Tag>;
      },
    },
    {
      title: '爬取时间', dataIndex: 'scrapedAt', key: 'scrapedAt', width: 140,
      render: (t: string) => <Text style={{ fontSize: 12 }}>{dayjs(t).format('MM-DD HH:mm')}</Text>,
    },
    {
      title: '操作', key: 'ops', width: 120,
      render: (_, c) => (
        <Popconfirm title="确认删除此候选人？" onConfirm={() => handleDelete(c.id)}>
          <Button size="small" danger icon={<DeleteOutlined />} />
        </Popconfirm>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>
            <TeamOutlined style={{ marginRight: 8 }} />
            候选人池
          </Title>
          <Text type="secondary">由 group_scrape 爬取或导入；勾选后批量派发 contact_add / campaign_single 任务</Text>
        </div>
        <Space>
          <Button icon={<ExportOutlined />} onClick={exportCsv}>导出 CSV</Button>
          <Button icon={<ReloadOutlined />} onClick={() => void reload()}>刷新</Button>
        </Space>
      </div>

      {huntTaskId && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message={`仅显示来自任务 #${huntTaskId.slice(0, 8)} 的候选人 (${candidates.length} 人)`}
          action={
            <Button size="small" onClick={() => { window.location.href = '/lead-candidates'; }}>
              查看全部
            </Button>
          }
        />
      )}

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}><Card size="small"><Statistic title="总候选人" value={stats.total ?? 0} /></Card></Col>
        <Col span={6}><Card size="small"><Statistic title="未联系" value={stats.pending ?? 0} valueStyle={{ color: '#666' }} /></Card></Col>
        <Col span={6}><Card size="small"><Statistic title="已联系" value={stats.contacted ?? 0} valueStyle={{ color: '#1677ff' }} /></Card></Col>
        <Col span={6}><Card size="small"><Statistic title="已转 Lead" value={stats.converted ?? 0} valueStyle={{ color: '#52c41a' }} /></Card></Col>
      </Row>

      <Card>
        <Space style={{ marginBottom: 12 }}>
          <Select
            value={filterStatus}
            onChange={(v) => setFilterStatus(v)}
            allowClear
            placeholder="全部状态"
            style={{ width: 140 }}
            options={Object.entries(STATUS_META).map(([k, m]) => ({ value: k, label: m.label }))}
          />
          <Button
            type="primary"
            icon={<SendOutlined />}
            disabled={selectedRowKeys.length === 0}
            onClick={handleBatchContact}
          >
            批量派发 ({selectedRowKeys.length})
          </Button>
        </Space>

        <Table
          rowSelection={{
            selectedRowKeys,
            onChange: (keys) => setSelectedRowKeys(keys),
            getCheckboxProps: (c) => ({ disabled: c.status !== 'pending' }),
          }}
          dataSource={candidates}
          columns={columns}
          rowKey="id"
          size="small"
          loading={loading}
          pagination={{ pageSize: 30, showSizeChanger: false }}
          locale={{ emptyText: <Empty description="尚无候选人 — 创建 group_scrape 任务来爬取群成员" /> }}
        />
      </Card>

      <Modal
        title={
          <Space>
            <UserAddOutlined />
            <span>批量派发触达任务（{selectedRowKeys.length} 个候选人）</span>
          </Space>
        }
        open={contactOpen}
        onCancel={() => setContactOpen(false)}
        onOk={() => contactForm.submit()}
        confirmLoading={submitting}
        destroyOnClose
        width={580}
      >
        <Form form={contactForm} layout="vertical" onFinish={submitContactTask} initialValues={{ mode: 'contact', taskName: `批量触达 ${dayjs().format('MM-DD HH:mm')}` }}>
          <Form.Item name="taskName" label="任务名称" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="mode" label="触达方式" rules={[{ required: true }]}>
            <Select
              options={[
                { value: 'contact', label: 'contact_add — 加联系人 + 可选开场白' },
                { value: 'campaign', label: 'campaign_single — 直接发消息（含变体轮换）' },
              ]}
            />
          </Form.Item>
          <Form.Item name="accountId" label="执行账号 (UUID)" rules={[{ required: true, message: '请填写执行账号 id' }]}>
            <Input placeholder="到「账号」页复制账号 UUID" />
          </Form.Item>
          <Form.Item shouldUpdate={(p, c) => p.mode !== c.mode}>
            {({ getFieldValue }) =>
              getFieldValue('mode') === 'campaign' ? (
                <Form.Item name="variants" label="文案变体（每行一条，至少 3 条）" rules={[{ required: true }]}>
                  <Input.TextArea rows={5} placeholder={'你好，刚看到你的资料 …\nHi，对你之前提到的 X 很感兴趣 …\n请问你方便聊一下 Y 吗？'} />
                </Form.Item>
              ) : (
                <Form.Item name="greetingText" label="加完后立即发送（可选）">
                  <Input.TextArea rows={3} placeholder="加完联系人后立即发送的开场白；留空则只加好友不发消息" />
                </Form.Item>
              )
            }
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
