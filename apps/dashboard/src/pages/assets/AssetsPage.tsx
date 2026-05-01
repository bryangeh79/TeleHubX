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
  Table,
  Tabs,
  Tag,
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
  UploadOutlined,
  VideoCameraOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { assetsApi } from '../../services/api';

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
      <div style={{ marginBottom: 20 }}>
        <Title level={4} style={{ margin: 0 }}>
          <DatabaseOutlined style={{ marginRight: 8 }} />
          素材库
        </Title>
        <Text type="secondary">
          为 MEDIA_PHOTO / MEDIA_VIDEO / MEDIA_VOICE 任务提供素材池，执行时随机抽取。
          也可存"文本片段"作为开场白模板。
        </Text>
      </div>

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
