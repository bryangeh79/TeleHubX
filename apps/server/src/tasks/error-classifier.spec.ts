import { classifyError } from './error-classifier';

describe('classifyError', () => {
  // ─── A: 网络瞬时 ─────────────────────────────────────────────────
  describe('A: 网络瞬时', () => {
    const samples = [
      'RPC timeout (60000ms): contacts.GetContacts',
      'TIMEOUT',
      'connect ECONNRESET 91.108.56.107:80',
      'socket hang up',
      'fetch failed',
      'request timed out after 30000ms',
      'connect ETIMEDOUT 149.154.167.91:443',
      'Server returned -503: Service Unavailable',
    ];
    for (const msg of samples) {
      it(`matches "${msg}"`, () => {
        const r = classifyError(new Error(msg));
        expect(r.class).toBe('A');
        expect(r.retryable).toBe(true);
        expect(r.needReconnect).toBe(false);
        expect(r.permanent).toBe(false);
      });
    }
  });

  // ─── B: 连接已断 ─────────────────────────────────────────────────
  describe('B: 连接已断', () => {
    const samples = [
      'Connection closed',
      'WebSocket connection failed attempt: 5',
      'Connection was closed while receiving data',
      'Disconnected from server',
      "Cannot read property 'send' of null",
      'connection dropped',
      'connection lost',
    ];
    for (const msg of samples) {
      it(`matches "${msg}"`, () => {
        const r = classifyError(new Error(msg));
        expect(r.class).toBe('B');
        expect(r.retryable).toBe(true);
        expect(r.needReconnect).toBe(true);
      });
    }
  });

  // ─── D: FloodWait ────────────────────────────────────────────────
  describe('D: FloodWait', () => {
    it('matches "A wait of 120 seconds is required"', () => {
      const r = classifyError(new Error('A wait of 120 seconds is required (caused by SendMessageRequest)'));
      expect(r.class).toBe('D');
      expect(r.retryable).toBe(false);
    });
    it('matches FLOOD_WAIT_60', () => {
      const r = classifyError(new Error('FLOOD_WAIT_60'));
      expect(r.class).toBe('D');
    });
  });

  // ─── E: 临时风控 ─────────────────────────────────────────────────
  describe('E: 临时风控', () => {
    const samples = [
      'PEER_FLOOD',
      'SLOWMODE_WAIT_30',
      'CHAT_SEND_PLAIN_FORBIDDEN',
      'CHAT_SEND_MEDIA_FORBIDDEN',
      'CHAT_RESTRICTED',
    ];
    for (const msg of samples) {
      it(`matches "${msg}"`, () => {
        const r = classifyError(new Error(msg));
        expect(r.class).toBe('E');
        expect(r.retryable).toBe(false);
        expect(r.permanent).toBe(false);
      });
    }
  });

  // ─── F: 永久业务错误 ─────────────────────────────────────────────
  describe('F: 永久业务错误', () => {
    const samples = [
      'USER_PRIVACY_RESTRICTED',
      'CHAT_WRITE_FORBIDDEN',
      'PHONE_NUMBER_INVALID',
      'USERNAME_NOT_OCCUPIED',
      'PEER_ID_INVALID',
      'CHANNEL_PRIVATE',
      'INVITE_HASH_EXPIRED',
      'YOU_BLOCKED_USER',
    ];
    for (const msg of samples) {
      it(`matches "${msg}"`, () => {
        const r = classifyError(new Error(msg));
        expect(r.class).toBe('F');
        expect(r.retryable).toBe(false);
        expect(r.permanent).toBe(true);
      });
    }
  });

  // ─── G: 账号失效 ─────────────────────────────────────────────────
  describe('G: 账号失效', () => {
    const samples = [
      'AUTH_KEY_UNREGISTERED',
      'AUTH_KEY_INVALID',
      'SESSION_REVOKED',
      'USER_DEACTIVATED',
      'USER_DEACTIVATED_BAN',
      'SESSION_PASSWORD_NEEDED',
    ];
    for (const msg of samples) {
      it(`matches "${msg}"`, () => {
        const r = classifyError(new Error(msg));
        expect(r.class).toBe('G');
        expect(r.retryable).toBe(false);
        expect(r.permanent).toBe(true);
        expect(r.quarantineAccount).toBe(true);
      });
    }
  });

  // ─── H: 默认 ──────────────────────────────────────────────────────
  describe('H: 默认兜底', () => {
    it('matches unknown error', () => {
      const r = classifyError(new Error('Some random unexpected error xyz'));
      expect(r.class).toBe('H');
      expect(r.retryable).toBe(false);
    });
    it('handles non-Error input', () => {
      const r = classifyError('string error');
      expect(r.class).toBe('H');
    });
    it('handles null', () => {
      const r = classifyError(null);
      expect(r.class).toBe('H');
    });
  });

  // ─── 优先级测试: D 要在 E 之前匹配 ────────────────────────────────
  describe('priority', () => {
    it('FloodWait 优先于 PEER_FLOOD', () => {
      // FLOOD_WAIT 关键词在前
      const r = classifyError(new Error('A wait of 60 seconds is required, then PEER_FLOOD'));
      expect(r.class).toBe('D');
    });
    it('AUTH_KEY 优先于 timeout', () => {
      const r = classifyError(new Error('AUTH_KEY_UNREGISTERED after RPC timeout'));
      expect(r.class).toBe('G');
    });
  });
});
