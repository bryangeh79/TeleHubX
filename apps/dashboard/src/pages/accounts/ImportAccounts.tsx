import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Upload,
  Button,
  Table,
  Alert,
  Typography,
  Space,
  Tag,
  message,
  Card,
} from 'antd';
import { InboxOutlined, UploadOutlined, CheckCircleOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import type { UploadFile } from 'antd/es/upload';
import { accountsApi } from '../../services/api';

const { Title, Text } = Typography;
const { Dragger } = Upload;

interface ParsedRow {
  key: number;
  phone: string;
  proxyHost: string;
  proxyPort: string;
  proxyUser?: string;
  proxyPass?: string;
  role: 'cs' | 'ad' | 'hybrid';
  error?: string;
}

const CSV_HEADER = 'phone,proxy_host,proxy_port,proxy_user,proxy_pass,role';

function parseCSV(text: string): ParsedRow[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim() && !l.startsWith('phone'));
  return lines.map((line, idx) => {
    const parts = line.split(',').map(p => p.trim());
    const [phone, proxyHost, proxyPort, proxyUser, proxyPass, role] = parts;
    const errors: string[] = [];
    if (!phone?.match(/^\+\d{8,15}$/)) errors.push('invalid phone');
    if (!proxyHost) errors.push('missing proxy_host');
    if (!proxyPort?.match(/^\d{2,5}$/)) errors.push('invalid proxy_port');
    if (!['cs', 'ad', 'hybrid'].includes(role)) errors.push('invalid role');
    return {
      key: idx,
      phone: phone || '',
      proxyHost: proxyHost || '',
      proxyPort: proxyPort || '',
      proxyUser: proxyUser || undefined,
      proxyPass: proxyPass || undefined,
      role: (['cs', 'ad', 'hybrid'].includes(role) ? role : 'ad') as ParsedRow['role'],
      error: errors.length ? errors.join(', ') : undefined,
    };
  });
}

const columns: ColumnsType<ParsedRow> = [
  { title: 'Phone', dataIndex: 'phone', key: 'phone', width: 160 },
  {
    title: 'Proxy',
    key: 'proxy',
    width: 200,
    render: (_, r) => `${r.proxyHost}:${r.proxyPort}${r.proxyUser ? ` (${r.proxyUser})` : ''}`,
  },
  {
    title: 'Role',
    dataIndex: 'role',
    key: 'role',
    width: 90,
    render: (role: string) => (
      <Tag color={role === 'cs' ? 'blue' : role === 'ad' ? 'green' : 'orange'}>
        {role.toUpperCase()}
      </Tag>
    ),
  },
  {
    title: 'Status',
    dataIndex: 'error',
    key: 'error',
    render: (err?: string) =>
      err
        ? <Text type="danger" style={{ fontSize: 12 }}>{err}</Text>
        : <Text type="success" style={{ fontSize: 12 }}><CheckCircleOutlined /> OK</Text>,
  },
];

export default function ImportAccounts() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const fileRef = useRef<UploadFile | null>(null);

  const validRows = rows.filter(r => !r.error);
  const invalidRows = rows.filter(r => r.error);

  const handleFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = e => {
      const text = e.target?.result as string;
      setRows(parseCSV(text));
      setDone(false);
    };
    reader.readAsText(file);
    return false;
  };

  const handleSubmit = async () => {
    if (validRows.length === 0) return;
    setSubmitting(true);
    let succeeded = 0;
    for (const row of validRows) {
      try {
        await accountsApi.create({
          phone: row.phone,
          proxy: {
            host: row.proxyHost,
            port: Number(row.proxyPort),
            username: row.proxyUser,
            password: row.proxyPass,
          },
          role: row.role,
        });
        succeeded++;
      } catch {
        // continue — log per-row errors in a future enhancement
      }
    }
    setSubmitting(false);
    setDone(true);
    message.success(`Imported ${succeeded} / ${validRows.length} accounts`);
  };

  return (
    <div style={{ maxWidth: 860, margin: '0 auto' }}>
      <Title level={4} style={{ marginBottom: 8 }}>Batch Import Accounts</Title>
      <Text type="secondary" style={{ display: 'block', marginBottom: 24 }}>
        CSV format: <code>{CSV_HEADER}</code>
      </Text>

      <Dragger
        accept=".csv,text/csv"
        showUploadList={false}
        beforeUpload={handleFile}
        style={{ marginBottom: 24 }}
      >
        <p className="ant-upload-drag-icon">
          <InboxOutlined />
        </p>
        <p className="ant-upload-text">Click or drag a CSV file here</p>
        <p className="ant-upload-hint">One account per row. Max 200 rows per import.</p>
      </Dragger>

      {rows.length > 0 && (
        <Card
          title={
            <Space>
              <span>Preview</span>
              <Tag color="green">{validRows.length} valid</Tag>
              {invalidRows.length > 0 && <Tag color="red">{invalidRows.length} errors</Tag>}
            </Space>
          }
          style={{ marginBottom: 24 }}
        >
          {invalidRows.length > 0 && (
            <Alert
              type="warning"
              message={`${invalidRows.length} row(s) will be skipped due to errors. Fix the CSV and re-upload.`}
              style={{ marginBottom: 16 }}
              showIcon
            />
          )}

          <Table
            columns={columns}
            dataSource={rows}
            rowKey="key"
            size="small"
            pagination={{ pageSize: 10 }}
            rowClassName={r => r.error ? 'ant-table-row-error' : ''}
          />
        </Card>
      )}

      {done && (
        <Alert
          type="success"
          message="Import complete. Accounts are now initializing (P0 Warmup)."
          style={{ marginBottom: 16 }}
          showIcon
        />
      )}

      <Space>
        <Button onClick={() => navigate('/accounts')}>Back</Button>
        <Button
          type="primary"
          icon={<UploadOutlined />}
          disabled={validRows.length === 0 || done}
          loading={submitting}
          onClick={handleSubmit}
        >
          Import {validRows.length > 0 ? `${validRows.length} accounts` : ''}
        </Button>
      </Space>
    </div>
  );
}
