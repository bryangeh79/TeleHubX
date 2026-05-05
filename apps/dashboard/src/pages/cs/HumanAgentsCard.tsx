import { useEffect, useState } from 'react';
import {
  Alert, Button, Card, Form, Input, Modal, Popconfirm, Space, Switch, Table, Tag,
  Typography, message as antdMessage,
} from 'antd';
import {
  DeleteOutlined, EditOutlined, ExperimentOutlined, PlusOutlined, ReloadOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import { tenantsApi } from '../../services/api';
import { useT } from '../../i18n';

const { Text } = Typography;

interface HumanAgent {
  chatId: string;
  name?: string;
  enabled: boolean;
}

interface Props {
  tenantId?: string;
}

export default function HumanAgentsCard({ tenantId }: Props) {
  const t = useT();
  const [agents, setAgents] = useState<HumanAgent[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<HumanAgent | null>(null);
  const [editingIdx, setEditingIdx] = useState<number>(-1);
  const [modalOpen, setModalOpen] = useState(false);
  const [testingChatId, setTestingChatId] = useState<string | null>(null);
  const [form] = Form.useForm<{ chatId: string; name?: string }>();

  const load = async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      const res = await tenantsApi.getSettings(tenantId);
      setAgents(Array.isArray(res.data?.humanAgents) ? res.data.humanAgents : []);
    } catch {
      antdMessage.error('加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [tenantId]);

  const persist = async (next: HumanAgent[]) => {
    if (!tenantId) return;
    setSaving(true);
    try {
      await tenantsApi.updateSettings(tenantId, { humanAgents: next });
      setAgents(next);
      antdMessage.success('已保存');
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const startCreate = () => {
    form.resetFields();
    setEditing(null);
    setEditingIdx(-1);
    setModalOpen(true);
  };

  const startEdit = (a: HumanAgent, idx: number) => {
    form.setFieldsValue({ chatId: a.chatId, name: a.name });
    setEditing(a);
    setEditingIdx(idx);
    setModalOpen(true);
  };

  const handleSubmit = async () => {
    let v: { chatId: string; name?: string };
    try { v = await form.validateFields(); } catch { return; }
    const chatId = v.chatId.trim();
    const name = v.name?.trim() || undefined;
    if (!/^-?\d+$/.test(chatId)) {
      antdMessage.warning('chatId 必须是纯数字（@userinfobot 给的那串）');
      return;
    }
    let next: HumanAgent[];
    if (editingIdx >= 0) {
      next = agents.map((x, i) => i === editingIdx ? { ...x, chatId, name } : x);
    } else {
      // 去重
      if (agents.some(a => a.chatId === chatId)) {
        antdMessage.warning('该 chatId 已在列表里');
        return;
      }
      next = [...agents, { chatId, name, enabled: true }];
    }
    await persist(next);
    setModalOpen(false);
  };

  const handleToggle = async (idx: number, enabled: boolean) => {
    const next = agents.map((x, i) => i === idx ? { ...x, enabled } : x);
    await persist(next);
  };

  const handleDelete = async (idx: number) => {
    const next = agents.filter((_, i) => i !== idx);
    await persist(next);
  };

  const handleTest = async (a: HumanAgent) => {
    if (!tenantId) return;
    setTestingChatId(a.chatId);
    try {
      const res = await tenantsApi.testNotifyAgent(tenantId, a.chatId, a.name);
      if (res.data?.ok) {
        antdMessage.success(res.data.message || '推送成功，请检查 Telegram');
      } else {
        antdMessage.error(res.data?.message || '推送失败');
      }
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? '推送失败');
    } finally {
      setTestingChatId(null);
    }
  };

  return (
    <Card
      title={<Space><TeamOutlined /> {t('cs.handoff')}</Space>}
      style={{ marginBottom: 16 }}
      extra={
        <Space>
          <Button icon={<ReloadOutlined />} size="small" onClick={() => void load()} loading={loading}>{t('common.refresh')}</Button>
          <Button type="primary" icon={<PlusOutlined />} size="small" onClick={startCreate} disabled={!tenantId}>
            {t('common.add')}
          </Button>
        </Space>
      }
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="客户触发『真人客服』『投诉』等关键字时 Bot 会怎么做？"
        description={
          <div style={{ fontSize: 13 }}>
            ① 立刻给客户回「已为你转接」话术（在 Admin → Prompt 配置 → 转接话术 编辑）<br />
            ② 同时把客户名/Telegram ID/最近 5 条对话推送给下面所有<strong>启用</strong>的 operator 的 Telegram<br />
            ③ Operator 在 Telegram 看到通知 → 点 <Text code>tg://user?id=...</Text> 直接跳到客户私聊窗口
          </div>
        }
      />

      <Alert
        type="warning"
        showIcon
        style={{ marginBottom: 16 }}
        message="⚠️ 重要前置：每位客服必须先在 Telegram 主动给 Bot 发一次 /start"
        description="否则 Telegram 不允许 Bot 反向推送消息（这是 TG 平台限制，所有 Bot 都一样）。配置后请用「测试」按钮验证。"
      />

      {agents.length === 0 ? (
        <div style={{ padding: '40px 16px', textAlign: 'center', color: '#999' }}>
          还没有配置人工客服。点右上角「+ 新增客服」开始添加（建议不超过 10 人）
        </div>
      ) : (
        <Table
          rowKey="chatId"
          loading={loading || saving}
          dataSource={agents}
          size="small"
          pagination={false}
          columns={[
            {
              title: t('common.name'),
              dataIndex: 'name',
              width: 160,
              render: (n: string) => n || <Text type="secondary">—</Text>,
            },
            {
              title: t('form.chatId'),
              dataIndex: 'chatId',
              render: (id: string) => <Text code copyable>{id}</Text>,
            },
            {
              title: t('common.enable'),
              dataIndex: 'enabled',
              width: 70,
              align: 'center' as const,
              render: (v: boolean, _r, idx) => (
                <Switch size="small" checked={v} onChange={c => handleToggle(idx, c)} disabled={saving} />
              ),
            },
            {
              title: t('common.actions'),
              width: 200,
              render: (_, r: HumanAgent, idx) => (
                <Space size={4}>
                  <Button size="small" icon={<ExperimentOutlined />} loading={testingChatId === r.chatId}
                    onClick={() => handleTest(r)}>
                    {t('common.test')}
                  </Button>
                  <Button size="small" type="text" icon={<EditOutlined />} onClick={() => startEdit(r, idx)} />
                  <Popconfirm title={`${t('common.delete')}「${r.name || r.chatId}」?`} onConfirm={() => handleDelete(idx)}
                    okText={t('common.delete')} cancelText={t('common.cancel')}>
                    <Button size="small" type="text" danger icon={<DeleteOutlined />} />
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
        />
      )}

      {agents.length >= 1 && (
        <div style={{ marginTop: 8, fontSize: 12, color: '#999' }}>
          共 {agents.length} 人 · 启用 {agents.filter(a => a.enabled).length} 人
          {agents.length >= 10 && <Tag color="orange" style={{ marginLeft: 8 }}>已超过建议人数</Tag>}
        </div>
      )}

      <Modal
        title={editing ? t('modal.humanAgent.edit') : t('modal.humanAgent.add')}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={handleSubmit}
        okText={t('common.save')}
        cancelText={t('common.cancel')}
        destroyOnClose
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item name="name" label={t('form.nameOptional')} rules={[{ max: 64, message: t('form.tooLong') }]}>
            <Input placeholder={t('form.placeholder.optional')} />
          </Form.Item>
          <Form.Item
            name="chatId"
            label={t('form.chatId')}
            rules={[{ required: true, message: t('form.required') }, { pattern: /^-?\d+$/, message: t('form.invalid') }]}
            extra={
              <span>
                让客服在 Telegram 搜 <Text code>@userinfobot</Text> 发 <Text code>/start</Text>，
                Bot 会回复一串数字 ID，复制粘贴到这里。
              </span>
            }
          >
            <Input placeholder="例如：123456789" />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
