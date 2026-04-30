import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { LeadsService } from '../leads/leads.service';
import { LeadTakeover } from '../leads/lead.entity';
import { TenantsService } from '../tenants/tenants.service';
import { BotReplyService } from '../bot-gateway/bot-reply.service';
import { decryptSession, deriveKey } from '../crypto/session-crypto.util';
import { ConfigService } from '@nestjs/config';

/**
 * 实时人工接管 WebSocket 网关。
 *
 * 设计：
 *  - 房间命名：`lead:${leadId}`，每个 lead 一个房间
 *  - 客户端订阅特定 lead → 加入房间 → 收到该 lead 的所有新消息
 *  - 客户端发回复 → 服务端通过 BotGateway sendText 真送回 TG → 广播给房间
 *  - BotGateway 收到客户消息 → 调 emitInbound() → 房间内所有客户端收到
 *
 * MVP 暂跳过：JWT 鉴权、多 operator 协作、typing 指示、回执
 */
@WebSocketGateway({
  cors: { origin: '*', credentials: false },
  path: '/socket.io',
})
export class TakeoverGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(TakeoverGateway.name);
  private readonly encKey: Buffer | null;

  constructor(
    private readonly leads: LeadsService,
    private readonly tenants: TenantsService,
    private readonly botReply: BotReplyService,
    private readonly config: ConfigService,
  ) {
    const raw = this.config.get<string>('SESSION_ENCRYPTION_KEY');
    this.encKey = raw ? deriveKey(raw) : null;
  }

  handleConnection(client: Socket): void {
    this.logger.log(`socket connected: ${client.id}`);
  }

  handleDisconnect(client: Socket): void {
    this.logger.log(`socket disconnected: ${client.id}`);
  }

  @SubscribeMessage('subscribe')
  async onSubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { leadId: string },
  ): Promise<{ ok: boolean; lead?: any; error?: string }> {
    if (!body?.leadId) return { ok: false, error: 'leadId required' };
    try {
      const lead = await this.leads.findOne(body.leadId);
      const room = `lead:${lead.id}`;
      // 离开之前订阅的 lead 房间（每个 socket 同时只看一个 lead）
      for (const r of client.rooms) {
        if (r.startsWith('lead:') && r !== room) client.leave(r);
      }
      client.join(room);
      this.logger.debug(`socket ${client.id} subscribed to ${room}`);
      return { ok: true, lead };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  @SubscribeMessage('unsubscribe')
  onUnsubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { leadId: string },
  ): { ok: boolean } {
    if (body?.leadId) client.leave(`lead:${body.leadId}`);
    return { ok: true };
  }

  /**
   * 操作员通过 WS 发回复。
   * 1. 校验 lead 状态必须 = HUMAN（防止 AI 在管的对话被乱入）
   * 2. 找到 lead 对应的 tenant 的 active bot
   * 3. 通过 Bot API sendMessage
   * 4. 本地存 LeadReply
   * 5. 广播给房间（含 sender 的浏览器，确认入库）
   */
  @SubscribeMessage('reply')
  async onReply(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { leadId: string; text: string },
  ): Promise<{ ok: boolean; error?: string }> {
    if (!body?.leadId || !body?.text?.trim()) {
      return { ok: false, error: 'leadId and text required' };
    }
    try {
      const lead = await this.leads.findOne(body.leadId);
      if (lead.takeoverState !== LeadTakeover.HUMAN) {
        return { ok: false, error: '该对话未处于人工接管状态，请先点「接管」' };
      }
      if (!lead.tenantId || !lead.tgUserId) {
        return { ok: false, error: 'lead 缺少 tenantId 或 tgUserId，无法发送' };
      }

      const bots = await this.tenants.listBots(lead.tenantId);
      const activeBot = bots.find((b) => b.isActive) ?? bots[0];
      if (!activeBot) {
        return { ok: false, error: '该 tenant 还没配置 Bot，请先在「智能客服」页注册 Bot' };
      }
      // 解密 token
      const botWithToken = await this.tenants.findBotWithToken(activeBot.id);
      const token = botWithToken.rawToken;
      if (!token) {
        return { ok: false, error: 'Bot token 解密失败' };
      }

      await this.botReply.sendText(token, lead.tgUserId, body.text);
      const updated = await this.leads.addReply(lead.id, { sender: 'human', text: body.text });

      const lastReply = updated.replies?.[updated.replies.length - 1];
      this.server.to(`lead:${lead.id}`).emit('message', {
        leadId: lead.id,
        sender: lastReply?.sentBy ?? 'human',
        text: body.text,
        ts: lastReply?.ts ?? new Date().toISOString(),
      });
      return { ok: true };
    } catch (err) {
      this.logger.error(`reply failed: ${(err as Error).message}`);
      return { ok: false, error: (err as Error).message };
    }
  }

  // ── 给 BotGateway / leads.service 调用：广播新消息到 lead 房间 ───────────
  emitMessage(leadId: string, payload: { sender: 'user' | 'system' | 'human' | 'bot'; text: string; ts?: string }) {
    this.server?.to(`lead:${leadId}`).emit('message', {
      leadId,
      sender: payload.sender,
      text: payload.text,
      ts: payload.ts ?? new Date().toISOString(),
    });
  }

  /** 通知所有连接的客户端：lead 状态变化（接管/释放）。客户端可刷新左侧列表。 */
  emitLeadUpdate(leadId: string) {
    this.server?.emit('lead-updated', { leadId });
  }
}
