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
import { useT } from '../../i18n';

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
  const t = useT();
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
      antdMessage.error(err?.response?.data?.message ?? t('msg.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { void reload(); }, [reload]);

  const handleDelete = async (id: string) => {
    try {
      await platformConfigApi.deleteAiProvider(id);
      antdMessage.success(t('plat.ai.delOk'));
      void reload();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? t('plat.ai.delFail'));
    }
  };

  const columns = [
    {
      title: t('plat.ai.col.type'),
      dataIndex: 'provider',
      width: 110,
      render: (p: string) => (
        <Tag color={PROVIDER_COLORS[p] ?? 'default'}>{PROVIDER_LABELS[p] ?? p}</Tag>
      ),
    },
    {
      title: t('plat.ai.col.nameModel'),
      render: (_: any, row: any) => (
        <Space>
          <Text>{row.name ?? row.provider}</Text>
          {row.model && <Tag style={{ fontSize: 11 }}>{row.model}</Tag>}
          {row.isDefault && <Tag color="blue" style={{ fontSize: 10 }}>{t('plat.ai.tag.default')}</Tag>}
        </Space>
      ),
    },
    {
      title: t('plat.ai.col.baseUrl'),
      dataIndex: 'baseUrl',
      render: (v: string) => v
        ? <Text code style={{ fontSize: 11 }}>{v}</Text>
        : <Text type="secondary" style={{ fontSize: 11 }}>{t('plat.ai.tag.default')}</Text>,
    },
    {
      title: t('plat.ai.col.apiKey'),
      width: 90,
      render: () => <Text type="secondary" style={{ fontSize: 11 }}>••••••••</Text>,
    },
    {
      title: t('plat.ai.col.lastTest'),
      width: 110,
      render: (_: any, row: any) => {
        if (!row.lastTestedAt) return <Text type="secondary" style={{ fontSize: 11 }}>{t('plat.ai.tag.notTested')}</Text>;
        return row.lastTestStatus === 'ok'
          ? <Tag color="success" icon={<CheckCircleOutlined />}>{t('plat.ai.tag.ok')}</Tag>
          : <Tag color="error" icon={<CloseCircleOutlined />}>{t('plat.ai.tag.fail')}</Tag>;
      },
    },
    {
      title: t('plat.ai.col.enable'),
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
      title: t('plat.ai.col.actions'),
      width: 130,
      render: (_: any, row: any) => (
        <Space size={4}>
          <Button size="small" onClick={() => { setEditing(row); setModalOpen(true); }}>{t('plat.ai.btn.edit')}</Button>
          <Popconfirm title={t('plat.ai.btn.delConfirm')} onConfirm={() => handleDelete(row.id)} okText={t('common.delete')} cancelText={t('common.cancel')} okButtonProps={{ danger: true }}>
            <Button size="small" danger>{t('plat.ai.btn.del')}</Button>
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
          <span>{t('plat.ai.title')} ({providers.length})</span>
        </Space>
      }
      extra={
        <Space>
          <Button icon={<ReloadOutlined />} size="small" onClick={() => void reload()} loading={loading}>{t('plat.ai.refresh')}</Button>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            size="small"
            onClick={() => { setEditing(null); setModalOpen(true); }}
          >
            {t('plat.ai.add')}
          </Button>
        </Space>
      }
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message={t('plat.ai.intro')}
      />
      {providers.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '24px 0', color: '#999' }}>
          <div style={{ fontSize: 24, marginBottom: 8 }}>🔑</div>
          <div>{t('plat.ai.empty.title')}</div>
          <Button
            type="primary"
            style={{ marginTop: 12 }}
            onClick={() => { setEditing(null); setModalOpen(true); }}
          >
            {t('plat.ai.empty.btn')}
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
  const t = useT();
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
        antdMessage.success(t('plat.ai.savedHintEdit'));
        onSuccess();
      } else {
        if (!payload.apiKey) { antdMessage.error(t('plat.ai.firstAddRequiresKey')); setSaving(false); return; }
        const res = await platformConfigApi.createAiProvider(payload);
        setSavedId(res.data?.id ?? null);
        antdMessage.success(t('plat.ai.savedHintNew'));
        onSuccess();
      }
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? t('msg.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (!testableId) { antdMessage.warning(t('plat.ai.testFirst')); return; }
    setTesting(true);
    setTestResult(null);
    try {
      const res = await platformConfigApi.testAiProvider(testableId);
      setTestResult({ ok: res.data.ok, msg: res.data.message });
    } catch (err: any) {
      setTestResult({ ok: false, msg: err?.response?.data?.message ?? t('plat.ai.testFail') });
    } finally {
      setTesting(false);
    }
  };

  return (
    <Modal
      open={open}
      title={isEdit ? t('plat.ai.modal.edit') : t('plat.ai.modal.add')}
      onCancel={onClose}
      width={560}
      footer={
        <Space style={{ justifyContent: 'flex-end', width: '100%' }}>
          <Button loading={testing} onClick={handleTest} disabled={!testableId}>
            {testableId ? t('plat.ai.btnTest') : t('plat.ai.btnTestDisabled')}
          </Button>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="primary" loading={saving} onClick={handleSave} icon={<SaveOutlined />}>{t('plat.ai.btnSave')}</Button>
        </Space>
      }
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message={t('plat.ai.modal.intro')}
      />
      <Form form={form} layout="vertical">
        <Row gutter={12}>
          <Col span={12}>
            <Form.Item name="provider" label={t('plat.ai.field.provider')} rules={[{ required: true }]}>
              <Select options={[
                { value: 'openai',   label: 'OpenAI' },
                { value: 'deepseek', label: 'DeepSeek' },
                { value: 'gemini',   label: 'Google Gemini' },
                { value: 'custom',   label: t('plat.ai.field.providerCustom') },
              ]} />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="name" label={t('plat.ai.field.name')}>
              <Input placeholder={t('plat.ai.field.namePlaceholder')} />
            </Form.Item>
          </Col>
        </Row>
        <Form.Item
          name="apiKey"
          label={t('form.apiKey')}
          extra={isEdit ? t('plat.ai.field.apiKeyExtraEdit') : t('plat.ai.field.apiKeyExtraNew')}
          rules={isEdit ? [] : [{ required: true, message: t('form.required') }]}
        >
          <Input.Password placeholder={isEdit ? t('plat.ai.field.apiKeyPlaceholderEdit') : 'sk-...'} autoComplete="off" />
        </Form.Item>
        <Row gutter={12}>
          <Col span={12}>
            <Form.Item name="model" label={t('plat.ai.field.modelOptional')}>
              <Input placeholder="deepseek-chat / gpt-4o-mini" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="baseUrl" label={t('plat.ai.field.baseUrlOptional')}>
              <Input placeholder="https://api.deepseek.com/v1" />
            </Form.Item>
          </Col>
        </Row>
        <Form.Item name="isDefault" valuePropName="checked" label={t('plat.ai.field.isDefault')}
          extra={t('plat.ai.field.isDefaultExtra')}>
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
