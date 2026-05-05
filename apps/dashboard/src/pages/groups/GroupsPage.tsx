import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message as antdMessage,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  DeleteOutlined,
  EditOutlined,
  GlobalOutlined,
  HomeOutlined,
  LockOutlined,
  PlusOutlined,
  ReloadOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { testGroupsApi } from '../../services/api';
import { useT } from '../../i18n';

const { Title, Text, Paragraph } = Typography;

type Source = 'self_built' | 'external_owned' | 'external_public';
type Kind = 'small' | 'mega';

interface Group {
  id: string;
  source: Source;
  kind: Kind;
  tgChatId: string;
  title: string;
  username: string | null;
  ownerAccountId: string | null;
  memberCount: number;
  systemMemberAccountIds: string[] | null;
  enabled: boolean;
  notes: string | null;
  createdAt: string;
}

const SOURCE_META: Record<Source, { label: string; icon: React.ReactNode; color: string }> = {
  self_built:      { label: '自建', icon: <HomeOutlined />,   color: 'purple' },
  external_owned:  { label: '自有', icon: <LockOutlined />,   color: 'orange' },
  external_public: { label: '公开', icon: <GlobalOutlined />, color: 'cyan' },
};

export default function GroupsPage() {
  const t = useT();
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [form] = Form.useForm();

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await testGroupsApi.list();
      setGroups(Array.isArray(res.data) ? res.data : []);
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const handleCreate = async (values: any) => {
    try {
      await testGroupsApi.create({
        source: values.source,
        kind: values.kind ?? 'small',
        tgChatId: values.tgChatId,
        username: values.username || undefined,
        title: values.title,
        notes: values.notes,
      });
      antdMessage.success('已添加');
      setCreateOpen(false);
      form.resetFields();
      void reload();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? '创建失败');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await testGroupsApi.delete(id);
      void reload();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? '删除失败');
    }
  };

  const columns: ColumnsType<Group> = [
    {
      title: '来源', dataIndex: 'source', key: 'source', width: 80,
      render: (s: Source) => {
        const m = SOURCE_META[s];
        return <Tag color={m.color} icon={m.icon}>{m.label}</Tag>;
      },
    },
    {
      title: '群名称 / 标识', key: 'title',
      render: (_, r) => (
        <div>
          <Text strong>{r.title}</Text>
          {r.username && <div><Text code style={{ fontSize: 11 }}>@{r.username}</Text></div>}
          <div><Text type="secondary" style={{ fontSize: 11, fontFamily: 'monospace' }}>{r.tgChatId}</Text></div>
        </div>
      ),
    },
    {
      title: '类型', dataIndex: 'kind', key: 'kind', width: 80,
      render: (k: Kind) => <Tag>{k === 'mega' ? '超级群' : '普通群'}</Tag>,
    },
    {
      title: '系统成员', key: 'systemMembers', width: 100,
      render: (_, r) => (
        <Text>{(r.systemMemberAccountIds?.length ?? 0)} / {r.memberCount || '?'}</Text>
      ),
    },
    {
      title: '创建', dataIndex: 'createdAt', key: 'createdAt', width: 130,
      render: (v: string) => dayjs(v).format('MM-DD HH:mm'),
    },
    {
      title: '操作', key: 'ops', width: 80,
      render: (_, r) => (
        <Popconfirm title="移除此群（仅 dashboard 记录，不影响 TG）？" onConfirm={() => handleDelete(r.id)}>
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
            {t('nav.groups')}
          </Title>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => void reload()}>刷新</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>添加群</Button>
        </Space>
      </div>

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="三种来源"
        description={
          <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13 }}>
            <li><b>自建</b> — 系统通过 GROUP_CREATE 任务自动创建（slot 1 当群主，邀其他号入群）</li>
            <li><b>自有</b> — 你在 TG 自己建的群，邀我们某号当 admin 后录入此处</li>
            <li><b>公开</b> — 第三方公开群，仅作 BUBBLE/REACTION 的"陪跑"目标</li>
          </ul>
        }
      />

      <Card>
        <Table
          dataSource={groups}
          columns={columns}
          rowKey="id"
          size="small"
          loading={loading}
          pagination={{ pageSize: 20, showSizeChanger: false }}
          locale={{ emptyText: <Empty description="尚无群组" /> }}
        />
      </Card>

      <Modal
        title="添加群"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => form.submit()}
        destroyOnClose
        width={560}
      >
        <Form form={form} layout="vertical" onFinish={handleCreate} initialValues={{ source: 'external_owned', kind: 'small' }}>
          <Form.Item name="source" label="来源" rules={[{ required: true }]}>
            <Select
              options={[
                { value: 'self_built',      label: '🏗️ 自建（系统将创建）' },
                { value: 'external_owned',  label: '🔒 自有（你在 TG 已建好，我们的号已是 admin）' },
                { value: 'external_public', label: '🌐 公开（第三方公开群）' },
              ]}
            />
          </Form.Item>
          <Form.Item name="title" label="群名称" rules={[{ required: true }]}>
            <Input placeholder="老客户群-2026" />
          </Form.Item>
          <Form.Item name="tgChatId" label="TG chat_id" rules={[{ required: true }]}
            extra="在 TG 客户端 → 群信息 → 复制链接 后取数字部分；或先邀请我们某号进群，看 dashboard 日志">
            <Input placeholder="-1001234567890" />
          </Form.Item>
          <Form.Item name="username" label="用户名（公开群可填）">
            <Input placeholder="@forex_chat" />
          </Form.Item>
          <Form.Item name="kind" label="群类型">
            <Select
              options={[
                { value: 'small', label: '普通群（≤ 200 人）' },
                { value: 'mega',  label: '超级群（无限制）' },
              ]}
            />
          </Form.Item>
          <Form.Item name="notes" label="备注">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
