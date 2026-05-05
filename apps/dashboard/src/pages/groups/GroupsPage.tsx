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

function buildSourceMeta(t: (k: string) => string): Record<Source, { label: string; icon: React.ReactNode; color: string }> {
  return {
    self_built:      { label: t('grp.source.self_built'),      icon: <HomeOutlined />,   color: 'purple' },
    external_owned:  { label: t('grp.source.external_owned'),  icon: <LockOutlined />,   color: 'orange' },
    external_public: { label: t('grp.source.external_public'), icon: <GlobalOutlined />, color: 'cyan' },
  };
}

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
      antdMessage.error(err?.response?.data?.message ?? t('grp.loadFail'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { void reload(); }, [reload]);

  const SOURCE_META = buildSourceMeta(t);

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
      antdMessage.success(t('grp.addOk'));
      setCreateOpen(false);
      form.resetFields();
      void reload();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? t('grp.createFail'));
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await testGroupsApi.delete(id);
      void reload();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? t('grp.delFail'));
    }
  };

  const columns: ColumnsType<Group> = [
    {
      title: t('grp.col.source'), dataIndex: 'source', key: 'source', width: 80,
      render: (s: Source) => {
        const m = SOURCE_META[s];
        return <Tag color={m.color} icon={m.icon}>{m.label}</Tag>;
      },
    },
    {
      title: t('grp.col.title'), key: 'title',
      render: (_, r) => (
        <div>
          <Text strong>{r.title}</Text>
          {r.username && <div><Text code style={{ fontSize: 11 }}>@{r.username}</Text></div>}
          <div><Text type="secondary" style={{ fontSize: 11, fontFamily: 'monospace' }}>{r.tgChatId}</Text></div>
        </div>
      ),
    },
    {
      title: t('grp.col.kind'), dataIndex: 'kind', key: 'kind', width: 80,
      render: (k: Kind) => <Tag>{k === 'mega' ? t('grp.kind.mega') : t('grp.kind.small')}</Tag>,
    },
    {
      title: t('grp.col.systemMembers'), key: 'systemMembers', width: 100,
      render: (_, r) => (
        <Text>{(r.systemMemberAccountIds?.length ?? 0)} / {r.memberCount || '?'}</Text>
      ),
    },
    {
      title: t('grp.col.created'), dataIndex: 'createdAt', key: 'createdAt', width: 130,
      render: (v: string) => dayjs(v).format('MM-DD HH:mm'),
    },
    {
      title: t('grp.col.actions'), key: 'ops', width: 80,
      render: (_, r) => (
        <Popconfirm title={t('grp.delConfirm')} onConfirm={() => handleDelete(r.id)}>
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
          <Button icon={<ReloadOutlined />} onClick={() => void reload()}>{t('grp.btnRefresh')}</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>{t('grp.btnAdd')}</Button>
        </Space>
      </div>

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message={t('grp.alert.title')}
        description={
          <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13 }}>
            <li>{t('grp.alert.self')}</li>
            <li>{t('grp.alert.owned')}</li>
            <li>{t('grp.alert.public')}</li>
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
          locale={{ emptyText: <Empty description={t('grp.empty')} /> }}
        />
      </Card>

      <Modal
        title={t('grp.modal.title')}
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => form.submit()}
        destroyOnClose
        width={560}
      >
        <Form form={form} layout="vertical" onFinish={handleCreate} initialValues={{ source: 'external_owned', kind: 'small' }}>
          <Form.Item name="source" label={t('grp.modal.source')} rules={[{ required: true }]}>
            <Select
              options={[
                { value: 'self_built',      label: t('grp.modal.optSelf') },
                { value: 'external_owned',  label: t('grp.modal.optOwned') },
                { value: 'external_public', label: t('grp.modal.optPublic') },
              ]}
            />
          </Form.Item>
          <Form.Item name="title" label={t('grp.modal.title2')} rules={[{ required: true }]}>
            <Input placeholder={t('grp.modal.titlePlaceholder')} />
          </Form.Item>
          <Form.Item name="tgChatId" label="TG chat_id" rules={[{ required: true }]}
            extra={t('grp.modal.chatIdExtra')}>
            <Input placeholder="-1001234567890" />
          </Form.Item>
          <Form.Item name="username" label={t('grp.modal.username')}>
            <Input placeholder="@forex_chat" />
          </Form.Item>
          <Form.Item name="kind" label={t('grp.modal.kind')}>
            <Select
              options={[
                { value: 'small', label: t('grp.modal.kindSmall') },
                { value: 'mega',  label: t('grp.modal.kindMega') },
              ]}
            />
          </Form.Item>
          <Form.Item name="notes" label={t('grp.modal.notes')}>
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
