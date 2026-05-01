import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CustomerGroup } from './customer-group.entity';
import { CreateCustomerGroupDto } from './dto/create-customer-group.dto';
import { UpdateCustomerGroupDto } from './dto/update-customer-group.dto';

@Injectable()
export class CustomerGroupsService {
  constructor(
    @InjectRepository(CustomerGroup)
    private readonly repo: Repository<CustomerGroup>,
  ) {}

  create(dto: CreateCustomerGroupDto): Promise<CustomerGroup> {
    const members = dto.members ?? [];
    const group = this.repo.create({
      ...dto,
      members,
      memberCount: members.length,
    });
    return this.repo.save(group);
  }

  findAll(tenantId?: string): Promise<CustomerGroup[]> {
    const where = tenantId ? { tenantId } : {};
    return this.repo.find({ where, order: { createdAt: 'DESC' } });
  }

  async findOne(id: string): Promise<CustomerGroup> {
    const g = await this.repo.findOneBy({ id });
    if (!g) throw new NotFoundException(`CustomerGroup ${id} not found`);
    return g;
  }

  async update(id: string, dto: UpdateCustomerGroupDto): Promise<CustomerGroup> {
    const g = await this.findOne(id);
    if (dto.members !== undefined) {
      (dto as any).memberCount = dto.members.length;
    }
    Object.assign(g, dto);
    return this.repo.save(g);
  }

  async remove(id: string): Promise<void> {
    const g = await this.findOne(id);
    await this.repo.remove(g);
  }
}
