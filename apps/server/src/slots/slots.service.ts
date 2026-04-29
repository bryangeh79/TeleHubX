import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Slot, SlotStatus } from './slot.entity';

@Injectable()
export class SlotsService {
  private readonly logger = new Logger(SlotsService.name);

  constructor(
    @InjectRepository(Slot)
    private readonly repo: Repository<Slot>,
  ) {}

  /** All slots ordered by no, with their current account hydrated (left join). */
  findAll(): Promise<Slot[]> {
    return this.repo.find({
      relations: ['account'],
      order: { no: 'ASC' },
    });
  }

  async findOne(id: string): Promise<Slot> {
    const slot = await this.repo.findOne({
      where: { id },
      relations: ['account'],
    });
    if (!slot) throw new NotFoundException(`Slot ${id} not found`);
    return slot;
  }

  async findByAccount(accountId: string): Promise<Slot | null> {
    return this.repo.findOne({
      where: { accountId },
      relations: ['account'],
    });
  }

  /**
   * Pick the smallest VACANT slot, or create a brand-new one with no = max+1
   * if the pool has no holes. Sets status=OCCUPIED and binds accountId.
   */
  async assignToAccount(accountId: string): Promise<Slot> {
    // Defensive: if this account already has a slot, return it
    const existing = await this.findByAccount(accountId);
    if (existing) return existing;

    // 1. Try lowest-numbered vacant slot first
    const vacant = await this.repo.findOne({
      where: { status: SlotStatus.VACANT },
      order: { no: 'ASC' },
    });
    if (vacant) {
      vacant.status = SlotStatus.OCCUPIED;
      vacant.accountId = accountId;
      vacant.lastReleasedAt = null;
      await this.repo.save(vacant);
      this.logger.log(`[slot] account ${accountId.slice(0, 8)} → No.${vacant.no} (filled vacant)`);
      return this.findOne(vacant.id);
    }

    // 2. No vacant slot — create new at max+1
    const top = await this.repo.findOne({ where: {}, order: { no: 'DESC' } });
    const nextNo = (top?.no ?? 0) + 1;
    const slot = this.repo.create({
      no: nextNo,
      status: SlotStatus.OCCUPIED,
      accountId,
    });
    await this.repo.save(slot);
    this.logger.log(`[slot] account ${accountId.slice(0, 8)} → No.${nextNo} (new)`);
    return this.findOne(slot.id);
  }

  /**
   * Mark the slot belonging to accountId as RELEASED. The slot keeps its number
   * and stays unavailable for new binds until reset() is called.
   * Idempotent: returns null if account has no slot.
   */
  async releaseFromAccount(accountId: string): Promise<Slot | null> {
    const slot = await this.findByAccount(accountId);
    if (!slot) return null;
    slot.status = SlotStatus.RELEASED;
    slot.accountId = null;
    slot.lastReleasedAt = new Date();
    await this.repo.save(slot);
    this.logger.log(`[slot] No.${slot.no} released (was ${accountId.slice(0, 8)})`);
    return slot;
  }

  /**
   * Operator-only "factory reset" — flip a RELEASED slot back to VACANT so the
   * next bind can take it. Refuses if slot is currently OCCUPIED.
   */
  async reset(slotId: string): Promise<Slot> {
    const slot = await this.findOne(slotId);
    if (slot.status === SlotStatus.OCCUPIED) {
      throw new ConflictException(
        `Slot No.${slot.no} is occupied by an account. Delete the account first, then reset.`,
      );
    }
    slot.status = SlotStatus.VACANT;
    slot.lastReleasedAt = null;
    await this.repo.save(slot);
    this.logger.log(`[slot] No.${slot.no} reset → vacant`);
    return this.findOne(slot.id);
  }

  /** Hard delete a slot (admin escape hatch). Refuses if currently occupied. */
  async remove(slotId: string): Promise<void> {
    const slot = await this.findOne(slotId);
    if (slot.status === SlotStatus.OCCUPIED) {
      throw new ConflictException(
        `Cannot delete slot No.${slot.no} while occupied.`,
      );
    }
    await this.repo.remove(slot);
  }
}
