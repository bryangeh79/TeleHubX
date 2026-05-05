import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  Modal,
  Result,
  Row,
  Space,
  Statistic,
  Table,
  Tabs,
  Tag,
  Typography,
  Input,
  message as antdMessage,
  Tooltip,
} from 'antd';
import {
  CrownOutlined,
  KeyOutlined,
  RobotOutlined,
  SafetyCertificateOutlined,
  TeamOutlined,
  ToolOutlined,
  UserOutlined,
  FileTextOutlined,
  ReloadOutlined,
  SaveOutlined,
  UndoOutlined,
} from '@ant-design/icons';
import { adminApi, platformConfigApi } from '../../services/api';
import { useT } from '../../i18n';
import dayjs from 'dayjs';
import PlatformAiProvidersTab from './PlatformAiProvidersTab';
import UsersTab from './UsersTab';
import CloudTenantsTab from './CloudTenantsTab';
import { CloudOutlined } from '@ant-design/icons';

const { Title, Text } = Typography;
const { TextArea } = Input;

function readUserRole(): string {
  try {
    const raw = localStorage.getItem('telehubx:user');
    if (!raw) return 'OPERATOR';
    return JSON.parse(raw).role ?? 'OPERATOR';
  } catch {
    return 'OPERATOR';
  }
}

// ── Prompt 配置 Tab ───────────────────────────────────────────────────────
function VariantPromptTab() {
  const t = useT();
  const [value, setValue] = useState('');
  const [original, setOriginal] = useState('');
  const [isDefault, setIsDefault] = useState(true);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await platformConfigApi.getVariantPrompt();
      setValue(res.data.value);
      setOriginal(res.data.value);
      setIsDefault(res.data.isDefault);
    } catch {
      antdMessage.error(t('admin.cfg.loadFail'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const handleSave = async () => {
    if (!value.trim()) { antdMessage.warning(t('admin.variant.empty')); return; }
    setSaving(true);
    try {
      await platformConfigApi.setVariantPrompt(value.trim());
      setOriginal(value.trim());
      setIsDefault(false);
      antdMessage.success(t('admin.cfg.saveOk'));
    } catch {
      antdMessage.error(t('admin.cfg.saveFail'));
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    setSaving(true);
    try {
      const res = await platformConfigApi.resetVariantPrompt();
      setValue(res.data.value);
      setOriginal(res.data.value);
      setIsDefault(true);
      antdMessage.success(t('admin.cfg.resetOk'));
    } catch {
      antdMessage.error(t('admin.cfg.resetFail'));
    } finally {
      setSaving(false);
    }
  };

  const dirty = value !== original;

  return (
    <div>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message={t('admin.variant.alert.title')}
        description={t('admin.variant.alert.desc', { contentVar: '{content}', countVar: '{count}' })}
      />

      <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Space>
          {isDefault
            ? <Tag color="default">{t('admin.cfg.systemDefault')}</Tag>
            : <Tag color="blue">{t('admin.cfg.customized')}</Tag>
          }
          {dirty && <Tag color="orange">{t('admin.cfg.unsaved')}</Tag>}
        </Space>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={load} loading={loading} size="small">
            {t('common.refresh')}
          </Button>
        </Space>
      </div>

      <TextArea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        autoSize={{ minRows: 18, maxRows: 36 }}
        style={{ fontFamily: 'monospace', fontSize: 13 }}
        placeholder={t('admin.variant.placeholder')}
      />

      <div style={{ marginTop: 12, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <Tooltip title={t('admin.variant.tooltipReset')}>
          <Button icon={<UndoOutlined />} onClick={handleReset} loading={saving} disabled={isDefault && !dirty}>
            {t('admin.cfg.restoreDefault')}
          </Button>
        </Tooltip>
        <Button
          type="primary"
          icon={<SaveOutlined />}
          onClick={handleSave}
          loading={saving}
          disabled={!dirty}
        >
          {t('common.save')}
        </Button>
      </div>
    </div>
  );
}

// ── AI 客服人设 Tab ───────────────────────────────────────────────────────
function GlobalPersonaTab() {
  const t = useT();
  const [value, setValue] = useState('');
  const [original, setOriginal] = useState('');
  const [isDefault, setIsDefault] = useState(true);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await platformConfigApi.getGlobalPersona();
      setValue(res.data.value);
      setOriginal(res.data.value);
      setIsDefault(res.data.isDefault);
    } catch {
      antdMessage.error(t('admin.cfg.loadFail'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const handleSave = async () => {
    if (!value.trim()) { antdMessage.warning(t('admin.persona.empty')); return; }
    setSaving(true);
    try {
      await platformConfigApi.setGlobalPersona(value.trim());
      setOriginal(value.trim());
      setIsDefault(false);
      antdMessage.success(t('admin.cfg.saveOkPersona'));
    } catch {
      antdMessage.error(t('admin.cfg.saveFail'));
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    setSaving(true);
    try {
      const res = await platformConfigApi.resetGlobalPersona();
      setValue(res.data.value);
      setOriginal(res.data.value);
      setIsDefault(true);
      antdMessage.success(t('admin.persona.resetOk'));
    } catch {
      antdMessage.error(t('admin.cfg.resetFail'));
    } finally {
      setSaving(false);
    }
  };

  const dirty = value !== original;

  return (
    <div>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message={t('admin.persona.alert.title')}
        description={t('admin.persona.alert.desc')}
      />

      <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Space>
          {isDefault
            ? <Tag color="default">{t('admin.cfg.systemDefault')}</Tag>
            : <Tag color="blue">{t('admin.cfg.customized')}</Tag>
          }
          {dirty && <Tag color="orange">{t('admin.cfg.unsaved')}</Tag>}
        </Space>
        <Button icon={<ReloadOutlined />} onClick={load} loading={loading} size="small">
          {t('common.refresh')}
        </Button>
      </div>

      <TextArea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        autoSize={{ minRows: 22, maxRows: 50 }}
        style={{ fontFamily: 'monospace', fontSize: 13 }}
        placeholder={t('admin.persona.placeholder')}
      />

      <div style={{ marginTop: 12, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <Tooltip title={t('admin.persona.tooltipReset')}>
          <Button icon={<UndoOutlined />} onClick={handleReset} loading={saving} disabled={isDefault && !dirty}>
            {t('admin.cfg.restoreDefault')}
          </Button>
        </Tooltip>
        <Button
          type="primary"
          icon={<SaveOutlined />}
          onClick={handleSave}
          loading={saving}
          disabled={!dirty}
        >
          {t('common.save')}
        </Button>
      </div>
    </div>
  );
}

// ── 转接话术 Tab ──────────────────────────────────────────────────────────
function HandoffNoticeTab() {
  const t = useT();
  const [value, setValue] = useState('');
  const [original, setOriginal] = useState('');
  const [isDefault, setIsDefault] = useState(true);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await platformConfigApi.getHandoffNotice();
      setValue(res.data.value);
      setOriginal(res.data.value);
      setIsDefault(res.data.isDefault);
    } catch {
      antdMessage.error(t('admin.cfg.loadFail'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const handleSave = async () => {
    if (!value.trim()) { antdMessage.warning(t('admin.handoff.empty')); return; }
    setSaving(true);
    try {
      await platformConfigApi.setHandoffNotice(value.trim());
      setOriginal(value.trim());
      setIsDefault(false);
      antdMessage.success(t('admin.cfg.saveOkHandoff'));
    } catch {
      antdMessage.error(t('admin.cfg.saveFail'));
    } finally { setSaving(false); }
  };

  const handleReset = async () => {
    setSaving(true);
    try {
      const res = await platformConfigApi.resetHandoffNotice();
      setValue(res.data.value);
      setOriginal(res.data.value);
      setIsDefault(true);
      antdMessage.success(t('admin.cfg.resetOkHandoff'));
    } catch {
      antdMessage.error(t('admin.cfg.resetFail'));
    } finally { setSaving(false); }
  };

  const dirty = value !== original;

  return (
    <div>
      <Alert type="info" showIcon style={{ marginBottom: 16 }}
        message={t('admin.handoff.alert.title')}
        description={t('admin.handoff.alert.desc')} />

      <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between' }}>
        <Space>
          {isDefault ? <Tag color="default">{t('admin.cfg.systemDefault')}</Tag> : <Tag color="blue">{t('admin.cfg.customized')}</Tag>}
          {dirty && <Tag color="orange">{t('admin.cfg.unsaved')}</Tag>}
        </Space>
        <Button icon={<ReloadOutlined />} onClick={load} loading={loading} size="small">{t('common.refresh')}</Button>
      </div>

      <TextArea value={value} onChange={e => setValue(e.target.value)}
        autoSize={{ minRows: 4, maxRows: 10 }}
        placeholder={t('admin.handoff.placeholder')} />

      <div style={{ marginTop: 12, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <Button icon={<UndoOutlined />} onClick={handleReset} loading={saving} disabled={isDefault && !dirty}>
          {t('admin.cfg.restoreDefault')}
        </Button>
        <Button type="primary" icon={<SaveOutlined />} onClick={handleSave} loading={saving} disabled={!dirty}>
          {t('common.save')}
        </Button>
      </div>
    </div>
  );
}

// ── 行业话术 Tab ──────────────────────────────────────────────────────────
function IndustryPromptTab() {
  const t = useT();
  const [rows, setRows] = useState<Array<{ industry: string; prompt: string }>>([]);
  const [original, setOriginal] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await platformConfigApi.getIndustryPrompts();
      const map = (res.data?.prompts ?? {}) as Record<string, string>;
      setOriginal(map);
      setRows(Object.entries(map).map(([industry, prompt]) => ({ industry, prompt })));
    } catch {
      antdMessage.error(t('admin.cfg.loadFail'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const updateRow = (idx: number, patch: Partial<{ industry: string; prompt: string }>) => {
    setRows(prev => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };

  const removeRow = (idx: number) => {
    setRows(prev => prev.filter((_, i) => i !== idx));
  };

  const addRow = () => {
    setRows(prev => [...prev, { industry: '', prompt: '' }]);
  };

  const handleSave = async () => {
    const map: Record<string, string> = {};
    for (const r of rows) {
      const k = r.industry.trim();
      const v = r.prompt.trim();
      if (!k || !v) continue;
      if (map[k]) {
        antdMessage.warning(t('admin.industry.dupWarn', { name: k }));
        return;
      }
      map[k] = v;
    }
    if (!Object.keys(map).length) { antdMessage.warning(t('admin.industry.atLeastOne')); return; }
    setSaving(true);
    try {
      const res = await platformConfigApi.setIndustryPrompts(map);
      const saved = (res.data?.prompts ?? map) as Record<string, string>;
      setOriginal(saved);
      setRows(Object.entries(saved).map(([industry, prompt]) => ({ industry, prompt })));
      antdMessage.success(t('admin.cfg.saveOkPersona'));
    } catch {
      antdMessage.error(t('admin.cfg.saveFail'));
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    setSaving(true);
    try {
      const res = await platformConfigApi.resetIndustryPrompts();
      const saved = (res.data?.prompts ?? {}) as Record<string, string>;
      setOriginal(saved);
      setRows(Object.entries(saved).map(([industry, prompt]) => ({ industry, prompt })));
      antdMessage.success(t('admin.cfg.resetOk'));
    } catch {
      antdMessage.error(t('admin.cfg.resetFail'));
    } finally {
      setSaving(false);
    }
  };

  const dirty = (() => {
    if (rows.length !== Object.keys(original).length) return true;
    for (const r of rows) {
      if (original[r.industry] !== r.prompt) return true;
    }
    return false;
  })();

  return (
    <div>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message={t('admin.industry.alert.title')}
        description={t('admin.industry.alert.desc')}
      />

      <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Space>
          <Tag color={dirty ? 'orange' : 'default'}>{dirty ? t('admin.cfg.unsaved') : t('admin.cfg.saved')}</Tag>
          <Text type="secondary">{t('admin.industry.totalCount', { count: rows.length })}</Text>
        </Space>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={load} loading={loading} size="small">{t('common.refresh')}</Button>
          <Button onClick={addRow} size="small">{t('admin.industry.addRow')}</Button>
        </Space>
      </div>

      <Table
        size="small"
        rowKey={(_, i) => String(i)}
        dataSource={rows}
        pagination={false}
        columns={[
          {
            title: t('admin.industry.col.industry'),
            dataIndex: 'industry',
            width: 160,
            render: (v: string, _r, idx) => (
              <Input
                value={v}
                onChange={e => updateRow(idx, { industry: e.target.value })}
                placeholder={t('admin.industry.placeholder.industry')}
              />
            ),
          },
          {
            title: t('admin.industry.col.prompt'),
            dataIndex: 'prompt',
            render: (v: string, _r, idx) => (
              <TextArea
                value={v}
                onChange={e => updateRow(idx, { prompt: e.target.value })}
                autoSize={{ minRows: 2, maxRows: 6 }}
                placeholder={t('admin.industry.placeholder.prompt')}
                showCount
                maxLength={400}
              />
            ),
          },
          {
            title: t('admin.industry.col.actions'),
            width: 80,
            render: (_, _r, idx) => (
              <Button size="small" type="text" danger onClick={() => removeRow(idx)}>{t('common.delete')}</Button>
            ),
          },
        ]}
      />

      <div style={{ marginTop: 12, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <Tooltip title={t('admin.industry.tooltipReset')}>
          <Button icon={<UndoOutlined />} onClick={handleReset} loading={saving}>{t('admin.cfg.restoreDefault')}</Button>
        </Tooltip>
        <Button type="primary" icon={<SaveOutlined />} onClick={handleSave} loading={saving} disabled={!dirty}>
          {t('common.save')}
        </Button>
      </div>
    </div>
  );
}

// ── 租户管理 Tab ──────────────────────────────────────────────────────────
function TenantsTab() {
  const t = useT();
  const [tenants, setTenants] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [plan, setPlan] = useState<string>('basic');

  const load = async () => {
    setLoading(true);
    try {
      const res = await adminApi.listTenants();
      setTenants(res.data ?? []);
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? t('admin.cfg.loadFail'));
    } finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const handleCreate = async () => {
    if (!name.trim()) { antdMessage.warning(t('admin.tenants.nameRequired')); return; }
    try {
      await adminApi.createTenant({ name: name.trim(), plan });
      antdMessage.success(t('admin.tenants.createOk', { name }));
      setCreateOpen(false);
      setName('');
      void load();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? t('admin.tenants.createFail'));
    }
  };

  const handleSuspend = (row: any) => {
    Modal.confirm({
      title: t('admin.tenants.suspendTitle', { name: row.name }),
      content: t('admin.tenants.suspendDesc'),
      okText: t('admin.tenants.suspendBtn'), okType: 'danger',
      onOk: async () => {
        try { await adminApi.suspendTenant(row.id); antdMessage.success(t('admin.tenants.suspendOk')); void load(); }
        catch (err: any) { antdMessage.error(err?.response?.data?.message ?? t('msg.opFailed')); }
      },
    });
  };

  const handleResume = async (row: any) => {
    try { await adminApi.resumeTenant(row.id); antdMessage.success(t('admin.tenants.resumeOk')); void load(); }
    catch (err: any) { antdMessage.error(err?.response?.data?.message ?? t('msg.opFailed')); }
  };

  const handleDelete = (row: any) => {
    if (row.name === 'default') { antdMessage.warning(t('admin.tenants.cantDeleteDefault')); return; }
    Modal.confirm({
      title: t('admin.tenants.deleteTitle', { name: row.name }),
      content: t('admin.tenants.deleteDesc'),
      okText: t('admin.tenants.deleteBtn'), okType: 'danger',
      onOk: async () => {
        try { await adminApi.deleteTenant(row.id); antdMessage.success(t('common.delete')); void load(); }
        catch (err: any) { antdMessage.error(err?.response?.data?.message ?? t('msg.deleteFailed')); }
      },
    });
  };

  const planAccountsLabel = (p: string) => p === 'basic'
    ? t('admin.tenants.planAccountsBasic')
    : p === 'pro'
      ? t('admin.tenants.planAccountsPro')
      : t('admin.tenants.planAccountsEnt');

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Button type="primary" onClick={() => setCreateOpen(true)}>{t('admin.tenants.btnNew')}</Button>
        <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>{t('common.refresh')}</Button>
      </Space>
      <Table
        dataSource={tenants}
        rowKey="id"
        size="small"
        loading={loading}
        columns={[
          { title: t('admin.tenants.col.name'), dataIndex: 'name', render: (n: string) => <Text strong>{n}</Text> },
          { title: t('admin.tenants.col.plan'), dataIndex: 'plan', width: 100, render: (p: string) => <Tag color="blue">{p?.toUpperCase()}</Tag> },
          { title: t('admin.tenants.col.status'), dataIndex: 'status', width: 100, render: (s: string) =>
            <Tag color={s === 'active' ? 'green' : s === 'suspended' ? 'red' : 'orange'}>{s}</Tag>
          },
          { title: t('admin.tenants.col.quota'), width: 120, render: (_, r: any) => `${r.currentAccounts ?? 0} / ${r.maxAccounts}` },
          { title: t('admin.tenants.col.expires'), dataIndex: 'licenseExpiresAt', width: 130, render: (d: string | null) =>
            d ? dayjs(d).format('YYYY-MM-DD') : <Text type="secondary">{t('admin.tenants.notBound')}</Text>
          },
          { title: t('admin.tenants.col.created'), dataIndex: 'createdAt', width: 130, render: (d: string) => dayjs(d).format('MM-DD HH:mm') },
          { title: t('admin.tenants.col.actions'), width: 200, render: (_, r: any) => (
            <Space size={4}>
              {r.status === 'active' && r.name !== 'default' && (
                <Button size="small" danger onClick={() => handleSuspend(r)}>{t('admin.tenants.btnSuspend')}</Button>
              )}
              {r.status === 'suspended' && (
                <Button size="small" type="primary" onClick={() => handleResume(r)}>{t('admin.tenants.btnResume')}</Button>
              )}
              {r.name !== 'default' && (
                <Button size="small" type="text" danger onClick={() => handleDelete(r)}>{t('admin.tenants.btnDelete')}</Button>
              )}
            </Space>
          )},
        ]}
      />
      <Modal
        title={t('admin.tenants.modalNew')}
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={handleCreate}
        okText={t('common.add')}
        cancelText={t('common.cancel')}
      >
        <div style={{ marginBottom: 12 }}>
          <Text strong>{t('admin.tenants.nameLabel')}</Text>
          <Input value={name} onChange={e => setName(e.target.value)} placeholder={t('admin.tenants.namePlaceholder')} style={{ marginTop: 4 }} />
        </div>
        <div>
          <Text strong>{t('admin.tenants.planLabel')}</Text>
          <div style={{ marginTop: 4 }}>
            <Space.Compact>
              {['basic', 'pro', 'enterprise'].map(p => (
                <Button
                  key={p}
                  type={plan === p ? 'primary' : 'default'}
                  onClick={() => setPlan(p)}
                >
                  {p.toUpperCase()} ({planAccountsLabel(p)})
                </Button>
              ))}
            </Space.Compact>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ── License Tab ───────────────────────────────────────────────────────────
function LicensesTab() {
  const t = useT();
  const [licenses, setLicenses] = useState<any[]>([]);
  const [tenants, setTenants] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [issueOpen, setIssueOpen] = useState(false);
  const [plan, setPlan] = useState<string>('basic');
  const [boundTenantId, setBoundTenantId] = useState<string | undefined>();
  const [notes, setNotes] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const [l, ts] = await Promise.all([adminApi.listLicenses(), adminApi.listTenants()]);
      setLicenses(l.data ?? []);
      setTenants(ts.data ?? []);
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? t('admin.cfg.loadFail'));
    } finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const handleIssue = async () => {
    try {
      const res = await adminApi.issueLicense({
        plan,
        notes: notes.trim() || undefined,
        tenantId: boundTenantId,
        bindNow: !!boundTenantId,
      });
      const key = res.data?.key;
      Modal.success({
        title: t('admin.lic.issueOk'),
        content: (
          <div>
            <p>{t('admin.lic.issueOkDesc')}</p>
            <Text code copyable style={{ fontSize: 13 }}>{key}</Text>
            {boundTenantId && <p style={{ marginTop: 12 }}>{t('admin.lic.boundTo', { name: tenants.find(x => x.id === boundTenantId)?.name ?? '' })}</p>}
          </div>
        ),
      });
      setIssueOpen(false);
      setNotes('');
      setBoundTenantId(undefined);
      void load();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? t('admin.lic.issueFail'));
    }
  };

  const handleRevoke = (l: any) => {
    Modal.confirm({
      title: t('admin.lic.revokeTitle', { key: l.key }),
      content: t('admin.lic.revokeDesc'),
      okText: t('admin.lic.btnRevoke'), okType: 'danger',
      onOk: async () => {
        try { await adminApi.revokeLicense(l.id); antdMessage.success(t('admin.lic.revokeOk')); void load(); }
        catch (err: any) { antdMessage.error(err?.response?.data?.message ?? t('admin.lic.revokeFail')); }
      },
    });
  };

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Button type="primary" onClick={() => setIssueOpen(true)}>{t('admin.lic.btnIssue')}</Button>
        <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>{t('common.refresh')}</Button>
      </Space>
      <Table
        dataSource={licenses}
        rowKey="id"
        size="small"
        loading={loading}
        columns={[
          { title: t('admin.lic.col.key'), dataIndex: 'key', render: (k: string) => <Text code copyable style={{ fontSize: 11 }}>{k}</Text> },
          { title: t('admin.lic.col.plan'), dataIndex: 'plan', width: 100, render: (p: string) => <Tag color="blue">{p?.toUpperCase()}</Tag> },
          { title: t('admin.lic.col.status'), dataIndex: 'status', width: 100, render: (s: string) => {
            const c = s === 'active' ? 'green' : s === 'pending' ? 'default' : s === 'revoked' ? 'red' : 'orange';
            return <Tag color={c}>{s}</Tag>;
          }},
          { title: t('admin.lic.col.tenant'), dataIndex: 'tenantId', width: 120, render: (tid: string | null) =>
            tid ? <Text>{tenants.find(x => x.id === tid)?.name ?? tid.slice(0, 8)}</Text> : <Text type="secondary">{t('admin.tenants.notBound')}</Text>
          },
          { title: t('admin.lic.col.expires'), dataIndex: 'expiresAt', width: 110, render: (d: string | null) =>
            d ? dayjs(d).format('YYYY-MM-DD') : '-'
          },
          { title: t('admin.lic.col.issued'), dataIndex: 'createdAt', width: 130, render: (d: string) => dayjs(d).format('MM-DD HH:mm') },
          { title: t('admin.lic.col.actions'), width: 100, render: (_, r: any) => (
            r.status === 'active' || r.status === 'pending' ? (
              <Button size="small" danger onClick={() => handleRevoke(r)}>{t('admin.lic.btnRevoke')}</Button>
            ) : null
          )},
        ]}
      />
      <Modal
        title={t('admin.lic.modalIssue')}
        open={issueOpen}
        onCancel={() => setIssueOpen(false)}
        onOk={handleIssue}
        okText={t('admin.lic.btnIssue').replace(/^\+ /, '')}
        cancelText={t('common.cancel')}
      >
        <div style={{ marginBottom: 12 }}>
          <Text strong>{t('admin.tenants.planLabel')}</Text>
          <div style={{ marginTop: 4 }}>
            <Space.Compact>
              {['basic', 'pro', 'enterprise'].map(p => (
                <Button key={p} type={plan === p ? 'primary' : 'default'} onClick={() => setPlan(p)}>
                  {p.toUpperCase()}
                </Button>
              ))}
            </Space.Compact>
          </div>
        </div>
        <div style={{ marginBottom: 12 }}>
          <Text strong>{t('admin.lic.bindLabel')}</Text>
          <div style={{ marginTop: 4 }}>
            <select
              value={boundTenantId ?? ''}
              onChange={e => setBoundTenantId(e.target.value || undefined)}
              style={{ width: '100%', padding: 6, borderRadius: 4, border: '1px solid #d9d9d9' }}
            >
              <option value="">{t('admin.lic.bindNone')}</option>
              {tenants.map(x => <option key={x.id} value={x.id}>{x.name} ({x.plan})</option>)}
            </select>
          </div>
        </div>
        <div>
          <Text strong>{t('admin.lic.notes')}</Text>
          <Input.TextArea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder={t('admin.lic.notesPlaceholder')} style={{ marginTop: 4 }} />
        </div>
      </Modal>
    </div>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────
export default function AdminPage() {
  const t = useT();
  const [role, setRole] = useState<string>('OPERATOR');
  const [stats, setStats] = useState<any>({ totalTenants: 0, activeTenants: 0, suspendedTenants: 0, totalLicenses: 0, activeLicenses: 0, expiringIn30d: 0 });

  useEffect(() => {
    setRole(readUserRole());
    adminApi.stats().then(r => setStats(r.data)).catch(() => {});
  }, []);

  if (role !== 'super_admin' && role !== 'SUPER_ADMIN') {
    return (
      <Result
        status="403"
        title="403"
        subTitle={t('admin.deny.subtitle')}
        extra={<Button type="primary" href="/">{t('admin.deny.back')}</Button>}
      />
    );
  }

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <Title level={4} style={{ margin: 0 }}>
          <CrownOutlined style={{ marginRight: 8, color: '#faad14' }} />
          {t('page.admin.title')}
          <Tag color="gold" style={{ marginLeft: 12, fontSize: 11 }}>SaaS Admin</Tag>
        </Title>
      </div>

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}><Card><Statistic title={t('admin.stat.totalTenants')}     value={stats.totalTenants}     prefix={<TeamOutlined />} /></Card></Col>
        <Col span={6}><Card><Statistic title={t('admin.stat.activeLicenses')}   value={stats.activeLicenses}   prefix={<SafetyCertificateOutlined />} /></Card></Col>
        <Col span={6}><Card><Statistic title={t('admin.stat.expiringIn30d')}    value={stats.expiringIn30d}    valueStyle={{ color: stats.expiringIn30d > 0 ? '#fa8c16' : undefined }} /></Card></Col>
        <Col span={6}><Card><Statistic title={t('admin.stat.suspended')}        value={stats.suspendedTenants} valueStyle={{ color: stats.suspendedTenants > 0 ? '#cf1322' : undefined }} /></Card></Col>
      </Row>

      <Card>
        <Tabs
          defaultActiveKey="cloud-tenants"
          items={[
            {
              key: 'cloud-tenants',
              label: <span><CloudOutlined /> Cloud Tenants</span>,
              children: <CloudTenantsTab />,
            },
            {
              key: 'tenants',
              label: <span><TeamOutlined /> {t('page.admin.tab.tenants')}</span>,
              children: <TenantsTab />,
            },
            {
              key: 'licenses',
              label: <span><SafetyCertificateOutlined /> {t('page.admin.tab.licenses')}</span>,
              children: <LicensesTab />,
            },
            {
              key: 'platform-ai',
              label: <span><KeyOutlined /> {t('page.admin.tab.platformAi')}</span>,
              children: <PlatformAiProvidersTab />,
            },
            {
              key: 'users',
              label: <span><UserOutlined /> {t('page.admin.tab.users')}</span>,
              children: <UsersTab />,
            },
            {
              key: 'prompt-config',
              label: <span><FileTextOutlined /> {t('admin.tab.promptConfig')}</span>,
              children: (
                <Tabs
                  size="small"
                  items={[
                    {
                      key: 'persona',
                      label: <span><RobotOutlined /> {t('admin.tab.persona')}</span>,
                      children: <GlobalPersonaTab />,
                    },
                    {
                      key: 'variant',
                      label: <span><FileTextOutlined /> {t('admin.tab.adVariant')}</span>,
                      children: <VariantPromptTab />,
                    },
                    {
                      key: 'industry',
                      label: <span><RobotOutlined /> {t('admin.tab.industry')}</span>,
                      children: <IndustryPromptTab />,
                    },
                    {
                      key: 'handoff',
                      label: <span><TeamOutlined /> {t('admin.tab.handoff')}</span>,
                      children: <HandoffNoticeTab />,
                    },
                  ]}
                />
              ),
            },
            {
              key: 'system',
              label: <span><ToolOutlined /> {t('admin.tab.system')}</span>,
              children: (
                <Empty description={t('admin.system.empty')} style={{ padding: 40 }} />
              ),
            },
          ]}
        />
      </Card>
    </div>
  );
}
