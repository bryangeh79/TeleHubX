import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Form,
  Input,
  Button,
  Card,
  Typography,
  Alert,
  Space,
  message as antdMessage,
} from 'antd';
import { LockOutlined, UserOutlined } from '@ant-design/icons';
import { authApi } from '../../services/api';

const { Title, Text } = Typography;

export default function LoginPage() {
  const navigate = useNavigate();
  const [form] = Form.useForm<{ username: string; password: string }>();
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);
      const res = await authApi.login(values.username, values.password);
      const token = res.data?.token;
      if (token) {
        localStorage.setItem('telehubx:token', token);
        localStorage.setItem('telehubx:user', JSON.stringify(res.data.user));
        antdMessage.success(`欢迎回来，${res.data.user.username}`);
        navigate('/');
      }
    } catch (err: any) {
      const msg = err?.response?.data?.message;
      antdMessage.error(typeof msg === 'string' ? msg : '登录失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'linear-gradient(135deg, #1677ff 0%, #722ed1 100%)',
    }}>
      <Card style={{ width: 400 }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <Title level={3} style={{ margin: 0, color: '#1677ff' }}>TeleHubX</Title>
          <Text type="secondary">运营控制台</Text>
        </div>

        <Alert
          type="info"
          showIcon
          message="默认账号：admin / admin"
          description="首次启动自动创建。请通过「设置 → 个人资料 → 修改密码」立刻修改。"
          style={{ marginBottom: 16, fontSize: 12 }}
        />

        <Form form={form} layout="vertical" onFinish={handleLogin}>
          <Form.Item
            name="username"
            label="用户名"
            rules={[{ required: true, message: '请输入用户名' }]}
          >
            <Input
              prefix={<UserOutlined style={{ color: '#bfbfbf' }} />}
              placeholder="admin"
              size="large"
              autoFocus
            />
          </Form.Item>

          <Form.Item
            name="password"
            label="密码"
            rules={[{ required: true, message: '请输入密码' }]}
          >
            <Input.Password
              prefix={<LockOutlined style={{ color: '#bfbfbf' }} />}
              placeholder="密码"
              size="large"
            />
          </Form.Item>

          <Form.Item style={{ marginBottom: 8 }}>
            <Button type="primary" htmlType="submit" loading={loading} block size="large">
              登录
            </Button>
          </Form.Item>

          <Space direction="vertical" style={{ width: '100%' }}>
            <Button type="link" block onClick={() => navigate('/activate')}>
              首次使用需要激活 License？
            </Button>
          </Space>
        </Form>
      </Card>
    </div>
  );
}
