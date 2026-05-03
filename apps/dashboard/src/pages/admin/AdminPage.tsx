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
  FileTextOutlined,
  ReloadOutlined,
  SaveOutlined,
  UndoOutlined,
} from '@ant-design/icons';
import { adminApi, platformConfigApi } from '../../services/api';
import dayjs from 'dayjs';

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
      antdMessage.error('加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const handleSave = async () => {
    if (!value.trim()) { antdMessage.warning('Prompt 不能为空'); return; }
    setSaving(true);
    try {
      await platformConfigApi.setVariantPrompt(value.trim());
      setOriginal(value.trim());
      setIsDefault(false);
      antdMessage.success('已保存');
    } catch {
      antdMessage.error('保存失败');
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
      antdMessage.success('已恢复为系统默认');
    } catch {
      antdMessage.error('重置失败');
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
        message="变体生成 Prompt 模板"
        description={
          <span>
            控制「AI 生成 10 条变体」功能的指令。使用 <Text code>{'{content}'}</Text> 代表原始文案，
            <Text code>{'{count}'}</Text> 代表生成数量。修改后对所有广告文案的变体生成立即生效。
          </span>
        }
      />

      <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Space>
          {isDefault
            ? <Tag color="default">系统默认</Tag>
            : <Tag color="blue">已自定义</Tag>
          }
          {dirty && <Tag color="orange">未保存</Tag>}
        </Space>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={load} loading={loading} size="small">
            刷新
          </Button>
        </Space>
      </div>

      <TextArea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        autoSize={{ minRows: 18, maxRows: 36 }}
        style={{ fontFamily: 'monospace', fontSize: 13 }}
        placeholder="在此输入 Prompt 模板..."
      />

      <div style={{ marginTop: 12, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <Tooltip title="恢复为系统内置的默认 Prompt">
          <Button icon={<UndoOutlined />} onClick={handleReset} loading={saving} disabled={isDefault && !dirty}>
            恢复默认
          </Button>
        </Tooltip>
        <Button
          type="primary"
          icon={<SaveOutlined />}
          onClick={handleSave}
          loading={saving}
          disabled={!dirty}
        >
          保存
        </Button>
      </div>
    </div>
  );
}

// ── AI 客服人设 Tab ───────────────────────────────────────────────────────
function GlobalPersonaTab() {
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
      antdMessage.error('加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const handleSave = async () => {
    if (!value.trim()) { antdMessage.warning('人设内容不能为空'); return; }
    setSaving(true);
    try {
      await platformConfigApi.setGlobalPersona(value.trim());
      setOriginal(value.trim());
      setIsDefault(false);
      antdMessage.success('已保存，下次 Bot 回复即生效');
    } catch {
      antdMessage.error('保存失败');
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
      antdMessage.success('已恢复为系统默认人设');
    } catch {
      antdMessage.error('重置失败');
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
        message="AI 客服人设（全局默认）"
        description="控制 Bot 智能回复时的角色、目标、风格、销售流程、转人工规则等。此人设是所有租户 Bot 回复的基础层，下次 Bot 收到消息即生效。"
      />

      <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Space>
          {isDefault
            ? <Tag color="default">系统默认</Tag>
            : <Tag color="blue">已自定义</Tag>
          }
          {dirty && <Tag color="orange">未保存</Tag>}
        </Space>
        <Button icon={<ReloadOutlined />} onClick={load} loading={loading} size="small">
          刷新
        </Button>
      </div>

      <TextArea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        autoSize={{ minRows: 22, maxRows: 50 }}
        style={{ fontFamily: 'monospace', fontSize: 13 }}
        placeholder="在此输入 AI 客服人设..."
      />

      <div style={{ marginTop: 12, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <Tooltip title="恢复为系统内置的 18 章营销客服人格">
          <Button icon={<UndoOutlined />} onClick={handleReset} loading={saving} disabled={isDefault && !dirty}>
            恢复默认
          </Button>
        </Tooltip>
        <Button
          type="primary"
          icon={<SaveOutlined />}
          onClick={handleSave}
          loading={saving}
          disabled={!dirty}
        >
          保存
        </Button>
      </div>
    </div>
  );
}

// ── 转接话术 Tab ──────────────────────────────────────────────────────────
function HandoffNoticeTab() {
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
      antdMessage.error('加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const handleSave = async () => {
    if (!value.trim()) { antdMessage.warning('话术不能为空'); return; }
    setSaving(true);
    try {
      await platformConfigApi.setHandoffNotice(value.trim());
      setOriginal(value.trim());
      setIsDefault(false);
      antdMessage.success('已保存，下次 handoff 触发即生效');
    } catch {
      antdMessage.error('保存失败');
    } finally { setSaving(false); }
  };

  const handleReset = async () => {
    setSaving(true);
    try {
      const res = await platformConfigApi.resetHandoffNotice();
      setValue(res.data.value);
      setOriginal(res.data.value);
      setIsDefault(true);
      antdMessage.success('已恢复默认');
    } catch {
      antdMessage.error('重置失败');
    } finally { setSaving(false); }
  };

  const dirty = value !== original;

  return (
    <div>
      <Alert type="info" showIcon style={{ marginBottom: 16 }}
        message="转接人工话术"
        description="客户触发『真人客服』『投诉』『律师』等关键字时，Bot 会立刻发这条话术告诉客户『已转人工』，避免干等。同时后台会推送给所有配置的 operator Telegram。" />

      <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between' }}>
        <Space>
          {isDefault ? <Tag color="default">系统默认</Tag> : <Tag color="blue">已自定义</Tag>}
          {dirty && <Tag color="orange">未保存</Tag>}
        </Space>
        <Button icon={<ReloadOutlined />} onClick={load} loading={loading} size="small">刷新</Button>
      </div>

      <TextArea value={value} onChange={e => setValue(e.target.value)}
        autoSize={{ minRows: 4, maxRows: 10 }}
        placeholder="例如：好的，已为你转接人工客服 😊 稍等一下..." />

      <div style={{ marginTop: 12, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <Button icon={<UndoOutlined />} onClick={handleReset} loading={saving} disabled={isDefault && !dirty}>
          恢复默认
        </Button>
        <Button type="primary" icon={<SaveOutlined />} onClick={handleSave} loading={saving} disabled={!dirty}>
          保存
        </Button>
      </div>
    </div>
  );
}

// ── 行业话术 Tab ──────────────────────────────────────────────────────────
function IndustryPromptTab() {
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
      antdMessage.error('加载失败');
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
        antdMessage.warning(`行业「${k}」重复，请去除重复项`);
        return;
      }
      map[k] = v;
    }
    if (!Object.keys(map).length) { antdMessage.warning('至少保留一行'); return; }
    setSaving(true);
    try {
      const res = await platformConfigApi.setIndustryPrompts(map);
      const saved = (res.data?.prompts ?? map) as Record<string, string>;
      setOriginal(saved);
      setRows(Object.entries(saved).map(([industry, prompt]) => ({ industry, prompt })));
      antdMessage.success('已保存，下次 Bot 回复即生效');
    } catch {
      antdMessage.error('保存失败');
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
      antdMessage.success('已恢复为系统默认');
    } catch {
      antdMessage.error('重置失败');
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
        message="行业话术（按公司行业差异化）"
        description="租户在「公司资讯向导」选定的行业，会自动注入对应话术到 AI 系统提示词。每条建议 1-3 句，≤ 200 字。请保留「其他」作为兜底。"
      />

      <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Space>
          <Tag color={dirty ? 'orange' : 'default'}>{dirty ? '未保存' : '已保存'}</Tag>
          <Text type="secondary">共 {rows.length} 条</Text>
        </Space>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={load} loading={loading} size="small">刷新</Button>
          <Button onClick={addRow} size="small">+ 新增行业</Button>
        </Space>
      </div>

      <Table
        size="small"
        rowKey={(_, i) => String(i)}
        dataSource={rows}
        pagination={false}
        columns={[
          {
            title: '行业',
            dataIndex: 'industry',
            width: 160,
            render: (v: string, _r, idx) => (
              <Input
                value={v}
                onChange={e => updateRow(idx, { industry: e.target.value })}
                placeholder="例如：金融业"
              />
            ),
          },
          {
            title: '话术注入',
            dataIndex: 'prompt',
            render: (v: string, _r, idx) => (
              <TextArea
                value={v}
                onChange={e => updateRow(idx, { prompt: e.target.value })}
                autoSize={{ minRows: 2, maxRows: 6 }}
                placeholder="此行业 Bot 应注意的话术规则……"
                showCount
                maxLength={400}
              />
            ),
          },
          {
            title: '操作',
            width: 80,
            render: (_, _r, idx) => (
              <Button size="small" type="text" danger onClick={() => removeRow(idx)}>删除</Button>
            ),
          },
        ]}
      />

      <div style={{ marginTop: 12, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <Tooltip title="恢复为系统内置默认行业话术表">
          <Button icon={<UndoOutlined />} onClick={handleReset} loading={saving}>恢复默认</Button>
        </Tooltip>
        <Button type="primary" icon={<SaveOutlined />} onClick={handleSave} loading={saving} disabled={!dirty}>
          保存全部
        </Button>
      </div>
    </div>
  );
}

// ── 租户管理 Tab ──────────────────────────────────────────────────────────
function TenantsTab() {
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
      antdMessage.error(err?.response?.data?.message ?? '加载失败');
    } finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const handleCreate = async () => {
    if (!name.trim()) { antdMessage.warning('租户名必填'); return; }
    try {
      await adminApi.createTenant({ name: name.trim(), plan });
      antdMessage.success(`已创建租户「${name}」`);
      setCreateOpen(false);
      setName('');
      void load();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? '创建失败');
    }
  };

  const handleSuspend = (t: any) => {
    Modal.confirm({
      title: `暂停租户「${t.name}」？`,
      content: '暂停后该租户登录失败、所有任务停止派发。可以随时恢复。',
      okText: '暂停', okType: 'danger',
      onOk: async () => {
        try { await adminApi.suspendTenant(t.id); antdMessage.success('已暂停'); void load(); }
        catch (err: any) { antdMessage.error(err?.response?.data?.message ?? '操作失败'); }
      },
    });
  };

  const handleResume = async (t: any) => {
    try { await adminApi.resumeTenant(t.id); antdMessage.success('已恢复'); void load(); }
    catch (err: any) { antdMessage.error(err?.response?.data?.message ?? '操作失败'); }
  };

  const handleDelete = (t: any) => {
    if (t.name === 'default') { antdMessage.warning('不能删除 default 租户'); return; }
    Modal.confirm({
      title: `永久删除租户「${t.name}」？`,
      content: '该租户的所有账号/数据/license 将全部丢失。该操作不可逆！',
      okText: '永久删除', okType: 'danger',
      onOk: async () => {
        try { await adminApi.deleteTenant(t.id); antdMessage.success('已删除'); void load(); }
        catch (err: any) { antdMessage.error(err?.response?.data?.message ?? '删除失败'); }
      },
    });
  };

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Button type="primary" onClick={() => setCreateOpen(true)}>+ 新建租户</Button>
        <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>刷新</Button>
      </Space>
      <Table
        dataSource={tenants}
        rowKey="id"
        size="small"
        loading={loading}
        columns={[
          { title: '租户名称', dataIndex: 'name', render: (n: string) => <Text strong>{n}</Text> },
          { title: '套餐', dataIndex: 'plan', width: 100, render: (p: string) => <Tag color="blue">{p?.toUpperCase()}</Tag> },
          { title: '状态', dataIndex: 'status', width: 100, render: (s: string) =>
            <Tag color={s === 'active' ? 'green' : s === 'suspended' ? 'red' : 'orange'}>{s}</Tag>
          },
          { title: '账号配额', width: 120, render: (_, r: any) => `${r.currentAccounts ?? 0} / ${r.maxAccounts}` },
          { title: 'License 到期', dataIndex: 'licenseExpiresAt', width: 130, render: (d: string | null) =>
            d ? dayjs(d).format('YYYY-MM-DD') : <Text type="secondary">未绑定</Text>
          },
          { title: '创建时间', dataIndex: 'createdAt', width: 130, render: (d: string) => dayjs(d).format('MM-DD HH:mm') },
          { title: '操作', width: 200, render: (_, r: any) => (
            <Space size={4}>
              {r.status === 'active' && r.name !== 'default' && (
                <Button size="small" danger onClick={() => handleSuspend(r)}>暂停</Button>
              )}
              {r.status === 'suspended' && (
                <Button size="small" type="primary" onClick={() => handleResume(r)}>恢复</Button>
              )}
              {r.name !== 'default' && (
                <Button size="small" type="text" danger onClick={() => handleDelete(r)}>删除</Button>
              )}
            </Space>
          )},
        ]}
      />
      <Modal
        title="新建租户"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={handleCreate}
        okText="创建"
        cancelText="取消"
      >
        <div style={{ marginBottom: 12 }}>
          <Text strong>租户名称（公司名）</Text>
          <Input value={name} onChange={e => setName(e.target.value)} placeholder="例如：A 科技公司" style={{ marginTop: 4 }} />
        </div>
        <div>
          <Text strong>套餐</Text>
          <div style={{ marginTop: 4 }}>
            <Space.Compact>
              {['basic', 'pro', 'enterprise'].map(p => (
                <Button
                  key={p}
                  type={plan === p ? 'primary' : 'default'}
                  onClick={() => setPlan(p)}
                >
                  {p.toUpperCase()} ({p === 'basic' ? '10 号' : p === 'pro' ? '30 号' : '50 号'})
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
      const [l, t] = await Promise.all([adminApi.listLicenses(), adminApi.listTenants()]);
      setLicenses(l.data ?? []);
      setTenants(t.data ?? []);
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? '加载失败');
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
        title: '✅ License 签发成功',
        content: (
          <div>
            <p>License Key（请妥善保管）：</p>
            <Text code copyable style={{ fontSize: 13 }}>{key}</Text>
            {boundTenantId && <p style={{ marginTop: 12 }}>已直接绑定到租户「{tenants.find(t => t.id === boundTenantId)?.name}」</p>}
          </div>
        ),
      });
      setIssueOpen(false);
      setNotes('');
      setBoundTenantId(undefined);
      void load();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? '签发失败');
    }
  };

  const handleRevoke = (l: any) => {
    Modal.confirm({
      title: `撤销 License「${l.key}」？`,
      content: '撤销后该 license 不能再用于激活，已绑定的租户不受影响（除非也暂停租户）',
      okText: '撤销', okType: 'danger',
      onOk: async () => {
        try { await adminApi.revokeLicense(l.id); antdMessage.success('已撤销'); void load(); }
        catch (err: any) { antdMessage.error(err?.response?.data?.message ?? '撤销失败'); }
      },
    });
  };

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Button type="primary" onClick={() => setIssueOpen(true)}>+ 签发新 License</Button>
        <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>刷新</Button>
      </Space>
      <Table
        dataSource={licenses}
        rowKey="id"
        size="small"
        loading={loading}
        columns={[
          { title: 'License Key', dataIndex: 'key', render: (k: string) => <Text code copyable style={{ fontSize: 11 }}>{k}</Text> },
          { title: '套餐', dataIndex: 'plan', width: 100, render: (p: string) => <Tag color="blue">{p?.toUpperCase()}</Tag> },
          { title: '状态', dataIndex: 'status', width: 100, render: (s: string) => {
            const c = s === 'active' ? 'green' : s === 'pending' ? 'default' : s === 'revoked' ? 'red' : 'orange';
            return <Tag color={c}>{s}</Tag>;
          }},
          { title: '绑定租户', dataIndex: 'tenantId', width: 120, render: (tid: string | null) =>
            tid ? <Text>{tenants.find(t => t.id === tid)?.name ?? tid.slice(0, 8)}</Text> : <Text type="secondary">未绑定</Text>
          },
          { title: '到期', dataIndex: 'expiresAt', width: 110, render: (d: string | null) =>
            d ? dayjs(d).format('YYYY-MM-DD') : '-'
          },
          { title: '签发时间', dataIndex: 'createdAt', width: 130, render: (d: string) => dayjs(d).format('MM-DD HH:mm') },
          { title: '操作', width: 100, render: (_, r: any) => (
            r.status === 'active' || r.status === 'pending' ? (
              <Button size="small" danger onClick={() => handleRevoke(r)}>撤销</Button>
            ) : null
          )},
        ]}
      />
      <Modal
        title="签发新 License"
        open={issueOpen}
        onCancel={() => setIssueOpen(false)}
        onOk={handleIssue}
        okText="签发"
        cancelText="取消"
      >
        <div style={{ marginBottom: 12 }}>
          <Text strong>套餐</Text>
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
          <Text strong>直接绑定到租户（可选）</Text>
          <div style={{ marginTop: 4 }}>
            <select
              value={boundTenantId ?? ''}
              onChange={e => setBoundTenantId(e.target.value || undefined)}
              style={{ width: '100%', padding: 6, borderRadius: 4, border: '1px solid #d9d9d9' }}
            >
              <option value="">— 不绑定（让租户自助 /activate 激活）—</option>
              {tenants.map(t => <option key={t.id} value={t.id}>{t.name} ({t.plan})</option>)}
            </select>
          </div>
        </div>
        <div>
          <Text strong>备注</Text>
          <Input.TextArea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="例如：A 公司年度 license" style={{ marginTop: 4 }} />
        </div>
      </Modal>
    </div>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────
export default function AdminPage() {
  const [role, setRole] = useState<string>('OPERATOR');
  const [stats, setStats] = useState<any>({ totalTenants: 0, activeTenants: 0, suspendedTenants: 0, totalLicenses: 0, activeLicenses: 0, expiringIn30d: 0 });

  useEffect(() => {
    setRole(readUserRole());
    adminApi.stats().then(r => setStats(r.data)).catch(() => {});
  }, []);

  if (role !== 'SUPER_ADMIN') {
    return (
      <Result
        status="403"
        title="403"
        subTitle="你没有访问管理面板的权限。该页仅 SaaS 平台管理员可见。"
        extra={<Button type="primary" href="/">回到仪表盘</Button>}
      />
    );
  }

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <Title level={4} style={{ margin: 0 }}>
          <CrownOutlined style={{ marginRight: 8, color: '#faad14' }} />
          管理面板
          <Tag color="gold" style={{ marginLeft: 12, fontSize: 11 }}>SaaS Admin</Tag>
        </Title>
        <Text type="secondary">公司层级控制台 · 多租户管理 · License 签发 · 全局默认配置</Text>
      </div>

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}><Card><Statistic title="租户总数"     value={stats.totalTenants}     prefix={<TeamOutlined />} /></Card></Col>
        <Col span={6}><Card><Statistic title="活跃 License" value={stats.activeLicenses}   prefix={<SafetyCertificateOutlined />} /></Card></Col>
        <Col span={6}><Card><Statistic title="30 天内到期"   value={stats.expiringIn30d}    valueStyle={{ color: stats.expiringIn30d > 0 ? '#fa8c16' : undefined }} /></Card></Col>
        <Col span={6}><Card><Statistic title="已暂停"        value={stats.suspendedTenants} valueStyle={{ color: stats.suspendedTenants > 0 ? '#cf1322' : undefined }} /></Card></Col>
      </Row>

      <Card>
        <Tabs
          defaultActiveKey="tenants"
          items={[
            {
              key: 'tenants',
              label: <span><TeamOutlined /> 租户管理</span>,
              children: <TenantsTab />,
            },
            {
              key: 'licenses',
              label: <span><SafetyCertificateOutlined /> License 签发</span>,
              children: <LicensesTab />,
            },
            {
              key: 'platform-ai',
              label: <span><KeyOutlined /> 全局 AI 默认</span>,
              children: (
                <div>
                  <Alert
                    type="info"
                    showIcon
                    style={{ marginBottom: 16 }}
                    message="平台兜底 AI Key（公司付费）"
                    description="用于 FAQ 自动生成、文案优化、翻译等内部工具，租户没自配 key 时也可作为客户聊天兜底。当前在服务端 .env 中通过 PLATFORM_OPENAI_API_KEY / PLATFORM_DEEPSEEK_API_KEY 配置。"
                  />
                  <Empty description="后续从 .env 迁移到此可视化配置（含使用量/账单统计）" style={{ padding: 40 }} />
                </div>
              ),
            },
            {
              key: 'prompt-config',
              label: <span><FileTextOutlined /> Prompt 配置</span>,
              children: (
                <Tabs
                  size="small"
                  items={[
                    {
                      key: 'persona',
                      label: <span><RobotOutlined /> AI 客服人设</span>,
                      children: <GlobalPersonaTab />,
                    },
                    {
                      key: 'variant',
                      label: <span><FileTextOutlined /> 广告变体 Prompt</span>,
                      children: <VariantPromptTab />,
                    },
                    {
                      key: 'industry',
                      label: <span><RobotOutlined /> 行业话术</span>,
                      children: <IndustryPromptTab />,
                    },
                    {
                      key: 'handoff',
                      label: <span><TeamOutlined /> 转接话术</span>,
                      children: <HandoffNoticeTab />,
                    },
                  ]}
                />
              ),
            },
            {
              key: 'system',
              label: <span><ToolOutlined /> 系统监控</span>,
              children: (
                <Empty description="VPS 心跳 / License 校验 / 全局任务队列状态" style={{ padding: 40 }} />
              ),
            },
          ]}
        />
      </Card>
    </div>
  );
}
