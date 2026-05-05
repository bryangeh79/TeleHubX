import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Empty,
  Form,
  Image,
  Input,
  Modal,
  Popconfirm,
  Radio,
  Segmented,
  Select,
  Space,
  Spin,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  Upload,
  message as antdMessage,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  AudioOutlined,
  DatabaseOutlined,
  DeleteOutlined,
  FileOutlined,
  FileTextOutlined,
  PictureOutlined,
  PlusOutlined,
  ReloadOutlined,
  RobotOutlined,
  SaveOutlined,
  UndoOutlined,
  UploadOutlined,
  VideoCameraOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { MessageOutlined } from '@ant-design/icons';
import { assetsApi, platformConfigApi } from '../../services/api';
import ChatScriptsPage from '../chat-scripts/ChatScriptsPage';
import { useT } from '../../i18n';

const { Title, Text, Paragraph } = Typography;

type Category = 'photo' | 'video' | 'voice' | 'document' | 'text_snippet';

interface Asset {
  id: string;
  category: Category;
  fileName: string;
  mimeType: string | null;
  byteSize: number;
  textContent: string | null;
  tags: string[] | null;
  description: string | null;
  enabled: boolean;
  usageCount: number;
  createdAt: string;
  source?: 'builtin' | 'upload' | 'generated';
  poolName?: string | null;
  relativePath?: string | null;
}

type SourceFilter = 'tenant' | 'builtin';

function buildCatMeta(t: (k: string) => string): Record<Category, { label: string; icon: React.ReactNode; color: string }> {
  return {
    photo:        { label: t('as.cat.photo'),        icon: <PictureOutlined />,      color: 'blue' },
    video:        { label: t('as.cat.video'),        icon: <VideoCameraOutlined />,  color: 'purple' },
    voice:        { label: t('as.cat.voice'),        icon: <AudioOutlined />,        color: 'magenta' },
    document:     { label: t('as.cat.document'),     icon: <FileOutlined />,         color: 'cyan' },
    text_snippet: { label: t('as.cat.text_snippet'), icon: <FileTextOutlined />,     color: 'gold' },
  };
}

const fmtBytes = (n: number) => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
};

export default function AssetsPage() {
  const t = useT();
  const [outerTab, setOuterTab] = useState<'media' | 'scripts' | 'ad-faq'>('media');
  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>
          <DatabaseOutlined style={{ marginRight: 8 }} />
          {t('nav.assets')}
        </Title>
      </div>
      <Tabs
        activeKey={outerTab}
        onChange={(k) => setOuterTab(k as any)}
        items={[
          { key: 'media',   label: <Space size={4}><DatabaseOutlined />{t('as.tab.media')}</Space>,  children: <MediaSection /> },
          { key: 'scripts', label: <Space size={4}><MessageOutlined />{t('as.tab.scripts')}</Space>, children: <ChatScriptsPage embedded /> },
          { key: 'ad-faq',  label: <Space size={4}><RobotOutlined />{t('as.tab.adFaq')}</Space>,     children: <AdFaqSection /> },
        ]}
      />
    </div>
  );
}

// ── 广告话术设置 ─────────────────────────────────────────────────────────────
const { TextArea } = Input;

function AdFaqSection() {
  const t = useT();
  const [groupFaq, setGroupFaq] = useState('');
  const [privateDivert, setPrivateDivert] = useState('');
  const [origGroupFaq, setOrigGroupFaq] = useState('');
  const [origPrivateDivert, setOrigPrivateDivert] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await platformConfigApi.getAdFaq();
      setGroupFaq(res.data.groupFaq ?? '');
      setPrivateDivert(res.data.privateDivert ?? '');
      setOrigGroupFaq(res.data.groupFaq ?? '');
      setOrigPrivateDivert(res.data.privateDivert ?? '');
    } catch {
      antdMessage.error(t('as.adfaq.loadFail'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const dirty = groupFaq !== origGroupFaq || privateDivert !== origPrivateDivert;

  const handleSave = async () => {
    setSaving(true);
    try {
      await platformConfigApi.setAdFaq({ groupFaq, privateDivert });
      setOrigGroupFaq(groupFaq);
      setOrigPrivateDivert(privateDivert);
      antdMessage.success(t('as.adfaq.saveOk'));
    } catch {
      antdMessage.error(t('as.adfaq.saveFail'));
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    setSaving(true);
    try {
      const res = await platformConfigApi.resetAdFaq();
      setGroupFaq(res.data.groupFaq ?? '');
      setPrivateDivert(res.data.privateDivert ?? '');
      setOrigGroupFaq(res.data.groupFaq ?? '');
      setOrigPrivateDivert(res.data.privateDivert ?? '');
      antdMessage.success(t('as.adfaq.resetOk'));
    } catch {
      antdMessage.error(t('as.adfaq.resetFail'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>;
  }

  return (
    <div style={{ maxWidth: 720 }}>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 20 }}
        message={t('as.adfaq.alert.title')}
        description={
          <span>
            {t('as.adfaq.alert.line1')} {t('as.adfaq.alert.line2')}
          </span>
        }
      />

      <Card size="small" style={{ marginBottom: 16 }}>
        <Form layout="vertical">
          <Form.Item
            label={
              <Space>
                <strong>{t('as.adfaq.groupTitle')}</strong>
                {dirty && groupFaq !== origGroupFaq && <Tag color="orange">{t('as.adfaq.unsaved')}</Tag>}
              </Space>
            }
            extra={t('as.adfaq.groupExtra')}
          >
            <TextArea
              value={groupFaq}
              onChange={(e) => setGroupFaq(e.target.value)}
              autoSize={{ minRows: 3, maxRows: 8 }}
              placeholder={t('as.adfaq.groupPlaceholder')}
              maxLength={500}
              showCount
            />
          </Form.Item>

          <Form.Item
            label={
              <Space>
                <strong>{t('as.adfaq.privTitle')}</strong>
                {dirty && privateDivert !== origPrivateDivert && <Tag color="orange">{t('as.adfaq.unsaved')}</Tag>}
              </Space>
            }
            extra={t('as.adfaq.privExtra')}
          >
            <TextArea
              value={privateDivert}
              onChange={(e) => setPrivateDivert(e.target.value)}
              autoSize={{ minRows: 3, maxRows: 8 }}
              placeholder={t('as.adfaq.privPlaceholder')}
              maxLength={500}
              showCount
            />
          </Form.Item>
        </Form>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Tooltip title={t('as.adfaq.tooltipReset')}>
            <Button icon={<UndoOutlined />} onClick={handleReset} loading={saving}>
              {t('as.adfaq.btnReset')}
            </Button>
          </Tooltip>
          <Button
            type="primary"
            icon={<SaveOutlined />}
            onClick={handleSave}
            loading={saving}
            disabled={!dirty}
          >
            {t('as.adfaq.btnSave')}
          </Button>
        </div>
      </Card>

      <Card size="small" style={{ background: '#fffbe6' }}>
        <Text type="warning" style={{ fontSize: 12 }}>
          {t('as.adfaq.tip')}
        </Text>
      </Card>
    </div>
  );
}

function MediaSection() {
  const t = useT();
  const CAT_META = buildCatMeta(t);
  const [activeCat, setActiveCat] = useState<Category>('photo');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('tenant');
  const [poolFilter, setPoolFilter] = useState<string | undefined>();
  const [items, setItems] = useState<Asset[]>([]);
  const [pools, setPools] = useState<Array<{ poolName: string; category: Category; count: number }>>([]);
  const [loading, setLoading] = useState(false);
  const [snippetModalOpen, setSnippetModalOpen] = useState(false);
  const [snippetForm] = Form.useForm<{ text: string; tags?: string; description?: string }>();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = { category: activeCat };
      if (sourceFilter === 'builtin') params.source = 'builtin';
      if (poolFilter) params.poolName = poolFilter;
      const res = await assetsApi.list(params);
      setItems(Array.isArray(res.data) ? res.data : []);
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? t('as.loadFail'));
    } finally {
      setLoading(false);
    }
  }, [activeCat, sourceFilter, poolFilter, t]);

  const loadPools = useCallback(async () => {
    try {
      const res = await assetsApi.pools();
      setPools(Array.isArray(res.data) ? res.data : []);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void loadPools(); }, [loadPools]);
  useEffect(() => { setPoolFilter(undefined); }, [activeCat, sourceFilter]);

  const handleUpload = async (file: File) => {
    try {
      await assetsApi.upload(file, { category: activeCat });
      antdMessage.success(t('as.uploadOk', { name: file.name }));
      void load();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? t('as.uploadFail'));
    }
  };

  const handleCreateSnippet = async (values: any) => {
    try {
      const tags = values.tags ? values.tags.split(',').map((s: string) => s.trim()).filter(Boolean) : undefined;
      await assetsApi.createSnippet(values.text, tags, values.description);
      antdMessage.success(t('as.snippetOk'));
      setSnippetModalOpen(false);
      snippetForm.resetFields();
      void load();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? t('as.snippetFail'));
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await assetsApi.delete(id);
      void load();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? t('as.delFail'));
    }
  };

  const columns: ColumnsType<Asset> = [
    {
      title: t('as.col.preview'),
      key: 'preview',
      width: 100,
      render: (_, r) => {
        if (r.category === 'photo') {
          return <Image src={assetsApi.contentUrl(r.id)} width={60} height={60} style={{ objectFit: 'cover', borderRadius: 4 }} />;
        }
        if (r.category === 'video') {
          return <video src={assetsApi.contentUrl(r.id)} style={{ width: 80, height: 60, borderRadius: 4, background: '#000' }} />;
        }
        if (r.category === 'voice') {
          return <audio src={assetsApi.contentUrl(r.id)} controls style={{ width: 180, height: 32 }} />;
        }
        if (r.category === 'text_snippet') {
          return (
            <Text ellipsis style={{ maxWidth: 240 }}>{r.textContent ?? '—'}</Text>
          );
        }
        return CAT_META[r.category].icon;
      },
    },
    {
      title: t('as.col.nameContent'),
      dataIndex: 'fileName',
      key: 'fileName',
      render: (name: string, r) => (
        <div>
          <Space size={4}>
            <Text strong>{name}</Text>
            {r.source === 'builtin' && <Tag color="cyan" style={{ fontSize: 10 }}>{t('as.col.builtin')}</Tag>}
          </Space>
          {r.poolName && (
            <div><Tag color="purple" style={{ fontSize: 10, marginTop: 2 }}>{r.poolName}</Tag></div>
          )}
          {r.description && <div><Text type="secondary" style={{ fontSize: 12 }}>{r.description}</Text></div>}
          {r.tags?.length ? (
            <div style={{ marginTop: 4 }}>
              {r.tags.map((tg) => <Tag key={tg} style={{ fontSize: 10 }}>{tg}</Tag>)}
            </div>
          ) : null}
        </div>
      ),
    },
    { title: t('as.col.size'), dataIndex: 'byteSize', key: 'byteSize', width: 90, render: (n: number) => fmtBytes(n) },
    { title: t('as.col.usage'), dataIndex: 'usageCount', key: 'usageCount', width: 70 },
    {
      title: t('as.col.uploaded'), dataIndex: 'createdAt', key: 'createdAt', width: 130,
      render: (v: string) => dayjs(v).format('MM-DD HH:mm'),
    },
    {
      title: t('as.col.actions'), key: 'ops', width: 80,
      render: (_, r) => (
        r.source === 'builtin' ? (
          <Tag color="default" style={{ fontSize: 10 }}>{t('as.tag.readonly')}</Tag>
        ) : (
          <Popconfirm title={t('as.delConfirm')} onConfirm={() => handleDelete(r.id)}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        )
      ),
    },
  ];

  const poolsForActiveCat = pools.filter((p) => p.category === activeCat);

  return (
    <div>
      <Card>
        <Tabs
          activeKey={activeCat}
          onChange={(k) => setActiveCat(k as Category)}
          items={(Object.keys(CAT_META) as Category[]).map((c) => ({
            key: c,
            label: <Space size={4}>{CAT_META[c].icon}{CAT_META[c].label}</Space>,
            children: null,
          }))}
        />

        <Space style={{ marginBottom: 12 }} wrap>
          <Segmented
            value={sourceFilter}
            onChange={(v) => setSourceFilter(v as SourceFilter)}
            options={[
              { label: t('as.scope.tenant'), value: 'tenant' },
              { label: t('as.scope.builtin', { count: pools.reduce((s, p) => s + p.count, 0) }), value: 'builtin' },
            ]}
          />
          {sourceFilter === 'builtin' && poolsForActiveCat.length > 0 && (
            <Select
              allowClear
              placeholder={t('as.poolFilter')}
              value={poolFilter}
              onChange={(v) => setPoolFilter(v)}
              style={{ width: 280 }}
              options={poolsForActiveCat.map((p) => ({
                value: p.poolName,
                label: `${p.poolName} (${p.count})`,
              }))}
            />
          )}
          {sourceFilter === 'tenant' && (
            activeCat !== 'text_snippet' ? (
              <Upload
                showUploadList={false}
                beforeUpload={(file) => { void handleUpload(file as File); return false; }}
                accept={
                  activeCat === 'photo' ? 'image/*' :
                  activeCat === 'video' ? 'video/*' :
                  activeCat === 'voice' ? 'audio/*,.ogg,.opus' :
                  undefined
                }
              >
                <Button type="primary" icon={<UploadOutlined />}>{t('as.btnUpload', { category: CAT_META[activeCat].label })}</Button>
              </Upload>
            ) : (
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setSnippetModalOpen(true)}>
                {t('as.btnNewSnippet')}
              </Button>
            )
          )}
          <Button icon={<ReloadOutlined />} onClick={() => void load()}>{t('as.btnRefresh')}</Button>
        </Space>

        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message={
            activeCat === 'voice' ? t('as.hint.voice') :
            activeCat === 'photo' ? t('as.hint.photo') :
            activeCat === 'video' ? t('as.hint.video') :
            activeCat === 'text_snippet' ? t('as.hint.text') :
            t('as.hint.doc')
          }
        />

        <Table
          dataSource={items}
          columns={columns}
          rowKey="id"
          size="small"
          loading={loading}
          pagination={{ pageSize: 20, showSizeChanger: false }}
          locale={{ emptyText: <Empty description={t('as.empty', { category: CAT_META[activeCat].label })} /> }}
        />
      </Card>

      <Modal
        title={t('as.snippet.modalTitle')}
        open={snippetModalOpen}
        onCancel={() => setSnippetModalOpen(false)}
        onOk={() => snippetForm.submit()}
        destroyOnClose
      >
        <Form form={snippetForm} layout="vertical" onFinish={handleCreateSnippet}>
          <Form.Item name="text" label={t('as.snippet.text')} rules={[{ required: true }]}>
            <Input.TextArea rows={4} placeholder={t('as.snippet.textPlaceholder')} />
          </Form.Item>
          <Form.Item name="tags" label={t('as.snippet.tags')} extra={t('as.snippet.tagsExtra')}>
            <Input placeholder={t('as.snippet.tagsPlaceholder')} />
          </Form.Item>
          <Form.Item name="description" label={t('as.snippet.descLabel')}>
            <Input placeholder={t('as.snippet.descPlaceholder')} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
