import { useCallback, useEffect, useState } from 'react';
import {
  Alert, Button, Card, Col, Form, Input, Modal, Popconfirm,
  Row, Select, Space, Switch, Table, Tag, Typography, message as antdMessage,
} from 'antd';
import {
  CheckCircleOutlined, CloseCircleOutlined, KeyOutlined,
  PlusOutlined, ReloadOutlined, SaveOutlined,
} from '@ant-design/icons';
import { platformConfigApi } from '../../services/api';

const { Text } = Typography;

const PROVIDER_LABELS: Record<string, string> = {
  openai: 'OpenAI', deepseek: 'DeepSeek', gemini: 'Google Gemini',
};
const PROVIDER_COLORS: Record<string, string> = {
  openai: 'blue', deepseek: 'purple', gemini: 'orange',
};

/**
 * 平台 AI Providers 管理 — SUPER_ADMIN 专属。
 *
 * 用途：广告变体生成 / 开场白评分 / FAQ 生成等平台内部任务的兜底 Key，
 * 费用由平台承担，配置后立即生效无需重启。
 *
 * 从 AiSettingsPage 抽出（原 686-738 + Modal），让租户的 /settings/ai
 * 不再混杂 admin-only 控件。
 */
export default function PlatformAiProvidersTab() {
  const [providers, setProviders] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await platformConfigApi.listAiProviders();
      setProviders(Array.isArray(res.data) ? res.data : []);
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const handleDelete = async (id: string) => {
    try {
      await platformConfigApi.deleteAiProvider(id);
      antdMessage.success('已删除');
      void reload();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? '删除失败');
    }
  };

  const columns = [
    {
      title: '类型',
      dataIndex: 'provider',
      width: 110,
      render: (p: string) => (
        <Tag color={PROVIDER_COLORS[p] ?? 'default'}>{PROVIDER_LABELS[p] ?? p}</Tag>
      ),
    },
    {
      title: '名称 / 模型',
      render: (_: any, row: any) => (
        <Space>
          <Text>{row.name ?? row.provider}</Text>
          {row.model && <Tag style={{ fontSize: 11 }}>{row.model}</Tag>}
          {row.isDefault && <Tag color="blue" style={{ fontSize: 10 }}>默认</Tag>}
        </Space>
      ),
    },
    {
      title: 'Base URL',
      dataIndex: 'baseUrl',
      render: (v: string) => v
        ? <Text code style={{ fontSize: 11 }}>{v}</Text>
        : <Text type="secondary" style={{ fontSize: 11 }}>默认</Text>,
    },
    {
      title: 'API Key',
      width: 90,
      render: () => <Text type="secondary" style={{ fontSize: 11 }}>••••••••</Text>,
    },
    {
      title: '最近测试',
      width: 110,
      render: (_: any, row: any) => {
        if (!row.lastTestedAt) return <Text type="secondary" style={{ fontSize: 11 }}>未测试</Text>;
        return row.lastTestStatus === 'ok'
          ? <Tag color="success" icon={<CheckCircleOutlined />}>✓ OK</Tag>
          : <Tag color="error" icon={<CloseCircleOutlined />}>失败</Tag>;
      },
    },
    {
      title: '启用',
      dataIndex: 'isActive',
      width: 70,
      render: (v: boolean, row: any) => (
        <Switch
          size="small"
          checked={v}
          style={{ background: v ? '#52c41a' : undefined }}
          onChange={async checked => {
            await platformConfigApi.updateAiProvider(row.id, { isActive: checked });
            void reload();
          }}
        />
      ),
    },
    {
      title: '操作',
      width: 130,
      render: (_: any, row: any) => (
        <Space size={4}>
          <Button size="small" onClick={() => { setEditing(row); setModalOpen(true); }}>编辑</Button>
          <Popconfirm title="确认删除？" onConfirm={() => handleDelete(row.id)} okText="删除" cancelText="取消" okButtonProps={{ danger: true }}>
            <Button size="small" danger>删</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <Card
      title={
        <Space>
          <KeyOutlined />
          <span>平台 AI Providers ({providers.length})</span>
        </Space>
      }
      extra={
        <Space>
          <Button icon={<ReloadOutlined />} size="small" onClick={() => void reload()} loading={loading}>刷新</Button>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            size="small"
            onClick={() => { setEditing(null); setModalOpen(true); }}
          >
            新增
          </Button>
        </Space>
      }
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="平台兜底 Key — 广告变体生成 / 开场白评分 / FAQ 生成等内部任务用，费用由平台承担。配置后无需重启服务，立即生效。"
      />
      {providers.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '24px 0', color: '#999' }}>
          <div style={{ fontSize: 24, marginBottom: 8 }}>🔑</div>
          <div>还没有配置平台 API Key</div>
          <Button
            type="primary"
            style={{ marginTop: 12 }}
            onClick={() => { setEditing(null); setModalOpen(true); }}
          >
            立即添加
          </Button>
        </div>
      ) : (
        <Table
          dataSource={providers}
          columns={columns}
          rowKey="id"
          size="small"
          pagination={false}
          loading={loading}
        />
      )}

      <PlatformProviderModal
        open={modalOpen}
        editRecord={editing}
        onClose={() => { setModalOpen(false); setEditing(null); }}
        onSuccess={() => { setModalOpen(false); setEditing(null); void reload(); }}
      />
    </Card>
  );
}

// ── 平台 AI Provider Modal ──────────────────────────────────────────────
function PlatformProviderModal({
  open, editRecord, onClose, onSuccess,
}: {
  open: boolean;
  editRecord?: any;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const isEdit = !!editRecord;
  const testableId = editRecord?.id ?? savedId;

  useEffect(() => {
    if (!open) { form.resetFields(); setTestResult(null); setSavedId(null); return; }
    if (editRecord) {
      form.setFieldsValue({
        provider: editRecord.provider,
        name: editRecord.name,
        model: editRecord.model,
        baseUrl: editRecord.baseUrl,
        isDefault: editRecord.isDefault,
        apiKey: '',
      });
    } else {
      form.setFieldsValue({ provider: 'deepseek', isDefault: true });
    }
  }, [open, editRecord, form]);

  const handleSave = async () => {
    let values: any;
    try { values = await form.validateFields(); } catch { return; }
    setSaving(true);
    try {
      const payload: any = {
        provider: values.provider,
        name: values.name || values.provider,
        model: values.model || undefined,
        baseUrl: values.baseUrl || undefined,
        isDefault: values.isDefault ?? true,
      };
      if (values.apiKey?.trim()) payload.apiKey = values.apiKey.trim();
      if (isEdit) {
        await platformConfigApi.updateAiProvider(editRecord.id, payload);
        antdMessage.success('已更新，可点「测试连接」验证');
        onSuccess();
      } else {
        if (!payload.apiKey) { antdMessage.error('首次添加必须填写 API Key'); setSaving(false); return; }
        const res = await platformConfigApi.createAiProvider(payload);
        setSavedId(res.data?.id ?? null);
        antdMessage.success('已保存，点「测试连接」验证是否正常');
        onSuccess();
      }
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (!testableId) { antdMessage.warning('请先保存后再测试'); return; }
    setTesting(true);
    setTestResult(null);
    try {
      const res = await platformConfigApi.testAiProvider(testableId);
      setTestResult({ ok: res.data.ok, msg: res.data.message });
    } catch (err: any) {
      setTestResult({ ok: false, msg: err?.response?.data?.message ?? '测试失败' });
    } finally {
      setTesting(false);
    }
  };

  return (
    <Modal
      open={open}
      title={isEdit ? '编辑平台 AI Provider' : '新增平台 AI Provider'}
      onCancel={onClose}
      width={560}
      footer={
        <Space style={{ justifyContent: 'flex-end', width: '100%' }}>
          <Button loading={testing} onClick={handleTest} disabled={!testableId}>
            {testableId ? '测试连接' : '保存后可测试'}
          </Button>
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" loading={saving} onClick={handleSave} icon={<SaveOutlined />}>保存</Button>
        </Space>
      }
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="平台兜底 Key — 用于广告变体生成、开场白评分等内部 AI 任务，费用由平台承担。"
      />
      <Form form={form} layout="vertical">
        <Row gutter={12}>
          <Col span={12}>
            <Form.Item name="provider" label="提供商" rules={[{ required: true }]}>
              <Select options={[
                { value: 'openai',   label: 'OpenAI' },
                { value: 'deepseek', label: 'DeepSeek' },
                { value: 'gemini',   label: 'Google Gemini' },
                { value: 'custom',   label: '自定义 (OpenAI 兼容)' },
              ]} />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="name" label="名称 (备注)">
              <Input placeholder="例: DeepSeek 主力 Key" />
            </Form.Item>
          </Col>
        </Row>
        <Form.Item
          name="apiKey"
          label="API Key"
          extra={isEdit ? '留空则保留现有 Key（不会显示明文）' : '必填'}
          rules={isEdit ? [] : [{ required: true, message: '必填' }]}
        >
          <Input.Password placeholder={isEdit ? '••••••••（保留现有）' : 'sk-...'} autoComplete="off" />
        </Form.Item>
        <Row gutter={12}>
          <Col span={12}>
            <Form.Item name="model" label="模型 (可选)">
              <Input placeholder="deepseek-chat / gpt-4o-mini" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="baseUrl" label="Base URL (自定义时填)">
              <Input placeholder="https://api.deepseek.com/v1" />
            </Form.Item>
          </Col>
        </Row>
        <Form.Item name="isDefault" valuePropName="checked" label="设为默认平台 Key"
          extra="打开后，广告变体生成 / 开场白评分等内部任务会优先使用这个 Key">
          <Switch />
        </Form.Item>
      </Form>
      {testResult && (
        <Alert
          type={testResult.ok ? 'success' : 'error'}
          showIcon
          message={testResult.msg}
          style={{ marginTop: 8 }}
        />
      )}
    </Modal>
  );
}
