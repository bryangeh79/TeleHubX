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

const CAT_META: Record<Category, { label: string; icon: React.ReactNode; color: string }> = {
  photo:        { label: '图片',     icon: <PictureOutlined />,      color: 'blue' },
  video:        { label: '视频',     icon: <VideoCameraOutlined />,  color: 'purple' },
  voice:        { label: '语音',     icon: <AudioOutlined />,        color: 'magenta' },
  document:     { label: '文档',     icon: <FileOutlined />,         color: 'cyan' },
  text_snippet: { label: '文本片段', icon: <FileTextOutlined />,     color: 'gold' },
};

const fmtBytes = (n: number) => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
};

export default function AssetsPage() {
  const [outerTab, setOuterTab] = useState<'media' | 'scripts' | 'ad-faq'>('media');
  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>
          <DatabaseOutlined style={{ marginRight: 8 }} />
          素材库
        </Title>
        <Text type="secondary">
          统一管理 媒体素材 (图片/视频/语音/文档/文本) + 聊天剧本包 + 广告号话术。
        </Text>
      </div>
      <Tabs
        activeKey={outerTab}
        onChange={(k) => setOuterTab(k as any)}
        items={[
          { key: 'media',   label: <Space size={4}><DatabaseOutlined />媒体素材</Space>,  children: <MediaSection /> },
          { key: 'scripts', label: <Space size={4}><MessageOutlined />聊天剧本</Space>,   children: <ChatScriptsPage embedded /> },
          { key: 'ad-faq',  label: <Space size={4}><RobotOutlined />广告话术</Space>,     children: <AdFaqSection /> },
        ]}
      />
    </div>
  );
}

// ── 广告话术设置 ─────────────────────────────────────────────────────────────
const { TextArea } = Input;

function AdFaqSection() {
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
      antdMessage.error('加载广告话术失败');
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
      antdMessage.success('已保存，约 30 秒后广告号生效');
    } catch {
      antdMessage.error('保存失败');
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
      antdMessage.success('已恢复为默认话术');
    } catch {
      antdMessage.error('重置失败');
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
        message="广告号（ad role）自动话术配置"
        description={
          <span>
            当有人私聊广告号、或在群里 @ 广告号时，系统会自动回这里设置的话术。
            保存后约 <strong>30 秒</strong>生效（agent 同步周期）。
          </span>
        }
      />

      <Card size="small" style={{ marginBottom: 16 }}>
        <Form layout="vertical">
          <Form.Item
            label={
              <Space>
                <strong>群内 FAQ（被 @ 时回复）</strong>
                {dirty && groupFaq !== origGroupFaq && <Tag color="orange">未保存</Tag>}
              </Space>
            }
            extra="当广告号在群里被 @ 提及时，自动回复这段话。建议简短，引导用户私信 Bot。"
          >
            <TextArea
              value={groupFaq}
              onChange={(e) => setGroupFaq(e.target.value)}
              autoSize={{ minRows: 3, maxRows: 8 }}
              placeholder={'例如：\n有什么问题可以私信我们的客服 Bot 哦 👉 @YourBot\n我们 24 小时在线为您服务！'}
              maxLength={500}
              showCount
            />
          </Form.Item>

          <Form.Item
            label={
              <Space>
                <strong>私聊引流话术（有人 DM 时回复）</strong>
                {dirty && privateDivert !== origPrivateDivert && <Tag color="orange">未保存</Tag>}
              </Space>
            }
            extra="当有人直接私信广告号时，自动回复这段话把用户引流到客服 Bot。"
          >
            <TextArea
              value={privateDivert}
              onChange={(e) => setPrivateDivert(e.target.value)}
              autoSize={{ minRows: 3, maxRows: 8 }}
              placeholder={'例如：\n嗨！感谢您的消息 😊\n如需了解详情或咨询，请联系我们的客服：@YourBot\n我们会尽快为您解答！'}
              maxLength={500}
              showCount
            />
          </Form.Item>
        </Form>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Tooltip title="恢复系统默认话术（英文兜底）">
            <Button icon={<UndoOutlined />} onClick={handleReset} loading={saving}>
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
      </Card>

      <Card size="small" style={{ background: '#fffbe6' }}>
        <Text type="warning" style={{ fontSize: 12 }}>
          💡 <strong>使用建议</strong>：话术里建议写上你的客服 Bot 用户名（如 @YourBot），
          引导客户通过 Bot 咨询，广告号只做引流不直接服务客户。
          支持 Emoji 和换行，最多 500 字。
        </Text>
      </Card>
    </div>
  );
}

function MediaSection() {
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
      antdMessage.error(err?.response?.data?.message ?? '加载失败');
    } finally {
      setLoading(false);
    }
  }, [activeCat, sourceFilter, poolFilter]);

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
      antdMessage.success(`已上传 ${file.name}`);
      void load();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? '上传失败');
    }
  };

  const handleCreateSnippet = async (values: any) => {
    try {
      const tags = values.tags ? values.tags.split(',').map((t: string) => t.trim()).filter(Boolean) : undefined;
      await assetsApi.createSnippet(values.text, tags, values.description);
      antdMessage.success('文本片段已添加');
      setSnippetModalOpen(false);
      snippetForm.resetFields();
      void load();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? '添加失败');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await assetsApi.delete(id);
      void load();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? '删除失败');
    }
  };

  const columns: ColumnsType<Asset> = [
    {
      title: '预览',
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
      title: '文件名 / 内容',
      dataIndex: 'fileName',
      key: 'fileName',
      render: (name: string, r) => (
        <div>
          <Space size={4}>
            <Text strong>{name}</Text>
            {r.source === 'builtin' && <Tag color="cyan" style={{ fontSize: 10 }}>内置</Tag>}
          </Space>
          {r.poolName && (
            <div><Tag color="purple" style={{ fontSize: 10, marginTop: 2 }}>{r.poolName}</Tag></div>
          )}
          {r.description && <div><Text type="secondary" style={{ fontSize: 12 }}>{r.description}</Text></div>}
          {r.tags?.length ? (
            <div style={{ marginTop: 4 }}>
              {r.tags.map((t) => <Tag key={t} style={{ fontSize: 10 }}>{t}</Tag>)}
            </div>
          ) : null}
        </div>
      ),
    },
    { title: '大小', dataIndex: 'byteSize', key: 'byteSize', width: 90, render: (n: number) => fmtBytes(n) },
    { title: '用过', dataIndex: 'usageCount', key: 'usageCount', width: 70 },
    {
      title: '上传时间', dataIndex: 'createdAt', key: 'createdAt', width: 130,
      render: (v: string) => dayjs(v).format('MM-DD HH:mm'),
    },
    {
      title: '操作', key: 'ops', width: 80,
      render: (_, r) => (
        r.source === 'builtin' ? (
          <Tag color="default" style={{ fontSize: 10 }}>只读</Tag>
        ) : (
          <Popconfirm title="确认删除？" onConfirm={() => handleDelete(r.id)}>
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
              { label: '我的素材', value: 'tenant' },
              { label: `内置素材库（${pools.reduce((s, p) => s + p.count, 0)}）`, value: 'builtin' },
            ]}
          />
          {sourceFilter === 'builtin' && poolsForActiveCat.length > 0 && (
            <Select
              allowClear
              placeholder="按 pool 过滤"
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
                <Button type="primary" icon={<UploadOutlined />}>上传 {CAT_META[activeCat].label}</Button>
              </Upload>
            ) : (
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setSnippetModalOpen(true)}>
                新建文本片段
              </Button>
            )
          )}
          <Button icon={<ReloadOutlined />} onClick={() => void load()}>刷新</Button>
        </Space>

        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message={
            activeCat === 'voice' ? '建议 ogg/opus 格式（TG 语音消息原生）。MP3/M4A 也支持但会被当文档发送。' :
            activeCat === 'photo' ? '建议 JPG/PNG/WebP，最大 10MB，分辨率 ≤ 4096x4096。' :
            activeCat === 'video' ? '建议 MP4 H.264，最大 50MB。' :
            activeCat === 'text_snippet' ? '占位符 {tenantName} / {botName} 在执行时会自动替换。' :
            '通用文档（PDF/DOC/ZIP 等），最大 50MB。'
          }
        />

        <Table
          dataSource={items}
          columns={columns}
          rowKey="id"
          size="small"
          loading={loading}
          pagination={{ pageSize: 20, showSizeChanger: false }}
          locale={{ emptyText: <Empty description={`尚无${CAT_META[activeCat].label}素材`} /> }}
        />
      </Card>

      <Modal
        title="新建文本片段"
        open={snippetModalOpen}
        onCancel={() => setSnippetModalOpen(false)}
        onOk={() => snippetForm.submit()}
        destroyOnClose
      >
        <Form form={snippetForm} layout="vertical" onFinish={handleCreateSnippet}>
          <Form.Item name="text" label="文本内容" rules={[{ required: true }]}>
            <Input.TextArea rows={4} placeholder="支持占位符 {tenantName} / {botName}" />
          </Form.Item>
          <Form.Item name="tags" label="标签（逗号分隔）" extra="如：开场白,中文,产品A">
            <Input placeholder="开场白,中文" />
          </Form.Item>
          <Form.Item name="description" label="描述（可选）">
            <Input placeholder="一行描述用途" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
