import React, { useState } from 'react';
import { Card, Input, Button, Form, Radio, Typography, Space, message } from 'antd';
import type { RadioChangeEvent } from 'antd';

const { Title, Text } = Typography;
const { TextArea } = Input;

const replyStyles = [
  { label: 'Professional (专业)', value: 'professional' },
  { label: 'Friendly (友好)', value: 'friendly' },
  { label: 'Casual (随意)', value: 'casual' },
  { label: 'Formal (正式)', value: 'formal' },
];

const defaultFaqs = [
  { id: 1, question: 'How much does it cost?', answer: 'Please contact our CS for pricing details.' },
  { id: 2, question: 'Is it available worldwide?', answer: 'Yes, we support global deployment.' },
];

const AiSettingsPage: React.FC = () => {
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('gpt-4o-mini');
  const [replyStyle, setReplyStyle] = useState('friendly');
  const [faqs, setFaqs] = useState(defaultFaqs);

  const handleSaveKey = () => {
    message.success('API Key saved (mock)');
  };

  return (
    <div style={{ padding: 24 }}>
      <Title level={3}>AI Settings</Title>

      <Card title="OpenAI Configuration" style={{ marginBottom: 24 }}>
        <Form layout="vertical">
          <Form.Item label="API Key">
            <Input.Password
              placeholder="sk-..."
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </Form.Item>
          <Form.Item label="Model">
            <Radio.Group value={model} onChange={(e: RadioChangeEvent) => setModel(e.target.value)}>
              <Radio value="gpt-4o-mini">GPT-4o Mini (fast, cheap)</Radio>
              <Radio value="gpt-4o">GPT-4o (best quality)</Radio>
              <Radio value="deepseek-chat">DeepSeek Chat</Radio>
              <Radio value="gemini-pro">Gemini Pro</Radio>
            </Radio.Group>
          </Form.Item>
          <Button type="primary" onClick={handleSaveKey}>Save</Button>
        </Form>
      </Card>

      <Card title="Reply Style" style={{ marginBottom: 24 }}>
        <Radio.Group value={replyStyle} onChange={(e: RadioChangeEvent) => setReplyStyle(e.target.value)}>
          <Space direction="vertical">
            {replyStyles.map((s) => (
              <Radio key={s.value} value={s.value}>{s.label}</Radio>
            ))}
          </Space>
        </Radio.Group>
      </Card>

      <Card title="FAQ Templates (Quick Reply)">
        {faqs.map((faq) => (
          <Card key={faq.id} size="small" style={{ marginBottom: 12 }} type="inner">
            <Text strong>Q: {faq.question}</Text>
            <br />
            <Text type="secondary">A: {faq.answer}</Text>
          </Card>
        ))}
      </Card>
    </div>
  );
};

export default AiSettingsPage;
