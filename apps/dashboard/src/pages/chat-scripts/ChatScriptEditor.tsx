import { useEffect, useState } from 'react';
import {
  Button, Card, Col, Empty, Form, Input, InputNumber, Modal,
  Row, Segmented, Select, Space, Tag, Tooltip, Typography, Upload,
  message as antdMessage,
} from 'antd';
import {
  ArrowDownOutlined, ArrowUpOutlined, DeleteOutlined,
  PlusOutlined, SaveOutlined, UploadOutlined,
} from '@ant-design/icons';
import { assetsApi, chatScriptsApi } from '../../services/api';

const { Text } = Typography;
const { TextArea } = Input;

type Role = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';
type ScriptType = 'A+B' | 'A+B+C+D' | 'A+B+C+D+E+F';
type TurnType = 'text' | 'image' | 'video' | 'voice';

interface Turn {
  role: Role;
  type: TurnType;
  /** text 类型用 — 多行内容池，每行一个变体，发送时随机抽 */
  contentPool: string;
  /** image/video/voice 类型用 — 素材池名 */
  assetPool?: string;
  /** image/video 用 — 配文池，每行一个变体 */
  captionPool?: string;
  delayMin: number;
  delayMax: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** 编辑模式时传入 — 暂时只支持新建，编辑后续做 */
  initial?: { id: string; name: string; type: ScriptType; rawScript: any };
  onSaved?: () => void;
}

const ROLE_OPTIONS: Record<ScriptType, Role[]> = {
  'A+B': ['A', 'B'],
  'A+B+C+D': ['A', 'B', 'C', 'D'],
  'A+B+C+D+E+F': ['A', 'B', 'C', 'D', 'E', 'F'],
};

const ROLE_COLOR: Record<Role, string> = {
  A: '#1677ff', B: '#52c41a', C: '#fa8c16',
  D: '#eb2f96', E: '#722ed1', F: '#13c2c2',
};

const TYPE_LABEL: Record<TurnType, string> = {
  text: '文字', image: '图片', video: '视频', voice: '语音',
};

function defaultTurn(role: Role): Turn {
  return {
    role,
    type: 'text',
    contentPool: '',
    delayMin: 30,
    delayMax: 90,
  };
}

export default function ChatScriptEditor({ open, onClose, initial, onSaved }: Props) {
  const [name, setName] = useState('');
  const [type, setType] = useState<ScriptType>('A+B');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [pools, setPools] = useState<Array<{ value: string; label: string }>>([]);
  const [saving, setSaving] = useState(false);

  // 初始化（新建 vs 编辑）
  useEffect(() => {
    if (!open) return;
    if (initial) {
      setName(initial.name);
      setType(initial.type);
      // 把 rawScript 反向解析回 turns
      const parsed: Turn[] = [];
      const sessions = initial.rawScript?.sessions ?? [];
      for (const s of sessions) {
        for (const t of (s.turns ?? [])) {
          parsed.push({
            role: t.role,
            type: t.type ?? 'text',
            contentPool: (t.content_pool ?? []).join('\n'),
            assetPool: t.asset_pool,
            captionPool: (t.caption_pool ?? []).join('\n'),
            delayMin: t.send_delay_sec?.[0] ?? 30,
            delayMax: t.send_delay_sec?.[1] ?? 90,
          });
        }
      }
      setTurns(parsed);
    } else {
      setName('');
      setType('A+B');
      setTurns([defaultTurn('A'), defaultTurn('B')]);
    }
  }, [open, initial]);

  // 加载素材池列表（图片/视频/语音 turn 用）
  useEffect(() => {
    if (!open) return;
    assetsApi.pools().then((res) => {
      const list: Array<{ value: string; label: string }> = [];
      for (const p of (res.data ?? []) as Array<{ poolName: string; count: number; category: string }>) {
        list.push({ value: p.poolName, label: `${p.poolName} (${p.category} · ${p.count})` });
      }
      setPools(list);
    }).catch(() => {});
  }, [open]);

  const availableRoles = ROLE_OPTIONS[type];

  // 切换剧本类型时，把不在新类型里的角色 turn 清掉
  const handleTypeChange = (newType: ScriptType) => {
    setType(newType);
    const allowed = new Set(ROLE_OPTIONS[newType]);
    setTurns((ts) => ts.filter((t) => allowed.has(t.role)));
  };

  const handleAddTurn = () => {
    const lastRole = turns.length > 0 ? turns[turns.length - 1].role : 'A';
    // 默认下一个 turn 用「不同于上一个」的角色
    const nextRole = availableRoles.find((r) => r !== lastRole) ?? availableRoles[0];
    setTurns([...turns, defaultTurn(nextRole)]);
  };

  const handleDelete = (idx: number) => {
    setTurns(turns.filter((_, i) => i !== idx));
  };

  const handleMove = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= turns.length) return;
    const next = [...turns];
    [next[idx], next[target]] = [next[target], next[idx]];
    setTurns(next);
  };

  const handlePatch = (idx: number, patch: Partial<Turn>) => {
    setTurns(turns.map((t, i) => (i === idx ? { ...t, ...patch } : t)));
  };

  /**
   * vmfix28 #4: 内联上传素材到 turn editor。
   * - 自动生成 poolName: inline_<剧本名 sanitized>_turn<idx>_<timestamp>
   * - 调 assetsApi.upload + 刷新 pools 列表 + 自动 select 新 pool
   */
  const [uploadingIdx, setUploadingIdx] = useState<number | null>(null);

  const refreshPools = async (): Promise<Array<{ value: string; label: string }>> => {
    try {
      const res = await assetsApi.pools();
      const list: Array<{ value: string; label: string }> = [];
      for (const p of (res.data ?? []) as Array<{ poolName: string; count: number; category: string }>) {
        list.push({ value: p.poolName, label: `${p.poolName} (${p.category} · ${p.count})` });
      }
      setPools(list);
      return list;
    } catch {
      return pools;
    }
  };

  const handleInlineUpload = async (idx: number, file: File): Promise<boolean> => {
    const t = turns[idx];
    if (!t || t.type === 'text') {
      antdMessage.warning('只有图片/视频/语音类型的 turn 才能上传素材');
      return false;
    }
    // 类型 → category 映射
    const category: 'photo' | 'video' | 'voice' =
      t.type === 'image' ? 'photo' :
      t.type === 'video' ? 'video' : 'voice';
    // 自动生成 poolName
    const safeName = (name.trim() || 'untitled').replace(/[^a-zA-Z0-9_一-龥]+/g, '_').slice(0, 32);
    const poolName = `inline_${safeName}_turn${idx + 1}_${Date.now()}`;

    setUploadingIdx(idx);
    try {
      await assetsApi.upload(file, { category, poolName });
      antdMessage.success(`已上传到「${poolName}」`);
      // 刷新 pools 列表 + 自动 select
      await refreshPools();
      handlePatch(idx, { assetPool: poolName });
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? '上传失败');
    } finally {
      setUploadingIdx(null);
    }
    return false;  // beforeUpload 返回 false 防 antd 自动上传
  };

  const handleSave = async () => {
    if (!name.trim()) { antdMessage.warning('请填写剧本名'); return; }
    if (turns.length === 0) { antdMessage.warning('至少加一条 turn'); return; }
    // 验证：text 类型必须有 contentPool；asset 类型必须有 assetPool
    for (let i = 0; i < turns.length; i++) {
      const t = turns[i];
      if (t.type === 'text' && !t.contentPool.trim()) {
        antdMessage.error(`第 ${i + 1} 条 turn (${t.role} · 文字) 内容池不能为空`);
        return;
      }
      if (t.type !== 'text' && !t.assetPool) {
        antdMessage.error(`第 ${i + 1} 条 turn (${t.role} · ${TYPE_LABEL[t.type]}) 需要选择素材池`);
        return;
      }
    }

    // 构造 rawScript
    const rawScript = {
      sessions: [{
        name: 'main',
        turns: turns.map((t, i) => {
          const turn: any = {
            turn: i + 1,
            role: t.role,
            type: t.type,
            send_delay_sec: [t.delayMin, t.delayMax],
          };
          if (t.type === 'text') {
            turn.content_pool = t.contentPool.split('\n').map(s => s.trim()).filter(Boolean);
          } else {
            turn.asset_pool = t.assetPool;
            const caption = (t.captionPool ?? '').split('\n').map(s => s.trim()).filter(Boolean);
            if (caption.length) turn.caption_pool = caption;
          }
          return turn;
        }),
      }],
    };

    setSaving(true);
    try {
      const dto = {
        name: name.trim(),
        type,
        minRound: 1,
        maxRound: 1,
        lines: [],
        rawScript,
      };
      if (initial?.id) {
        await chatScriptsApi.update(initial.id, dto);
        antdMessage.success('已更新');
      } else {
        await chatScriptsApi.create(dto);
        antdMessage.success('剧本已创建');
      }
      onSaved?.();
      onClose();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={initial ? `编辑剧本 · ${initial.name}` : '新建聊天剧本'}
      width={900}
      centered
      styles={{ body: { padding: '16px 20px', maxHeight: '75vh', overflowY: 'auto' } }}
      footer={[
        <Button key="cancel" onClick={onClose}>取消</Button>,
        <Button key="save" type="primary" icon={<SaveOutlined />} onClick={handleSave} loading={saving}>
          {initial ? '保存修改' : '创建剧本'}
        </Button>,
      ]}
    >
      <Form layout="vertical">
        <Row gutter={12}>
          <Col span={14}>
            <Form.Item label="剧本名" required>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：咖啡店开业聊天剧本" maxLength={80} />
            </Form.Item>
          </Col>
          <Col span={10}>
            <Form.Item label="角色数">
              <Segmented
                value={type}
                onChange={(v) => handleTypeChange(v as ScriptType)}
                options={[
                  { label: '2 人 (A+B)', value: 'A+B' },
                  { label: '4 人 (A-D)', value: 'A+B+C+D' },
                  { label: '6 人 (A-F)', value: 'A+B+C+D+E+F' },
                ]}
              />
            </Form.Item>
          </Col>
        </Row>
      </Form>

      <Card
        size="small"
        title={
          <Space>
            <Text strong>对话 Turn ({turns.length})</Text>
            <Text type="secondary" style={{ fontSize: 12, fontWeight: 'normal' }}>
              · 每个 turn 一条消息 · 内容池每行一个变体（执行时随机抽）
            </Text>
          </Space>
        }
        extra={
          <Button size="small" type="primary" icon={<PlusOutlined />} onClick={handleAddTurn}>
            添加 Turn
          </Button>
        }
      >
        {turns.length === 0 ? (
          <Empty description="还没有 turn — 点右上角「添加 Turn」开始" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {turns.map((t, i) => (
              <Card
                key={i}
                size="small"
                styles={{ body: { padding: 10 } }}
                style={{ borderLeft: `4px solid ${ROLE_COLOR[t.role]}` }}
              >
                <Row gutter={8} align="middle" style={{ marginBottom: 8 }}>
                  <Col flex="60px">
                    <Tag color="default" style={{ fontWeight: 600, fontSize: 12 }}>#{i + 1}</Tag>
                  </Col>
                  <Col flex="100px">
                    <Select
                      value={t.role}
                      onChange={(v) => handlePatch(i, { role: v })}
                      style={{ width: '100%' }}
                      size="small"
                      options={availableRoles.map((r) => ({ value: r, label: `角色 ${r}` }))}
                    />
                  </Col>
                  <Col flex="110px">
                    <Select
                      value={t.type}
                      onChange={(v) => handlePatch(i, { type: v })}
                      style={{ width: '100%' }}
                      size="small"
                      options={(['text', 'image', 'video', 'voice'] as TurnType[]).map((tp) =>
                        ({ value: tp, label: TYPE_LABEL[tp] }))}
                    />
                  </Col>
                  <Col flex="auto">
                    <Space size={4} style={{ fontSize: 11 }}>
                      <Text type="secondary">间隔</Text>
                      <InputNumber size="small" value={t.delayMin} min={0} max={600}
                        onChange={(v) => handlePatch(i, { delayMin: Number(v) || 0 })} style={{ width: 60 }} />
                      <Text type="secondary">~</Text>
                      <InputNumber size="small" value={t.delayMax} min={0} max={600}
                        onChange={(v) => handlePatch(i, { delayMax: Number(v) || 0 })} style={{ width: 60 }} />
                      <Text type="secondary">秒</Text>
                    </Space>
                  </Col>
                  <Col flex="120px" style={{ textAlign: 'right' }}>
                    <Space size={2}>
                      <Tooltip title="上移">
                        <Button size="small" icon={<ArrowUpOutlined />} disabled={i === 0}
                          onClick={() => handleMove(i, -1)} />
                      </Tooltip>
                      <Tooltip title="下移">
                        <Button size="small" icon={<ArrowDownOutlined />} disabled={i === turns.length - 1}
                          onClick={() => handleMove(i, 1)} />
                      </Tooltip>
                      <Tooltip title="删除">
                        <Button size="small" danger icon={<DeleteOutlined />}
                          onClick={() => handleDelete(i)} />
                      </Tooltip>
                    </Space>
                  </Col>
                </Row>

                {t.type === 'text' ? (
                  <TextArea
                    value={t.contentPool}
                    onChange={(e) => handlePatch(i, { contentPool: e.target.value })}
                    placeholder="每行一个变体，执行时随机抽一句&#10;例如：&#10;今天发现一家新咖啡店，店面真的很好看 ☕&#10;欸跟你说，我刚去了一家新开的咖啡店"
                    autoSize={{ minRows: 3, maxRows: 8 }}
                    style={{ fontSize: 12 }}
                  />
                ) : (
                  <Row gutter={8}>
                    <Col span={12}>
                      <Space.Compact style={{ width: '100%' }}>
                        <Select
                          value={t.assetPool}
                          onChange={(v) => handlePatch(i, { assetPool: v })}
                          placeholder="选择素材池"
                          style={{ flex: 1 }}
                          size="small"
                          showSearch
                          optionFilterProp="label"
                          options={pools}
                        />
                        {/* vmfix28 #4: 内联上传按钮 */}
                        <Upload
                          showUploadList={false}
                          beforeUpload={(file) => handleInlineUpload(i, file)}
                          accept={
                            t.type === 'image' ? 'image/*' :
                            t.type === 'voice' ? 'audio/*,.ogg,.opus' :
                            t.type === 'video' ? 'video/*' :
                            undefined
                          }
                        >
                          <Tooltip title={`上传新${TYPE_LABEL[t.type]}并自动选用（不需要先去素材库）`}>
                            <Button
                              size="small"
                              icon={<UploadOutlined />}
                              loading={uploadingIdx === i}
                            >
                              上传
                            </Button>
                          </Tooltip>
                        </Upload>
                      </Space.Compact>
                    </Col>
                    <Col span={12}>
                      <TextArea
                        value={t.captionPool ?? ''}
                        onChange={(e) => handlePatch(i, { captionPool: e.target.value })}
                        placeholder="配文池（可选，每行一个变体）"
                        autoSize={{ minRows: 1, maxRows: 4 }}
                        style={{ fontSize: 12 }}
                      />
                    </Col>
                  </Row>
                )}
              </Card>
            ))}
          </div>
        )}
      </Card>

      <div style={{ marginTop: 12, padding: 10, background: '#fafafa', borderRadius: 6, fontSize: 11, color: '#888' }}>
        💡 提示：保存后，剧本会进入「自建」剧本包，可在创建 chat_script_ab / 4p / 6p 任务时按角色数过滤选用。
      </div>
    </Modal>
  );
}
