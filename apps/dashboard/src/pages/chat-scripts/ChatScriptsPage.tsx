import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button,
  Card,
  Col,
  Drawer,
  Empty,
  Input,
  Row,
  Select,
  Space,
  Statistic,
  Tag,
  Typography,
  message as antdMessage,
} from 'antd';
import {
  AudioOutlined,
  FileImageOutlined,
  MessageOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  SearchOutlined,
  UserOutlined,
  VideoCameraOutlined,
} from '@ant-design/icons';
import { chatScriptsApi } from '../../services/api';

const { Title, Text, Paragraph } = Typography;

interface ScriptLine {
  roleLabel: 'A' | 'B' | 'C' | 'D';
  text: string;
  delayAfterMs: number;
}

interface RawTurn {
  turn: number;
  role: 'A' | 'B' | 'C' | 'D';
  type?: 'text' | 'voice' | 'image' | 'video';
  content_pool?: string[];
  caption_pool?: string[];
  asset_pool?: string;
  send_delay_sec?: [number, number];
  caption_fallback?: string;
}

interface RawSession {
  name: string;
  delay_from_start?: string;
  turns: RawTurn[];
}

interface ChatScript {
  id: string;
  name: string;
  type: 'A+B' | 'A+B+C+D';
  minRound: number;
  maxRound: number;
  packId: string | null;
  category: string | null;
  status: string;
  executedCount: number;
  lines: ScriptLine[];
  rawScript: { sessions?: RawSession[] } | null;
  createdAt: string;
}

const ROLE_COLOR: Record<string, string> = {
  A: '#1677ff', B: '#52c41a', C: '#fa8c16', D: '#eb2f96',
};

function turnIcon(type?: string) {
  if (type === 'voice') return <AudioOutlined />;
  if (type === 'image') return <FileImageOutlined />;
  if (type === 'video') return <VideoCameraOutlined />;
  return <MessageOutlined />;
}

export default function ChatScriptsPage() {
  const [scripts, setScripts] = useState<ChatScript[]>([]);
  const [loading, setLoading] = useState(false);
  const [filterType, setFilterType] = useState<string | undefined>();
  const [filterCategory, setFilterCategory] = useState<string | undefined>();
  const [search, setSearch] = useState('');
  const [detail, setDetail] = useState<ChatScript | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await chatScriptsApi.list({ type: filterType });
      setScripts(Array.isArray(res.data) ? res.data : []);
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? '加载剧本失败');
    } finally {
      setLoading(false);
    }
  }, [filterType]);

  useEffect(() => { void reload(); }, [reload]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const s of scripts) if (s.category) set.add(s.category);
    return Array.from(set).sort();
  }, [scripts]);

  const filtered = useMemo(() => {
    return scripts.filter((s) => {
      if (filterCategory && s.category !== filterCategory) return false;
      if (search && !s.name.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [scripts, filterCategory, search]);

  const stats = useMemo(() => {
    const total = scripts.length;
    const ab = scripts.filter((s) => s.type === 'A+B').length;
    const abcd = scripts.filter((s) => s.type === 'A+B+C+D').length;
    const builtin = scripts.filter((s) => s.packId).length;
    return { total, ab, abcd, builtin };
  }, [scripts]);

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <Title level={4} style={{ margin: 0 }}>
          <MessageOutlined style={{ marginRight: 8 }} />
          聊天剧本库
        </Title>
        <Text type="secondary">
          chat_script_ab / chat_script_4p 任务从这里随机抽取剧本。
          每个剧本的 content_pool 在执行时随机抽变体（一脚本 N 种执行）。
        </Text>
      </div>

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}><Card size="small"><Statistic title="总剧本" value={stats.total} /></Card></Col>
        <Col span={6}><Card size="small"><Statistic title="A+B 双人" value={stats.ab} valueStyle={{ color: '#1677ff' }} /></Card></Col>
        <Col span={6}><Card size="small"><Statistic title="A+B+C+D 四人" value={stats.abcd} valueStyle={{ color: '#eb2f96' }} /></Card></Col>
        <Col span={6}><Card size="small"><Statistic title="WAhubX 复用" value={stats.builtin} valueStyle={{ color: '#52c41a' }} /></Card></Col>
      </Row>

      <Card>
        <Space style={{ marginBottom: 12 }} wrap>
          <Input
            prefix={<SearchOutlined />}
            placeholder="按名称搜索"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: 200 }}
            allowClear
          />
          <Select
            allowClear
            placeholder="全部类型"
            value={filterType}
            onChange={(v) => setFilterType(v)}
            style={{ width: 140 }}
            options={[
              { value: 'A+B', label: 'A+B 双人' },
              { value: 'A+B+C+D', label: 'A+B+C+D 四人' },
            ]}
          />
          <Select
            allowClear
            placeholder="全部分类"
            value={filterCategory}
            onChange={(v) => setFilterCategory(v)}
            style={{ width: 200 }}
            options={categories.map((c) => ({ value: c, label: c }))}
          />
          <Button icon={<ReloadOutlined />} onClick={() => void reload()} loading={loading}>刷新</Button>
        </Space>

        {filtered.length === 0 ? (
          <Empty description="无匹配剧本" />
        ) : (
          <Row gutter={[12, 12]}>
            {filtered.map((s) => {
              const turnCount = s.rawScript?.sessions?.reduce(
                (sum, sess) => sum + (sess.turns?.length ?? 0), 0,
              ) ?? s.lines.length;
              const sample = s.rawScript?.sessions?.[0]?.turns?.[0]?.content_pool?.[0] ?? s.lines[0]?.text ?? '';
              return (
                <Col key={s.id} xs={24} md={12} lg={8} xl={6}>
                  <Card
                    size="small"
                    hoverable
                    onClick={() => setDetail(s)}
                    style={{ cursor: 'pointer' }}
                  >
                    <Space size={6} style={{ marginBottom: 6 }}>
                      <Tag color={s.type === 'A+B' ? 'blue' : 'magenta'}>{s.type}</Tag>
                      {s.category && <Tag color="default" style={{ fontSize: 10 }}>{s.category}</Tag>}
                      {s.packId && <Tag color="cyan" style={{ fontSize: 10 }}>📦 {s.packId.split('_').slice(-2).join('_')}</Tag>}
                    </Space>
                    <Text strong style={{ fontSize: 13, display: 'block' }}>{s.name}</Text>
                    <Paragraph
                      type="secondary"
                      ellipsis={{ rows: 2 }}
                      style={{ margin: '6px 0 0 0', fontSize: 12 }}
                    >
                      {sample}
                    </Paragraph>
                    <Space size={8} style={{ marginTop: 6 }}>
                      <Text type="secondary" style={{ fontSize: 11 }}>{turnCount} 回合</Text>
                      <Text type="secondary" style={{ fontSize: 11 }}>· 跑过 {s.executedCount} 次</Text>
                    </Space>
                  </Card>
                </Col>
              );
            })}
          </Row>
        )}
      </Card>

      <Drawer
        title={
          detail && (
            <Space>
              <PlayCircleOutlined />
              <span>{detail.name}</span>
              <Tag color={detail.type === 'A+B' ? 'blue' : 'magenta'}>{detail.type}</Tag>
              {detail.category && <Tag>{detail.category}</Tag>}
            </Space>
          )
        }
        open={!!detail}
        onClose={() => setDetail(null)}
        width={680}
      >
        {detail?.rawScript?.sessions?.map((sess, sIdx) => (
          <Card
            key={sIdx}
            size="small"
            title={<Text strong>会话 {sIdx + 1}: {sess.name}</Text>}
            style={{ marginBottom: 12 }}
            extra={sess.delay_from_start && <Tag>{sess.delay_from_start}</Tag>}
          >
            {sess.turns?.map((t) => (
              <div
                key={t.turn}
                style={{
                  display: 'flex',
                  marginBottom: 10,
                  flexDirection: t.role === 'A' || t.role === 'C' ? 'row' : 'row-reverse',
                }}
              >
                <div
                  style={{
                    minWidth: 32, height: 32, borderRadius: '50%',
                    background: ROLE_COLOR[t.role],
                    color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 13, fontWeight: 600,
                    margin: t.role === 'A' || t.role === 'C' ? '0 8px 0 0' : '0 0 0 8px',
                  }}
                >
                  {t.role}
                </div>
                <div
                  style={{
                    maxWidth: '70%',
                    background: t.role === 'A' || t.role === 'C' ? '#f0f0f0' : '#e6f4ff',
                    padding: '8px 12px',
                    borderRadius: 8,
                    fontSize: 13,
                  }}
                >
                  <Space size={4} style={{ marginBottom: 4 }}>
                    <Text type="secondary" style={{ fontSize: 10 }}>
                      {turnIcon(t.type)} #{t.turn} · {t.type ?? 'text'}
                    </Text>
                  </Space>
                  {t.content_pool && t.content_pool.length > 0 ? (
                    <div>
                      {t.content_pool.map((c, i) => (
                        <div key={i} style={{ marginBottom: 2 }}>
                          <Text style={{ fontSize: 12 }}>• {c}</Text>
                        </div>
                      ))}
                      <Text type="secondary" style={{ fontSize: 10, marginTop: 4, display: 'block' }}>
                        ↑ 执行时随机抽 1 条（{t.content_pool.length} 个变体）
                      </Text>
                    </div>
                  ) : t.asset_pool ? (
                    <div>
                      <Tag color="purple" style={{ fontSize: 10 }}>
                        从 pool: {t.asset_pool} 抽
                      </Tag>
                      {t.caption_fallback && (
                        <div style={{ marginTop: 4 }}>
                          <Text type="secondary" style={{ fontSize: 11 }}>
                            兜底文案: {t.caption_fallback}
                          </Text>
                        </div>
                      )}
                    </div>
                  ) : (
                    <Text type="secondary">(空)</Text>
                  )}
                  {t.send_delay_sec && (
                    <Text type="secondary" style={{ fontSize: 10, display: 'block', marginTop: 4 }}>
                      ⏱ 间隔 {t.send_delay_sec[0]}–{t.send_delay_sec[1]}s
                    </Text>
                  )}
                </div>
              </div>
            ))}
          </Card>
        ))}
        {!detail?.rawScript?.sessions?.length && detail?.lines && (
          <Card size="small" title="对话内容（fallback lines）">
            {detail.lines.map((l, i) => (
              <div key={i} style={{ marginBottom: 6 }}>
                <Tag color={ROLE_COLOR[l.roleLabel] === '#1677ff' ? 'blue' : 'green'}>{l.roleLabel}</Tag>
                <Text>{l.text}</Text>
              </div>
            ))}
          </Card>
        )}
      </Drawer>
    </div>
  );
}
