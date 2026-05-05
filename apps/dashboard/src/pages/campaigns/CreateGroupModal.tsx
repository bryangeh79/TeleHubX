import { useEffect, useRef, useState } from 'react';
import {
  Alert, Button, Col, Divider, Input, InputNumber,
  Modal, Row, Select, Space, Switch, Tabs, Tag, Typography,
  message as antdMessage,
} from 'antd';
import {
  FileExcelOutlined, FilterOutlined, FolderOpenOutlined,
  PlusOutlined, ThunderboltOutlined, UploadOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { customerGroupsApi } from '../../services/api';
import { useT } from '../../i18n';

const { Text, Title } = Typography;
const { TextArea } = Input;

interface Props {
  open: boolean;
  tenantId: string;
  existingGroups: Array<{ id: string; name: string; memberCount: number }>;
  onClose: () => void;
  onSuccess: () => void;
}

type Mode = 'new' | 'append';
type SourceTab = 'paste' | 'excel' | 'candidates';

interface HuntTask { huntTaskId: string; count: number; firstSeen: string }

export default function CreateGroupModal({ open, tenantId, existingGroups, onClose, onSuccess }: Props) {
  const t = useT();
  const [mode, setMode] = useState<Mode>('new');
  const [tab, setTab] = useState<SourceTab>('paste');

  // 新建模式字段
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  // 追加模式字段
  const [appendToId, setAppendToId] = useState<string>('');

  // 粘贴号码
  const [pasteText, setPasteText] = useState('');

  // Excel/CSV
  const [csvText, setCsvText] = useState<string>(''); // 解析后的号码列表 join('\n')
  const [csvFileName, setCsvFileName] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 候选池筛选
  const [huntTasks, setHuntTasks] = useState<HuntTask[]>([]);
  const [filterHuntTaskId, setFilterHuntTaskId] = useState<string | undefined>();
  const [filterMinScore, setFilterMinScore] = useState<number>(50);
  const [filterPremium, setFilterPremium] = useState(false);
  const [filterActiveDays, setFilterActiveDays] = useState<number>(30);
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [previewSamples, setPreviewSamples] = useState<any[]>([]);
  const [previewing, setPreviewing] = useState(false);

  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setMode('new'); setTab('paste'); setName(''); setDescription('');
      setAppendToId(''); setPasteText(''); setCsvText(''); setCsvFileName('');
      setPreviewCount(null); setPreviewSamples([]);
      return;
    }
    if (tenantId) {
      customerGroupsApi.listHuntTasks(tenantId).then(r => setHuntTasks(r.data ?? [])).catch(() => {});
    }
  }, [open, tenantId]);

  // 候选池筛选预览（debounced）
  useEffect(() => {
    if (!open || tab !== 'candidates' || !tenantId) return;
    setPreviewing(true);
    const t = setTimeout(() => {
      customerGroupsApi.candidatePreview({
        tenantId,
        huntTaskId: filterHuntTaskId,
        minPriorityScore: filterMinScore,
        onlyPremium: filterPremium ? 'true' : undefined,
        activeWithinDays: filterActiveDays,
      }).then(r => {
        setPreviewCount(r.data.count ?? 0);
        setPreviewSamples(r.data.samples ?? []);
      }).catch(() => { setPreviewCount(null); setPreviewSamples([]); })
        .finally(() => setPreviewing(false));
    }, 400);
    return () => clearTimeout(t);
  }, [open, tab, tenantId, filterHuntTaskId, filterMinScore, filterPremium, filterActiveDays]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvFileName(file.name);
    try {
      const text = await file.text();
      // 简易解析：按行分，取第 1 列（逗号或制表符分隔）
      const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      // 跳过 header（如果第 1 行不是号码格式）
      const firstCol = (l: string) => l.split(/[,\t]/)[0]?.trim() ?? '';
      const allCols = lines.map(firstCol).filter(Boolean);
      const isHeader = allCols[0] && /^[a-z_]+$/i.test(allCols[0]);
      const rows = isHeader ? allCols.slice(1) : allCols;
      setCsvText(rows.join('\n'));
      antdMessage.success(`已读取 ${rows.length} 行（点下一步预览）`);
    } catch {
      antdMessage.error('文件解析失败');
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const collectMembers = (): string[] => {
    const raw = tab === 'paste' ? pasteText : tab === 'excel' ? csvText : '';
    return raw.split(/[\n,;]+/).map(v => v.trim()).filter(Boolean);
  };

  const handleSubmit = async (createEmpty = false) => {
    // 校验
    if (mode === 'new' && !name.trim()) { antdMessage.warning('请填写客户群名称'); return; }
    if (mode === 'append' && !appendToId) { antdMessage.warning('请选择目标客户群'); return; }

    setSubmitting(true);
    try {
      // 候选池路径
      if (tab === 'candidates' && mode === 'new') {
        const res = await customerGroupsApi.createFromCandidates({
          tenantId,
          name: name.trim(),
          description: description || undefined,
          huntTaskId: filterHuntTaskId,
          minPriorityScore: filterMinScore,
          onlyPremium: filterPremium,
          activeWithinDays: filterActiveDays,
        });
        antdMessage.success(`✓ 已建群「${res.data.name}」· ${res.data.memberCount} 人`);
        onSuccess();
        return;
      }

      // 候选池追加
      if (tab === 'candidates' && mode === 'append') {
        // 先 preview 拿候选 → append
        antdMessage.info('从候选池追加暂未实现，请用「从候选池新建」');
        return;
      }

      const members = createEmpty ? [] : collectMembers();

      if (!createEmpty && members.length === 0 && tab !== 'candidates') {
        antdMessage.warning('没有有效号码');
        return;
      }

      if (mode === 'new') {
        const res = await customerGroupsApi.create({
          tenantId,
          name: name.trim(),
          description: description || undefined,
          members,
        });
        antdMessage.success(`✓ 已建群「${res.data.name}」· ${res.data.memberCount} 人`);
      } else {
        // append
        const items = members.map(value => ({ value, source: 'manual' as const }));
        const res = await customerGroupsApi.appendMembers(appendToId, items);
        antdMessage.success(`✓ 已追加 ${res.data.added} 人${res.data.skipped ? `，跳过 ${res.data.skipped} 重复` : ''}`);
      }
      onSuccess();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? '操作失败');
    } finally {
      setSubmitting(false);
    }
  };

  const ModeCard = ({ value, icon, title, sub }: { value: Mode; icon: React.ReactNode; title: string; sub: string }) => (
    <div
      onClick={() => setMode(value)}
      style={{
        flex: 1, border: `1px solid ${mode === value ? '#52c41a' : '#d9d9d9'}`,
        background: mode === value ? '#f6ffed' : '#fff',
        borderRadius: 8, padding: 16, cursor: 'pointer', textAlign: 'center',
      }}
    >
      <div style={{ fontSize: 22, color: mode === value ? '#52c41a' : '#999', marginBottom: 4 }}>{icon}</div>
      <div style={{ fontWeight: 500, fontSize: 13 }}>{title}</div>
      <Text type="secondary" style={{ fontSize: 11 }}>{sub}</Text>
    </div>
  );

  return (
    <Modal
      open={open}
      title={t('campaign.group.createTitle')}
      onCancel={onClose}
      width={680}
      footer={
        <Space style={{ justifyContent: 'space-between', width: '100%' }}>
          <Space>
            <Button onClick={onClose}>{t('common.cancel')}</Button>
            {mode === 'new' && tab !== 'candidates' && (
              <Button onClick={() => handleSubmit(true)} loading={submitting}>
                {t('campaign.group.createEmpty')}
              </Button>
            )}
          </Space>
          <Button type="primary" loading={submitting} onClick={() => handleSubmit(false)}
            style={{ background: '#52c41a', borderColor: '#52c41a' }}>
            {tab === 'candidates' ? `${t('common.create')} (${previewCount ?? 0})` : t('common.save')}
          </Button>
        </Space>
      }
    >
      {/* Step 1: mode */}
      <Title level={5} style={{ fontSize: 14 }}>1. 选择目标客户群</Title>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <ModeCard value="new" icon={<PlusOutlined />} title={t('campaign.group.modeNew')} sub="" />
        <ModeCard value="append" icon={<FolderOpenOutlined />} title={t('campaign.group.modeAppend')} sub="" />
      </div>

      {mode === 'new' ? (
        <>
          <Input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="新组名称 · 例如: 618 促销客户"
            maxLength={128} showCount
            style={{ marginBottom: 8 }}
          />
          <TextArea
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="描述 (可选) · 例如: 2026-04 电信广告目标"
            rows={2}
          />
        </>
      ) : (
        <Select
          style={{ width: '100%' }}
          placeholder="选择已有客户群"
          value={appendToId || undefined}
          onChange={setAppendToId}
          options={existingGroups.map(g => ({
            value: g.id,
            label: `${g.name} (${g.memberCount} 人)`,
          }))}
        />
      )}

      <Divider style={{ margin: '16px 0 8px' }} />

      {/* Step 2: source */}
      <Title level={5} style={{ fontSize: 14 }}>2. 添加号码 · 选一种方式</Title>
      <Tabs
        activeKey={tab}
        onChange={k => setTab(k as SourceTab)}
        items={[
          { key: 'paste', label: '粘贴号码' },
          { key: 'excel', label: <span><FileExcelOutlined /> Excel / CSV 文件</span> },
          { key: 'candidates', label: <span><FilterOutlined /> 从候选池筛选</span>, disabled: mode === 'append' },
        ]}
      />

      {tab === 'paste' && (
        <>
          <Text type="secondary" style={{ fontSize: 11 }}>
            一行一个号码 · 或逗号 / 空格分隔均可。系统自动规范化 + 去重。
          </Text>
          <TextArea
            rows={6}
            value={pasteText}
            onChange={e => setPasteText(e.target.value)}
            placeholder={'60186888168\n60168160836\n+60123456789\n@username'}
            style={{ marginTop: 6, fontFamily: 'monospace', fontSize: 12 }}
          />
        </>
      )}

      {tab === 'excel' && (
        <>
          <Alert
            type="info" showIcon
            message="支持 .xlsx / .csv / .txt / .tsv · 第 1 列是号码，可含表头 phone/name/tag"
            style={{ marginBottom: 8, fontSize: 12 }}
          />
          <input ref={fileInputRef} type="file" accept=".csv,.txt,.tsv" style={{ display: 'none' }}
            onChange={handleFileChange} />
          <div
            onClick={() => fileInputRef.current?.click()}
            style={{
              border: '2px dashed #d9d9d9', borderRadius: 8, padding: 30, textAlign: 'center',
              cursor: 'pointer', background: '#fafafa',
            }}
          >
            <UploadOutlined style={{ fontSize: 32, color: '#52c41a' }} />
            <div style={{ marginTop: 8 }}>{csvFileName || '点击或拖拽文件到此处'}</div>
            <Text type="secondary" style={{ fontSize: 11 }}>.csv / .txt / .tsv 都支持（.xlsx 暂未实现）</Text>
          </div>
          {csvText && (
            <div style={{ marginTop: 8 }}>
              <Text type="secondary" style={{ fontSize: 11 }}>
                解析得到 {csvText.split('\n').filter(Boolean).length} 行
              </Text>
            </div>
          )}
        </>
      )}

      {tab === 'candidates' && (
        <>
          <Alert
            type="info" showIcon
            message="从「关键词智能引流」收集到的候选人池筛选并打包成客户群"
            style={{ marginBottom: 12, fontSize: 12 }}
          />
          <Row gutter={12}>
            <Col span={12}>
              <Text style={{ fontSize: 12 }}>来源任务 (可选)</Text>
              <Select
                style={{ width: '100%', marginTop: 4 }}
                placeholder="不选 = 全部候选池"
                value={filterHuntTaskId}
                onChange={setFilterHuntTaskId}
                allowClear
                options={huntTasks.map(t => ({
                  value: t.huntTaskId,
                  label: `任务 #${t.huntTaskId.slice(0, 8)} · ${t.count} 候选 · ${dayjs(t.firstSeen).format('M/D')}`,
                }))}
              />
            </Col>
            <Col span={12}>
              <Text style={{ fontSize: 12 }}>最低 priorityScore</Text>
              <InputNumber
                style={{ width: '100%', marginTop: 4 }}
                value={filterMinScore}
                onChange={v => setFilterMinScore(v ?? 0)}
                min={0} max={100}
              />
            </Col>
            <Col span={12} style={{ marginTop: 8 }}>
              <Text style={{ fontSize: 12 }}>近 N 天活跃过</Text>
              <InputNumber
                style={{ width: '100%', marginTop: 4 }}
                value={filterActiveDays}
                onChange={v => setFilterActiveDays(v ?? 30)}
                min={0} max={365}
                addonAfter="天"
              />
            </Col>
            <Col span={12} style={{ marginTop: 8 }}>
              <Text style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>仅 Premium 用户</Text>
              <Switch checked={filterPremium} onChange={setFilterPremium}
                style={{ background: filterPremium ? '#52c41a' : undefined }} />
              <Text type="secondary" style={{ fontSize: 11, marginLeft: 8 }}>转化率更高，但人数少</Text>
            </Col>
          </Row>

          <Divider style={{ margin: '12px 0 8px' }} />
          <div style={{ background: '#f6ffed', padding: 12, borderRadius: 6, border: '1px solid #b7eb8f' }}>
            <Space>
              <ThunderboltOutlined style={{ color: '#52c41a', fontSize: 18 }} />
              <Text strong style={{ fontSize: 14 }}>
                {previewing ? '计算中…' : `匹配 ${previewCount ?? 0} 个候选人`}
              </Text>
            </Space>
            {previewSamples.length > 0 && (
              <div style={{ marginTop: 8, fontSize: 11 }}>
                <Text type="secondary">示例：</Text>
                {previewSamples.slice(0, 3).map((s, i) => (
                  <Tag key={i} style={{ fontSize: 10, marginLeft: 4 }}>
                    {s.phone || (s.tgUsername ? `@${s.tgUsername}` : s.tgUserId)}
                    {s.isPremium && ' ⭐'}
                  </Tag>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </Modal>
  );
}
