import { useState, useRef, useEffect } from 'react';
import {
  Row,
  Col,
  List,
  Card,
  Tag,
  Badge,
  Input,
  Button,
  Select,
  Space,
  Typography,
  Avatar,
  Divider,
  message,
  Empty,
} from 'antd';
import {
  UserOutlined,
  SendOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { leadsApi } from '../../services/api';

const { Title, Text } = Typography;
const { TextArea } = Input;

type Intent = 'cold' | 'warm' | 'hot';
type LeadStatus = 'ai' | 'human' | 'closed';

interface Message {
  id: string;
  from: 'lead' | 'agent';
  text: string;
  ts: string;
}

interface Lead {
  id: string;
  tgUsername: string;
  phone?: string;
  campaign: string;
  intent: Intent;
  status: LeadStatus;
  budget?: string;
  lastMessage: string;
  updatedAt: string;
  messages: Message[];
}

const INTENT_COLOR: Record<Intent, string> = {
  cold: 'blue',
  warm: 'orange',
  hot:  'red',
};

const STATUS_BADGE: Record<LeadStatus, 'processing' | 'success' | 'default'> = {
  ai:     'processing',
  human:  'success',
  closed: 'default',
};

const MOCK_LEADS: Lead[] = [
  {
    id: '1',
    tgUsername: '@alibtg',
    phone: '+60123456789',
    campaign: 'April Property Leads',
    intent: 'hot',
    status: 'human',
    budget: 'RM 500k+',
    lastMessage: 'When can I schedule a viewing?',
    updatedAt: '2026-04-30T05:30:00Z',
    messages: [
      { id: 'm1', from: 'lead',  text: 'Hi, I saw your ad about the property in PJ.',        ts: '2026-04-30T05:00:00Z' },
      { id: 'm2', from: 'agent', text: 'Hello! Yes, we have units from RM 480k. Interested?', ts: '2026-04-30T05:05:00Z' },
      { id: 'm3', from: 'lead',  text: 'Budget is around 500k. What floor plans are available?', ts: '2026-04-30T05:20:00Z' },
      { id: 'm4', from: 'agent', text: 'We have 3BR and 4BR options. Let me send you the brochure.', ts: '2026-04-30T05:25:00Z' },
      { id: 'm5', from: 'lead',  text: 'When can I schedule a viewing?', ts: '2026-04-30T05:30:00Z' },
    ],
  },
  {
    id: '2',
    tgUsername: '@suraya_my',
    campaign: 'Insurance Warm Leads',
    intent: 'warm',
    status: 'ai',
    lastMessage: 'What is the monthly premium?',
    updatedAt: '2026-04-30T04:15:00Z',
    messages: [
      { id: 'm1', from: 'lead',  text: 'I saw your insurance ad. Can you explain the plans?', ts: '2026-04-30T04:00:00Z' },
      { id: 'm2', from: 'agent', text: 'Sure! We have 3 plan tiers starting from RM 80/month.', ts: '2026-04-30T04:05:00Z' },
      { id: 'm3', from: 'lead',  text: 'What is the monthly premium for the mid-tier?', ts: '2026-04-30T04:15:00Z' },
    ],
  },
  {
    id: '3',
    tgUsername: '@razif88',
    campaign: 'April Property Leads',
    intent: 'cold',
    status: 'closed',
    lastMessage: 'Not interested for now.',
    updatedAt: '2026-04-29T12:00:00Z',
    messages: [
      { id: 'm1', from: 'lead',  text: 'Hi', ts: '2026-04-29T11:55:00Z' },
      { id: 'm2', from: 'agent', text: 'Hello! How can I help you today?', ts: '2026-04-29T11:56:00Z' },
      { id: 'm3', from: 'lead',  text: 'Not interested for now.', ts: '2026-04-29T12:00:00Z' },
    ],
  },
];

export default function LeadsInbox() {
  const [leads, setLeads] = useState<Lead[]>(MOCK_LEADS);
  const [selected, setSelected] = useState<Lead | null>(MOCK_LEADS[0]);
  const [intentFilter, setIntentFilter] = useState<Intent | undefined>();
  const [statusFilter, setStatusFilter] = useState<LeadStatus | undefined>();
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [selected?.messages.length]);

  const filteredLeads = leads.filter(l => {
    if (intentFilter && l.intent !== intentFilter) return false;
    if (statusFilter && l.status !== statusFilter) return false;
    return true;
  });

  const handleSend = async () => {
    if (!replyText.trim() || !selected) return;
    setSending(true);
    const newMsg: Message = {
      id: `m-${Date.now()}`,
      from: 'agent',
      text: replyText.trim(),
      ts: new Date().toISOString(),
    };
    try {
      await leadsApi.reply(selected.id, replyText.trim());
    } catch {
      // mock: continue anyway
    }
    setLeads(prev =>
      prev.map(l =>
        l.id === selected.id
          ? { ...l, messages: [...l.messages, newMsg], lastMessage: newMsg.text, updatedAt: newMsg.ts }
          : l
      )
    );
    setSelected(prev =>
      prev ? { ...prev, messages: [...prev.messages, newMsg] } : prev
    );
    setReplyText('');
    setSending(false);
    message.success('Sent');
  };

  const handleTakeover = (leadId: string) => {
    setLeads(prev =>
      prev.map(l => l.id === leadId ? { ...l, status: 'human' } : l)
    );
    setSelected(prev => prev && prev.id === leadId ? { ...prev, status: 'human' } : prev);
    message.success('Takeover activated — AI paused for this lead');
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>Leads Inbox</Title>
        <Space>
          <Select
            placeholder="Intent"
            allowClear
            style={{ width: 110 }}
            value={intentFilter}
            onChange={v => setIntentFilter(v)}
            options={[
              { value: 'cold', label: 'Cold' },
              { value: 'warm', label: 'Warm' },
              { value: 'hot',  label: 'Hot' },
            ]}
          />
          <Select
            placeholder="Status"
            allowClear
            style={{ width: 110 }}
            value={statusFilter}
            onChange={v => setStatusFilter(v)}
            options={[
              { value: 'ai',     label: 'AI' },
              { value: 'human',  label: 'Human' },
              { value: 'closed', label: 'Closed' },
            ]}
          />
        </Space>
      </div>

      <Row gutter={16} style={{ height: 'calc(100vh - 200px)', minHeight: 500 }}>
        {/* Lead list */}
        <Col span={8} style={{ height: '100%', overflowY: 'auto', borderRight: '1px solid #f0f0f0' }}>
          <List
            dataSource={filteredLeads}
            renderItem={lead => (
              <List.Item
                key={lead.id}
                onClick={() => setSelected(lead)}
                style={{
                  cursor: 'pointer',
                  padding: '12px 16px',
                  background: selected?.id === lead.id ? '#e6f4ff' : 'transparent',
                  borderRadius: 6,
                  marginBottom: 4,
                }}
              >
                <List.Item.Meta
                  avatar={<Avatar icon={<UserOutlined />} />}
                  title={
                    <Space size={4}>
                      <Text strong style={{ fontSize: 13 }}>{lead.tgUsername}</Text>
                      <Tag color={INTENT_COLOR[lead.intent]} style={{ fontSize: 10, padding: '0 4px' }}>
                        {lead.intent}
                      </Tag>
                      <Badge status={STATUS_BADGE[lead.status]} />
                    </Space>
                  }
                  description={
                    <div>
                      <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>
                        {lead.campaign}
                      </Text>
                      <Text ellipsis style={{ fontSize: 12, maxWidth: 180 }}>
                        {lead.lastMessage}
                      </Text>
                      <Text type="secondary" style={{ fontSize: 10, display: 'block' }}>
                        {dayjs(lead.updatedAt).format('MM-DD HH:mm')}
                      </Text>
                    </div>
                  }
                />
              </List.Item>
            )}
          />
        </Col>

        {/* Conversation panel */}
        <Col span={16} style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          {selected ? (
            <>
              {/* Header */}
              <div style={{ padding: '8px 16px', borderBottom: '1px solid #f0f0f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Space>
                  <Text strong>{selected.tgUsername}</Text>
                  <Tag color={INTENT_COLOR[selected.intent]}>{selected.intent}</Tag>
                  <Badge status={STATUS_BADGE[selected.status]} text={selected.status} />
                  {selected.budget && <Text type="secondary" style={{ fontSize: 12 }}>Budget: {selected.budget}</Text>}
                </Space>
                <Space>
                  {selected.status === 'ai' && (
                    <Button
                      size="small"
                      icon={<ReloadOutlined />}
                      onClick={() => handleTakeover(selected.id)}
                    >
                      Takeover
                    </Button>
                  )}
                </Space>
              </div>

              {/* Messages */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                {selected.messages.map(msg => (
                  <div
                    key={msg.id}
                    style={{
                      display: 'flex',
                      justifyContent: msg.from === 'agent' ? 'flex-end' : 'flex-start',
                    }}
                  >
                    <div
                      style={{
                        maxWidth: '70%',
                        padding: '8px 12px',
                        borderRadius: msg.from === 'agent' ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
                        background: msg.from === 'agent' ? '#1677ff' : '#f5f5f5',
                        color: msg.from === 'agent' ? '#fff' : '#000',
                      }}
                    >
                      <div style={{ fontSize: 13 }}>{msg.text}</div>
                      <div style={{ fontSize: 10, marginTop: 4, opacity: 0.7, textAlign: 'right' }}>
                        {dayjs(msg.ts).format('HH:mm')}
                      </div>
                    </div>
                  </div>
                ))}
                <div ref={bottomRef} />
              </div>

              {/* Reply box */}
              <Divider style={{ margin: 0 }} />
              <div style={{ padding: '12px 16px', display: 'flex', gap: 8 }}>
                <TextArea
                  value={replyText}
                  onChange={e => setReplyText(e.target.value)}
                  placeholder="Type a reply..."
                  autoSize={{ minRows: 2, maxRows: 5 }}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleSend();
                  }}
                  style={{ flex: 1 }}
                />
                <Button
                  type="primary"
                  icon={<SendOutlined />}
                  loading={sending}
                  onClick={handleSend}
                  disabled={!replyText.trim()}
                  style={{ alignSelf: 'flex-end' }}
                >
                  Send
                </Button>
              </div>
            </>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
              <Empty description="Select a lead to view conversation" />
            </div>
          )}
        </Col>
      </Row>
    </div>
  );
}
