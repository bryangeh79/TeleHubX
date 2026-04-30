import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

export enum ProtectedEntityType {
  PHONE = 'phone',
  EMAIL = 'email',
  URL = 'url',
  COMPANY = 'company',
  ADDRESS = 'address',
}

/**
 * Entities that the AI must preserve verbatim in any reply variation.
 * Auto-extracted from uploaded sources (regex) plus manual additions.
 */
@Entity('kb_protected')
@Unique(['kbId', 'entityType', 'value'])
export class KbProtected {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  @Index()
  kbId: string;

  @Column({ type: 'enum', enum: ProtectedEntityType })
  entityType: ProtectedEntityType;

  @Column()
  value: string;

  @Column({ type: 'uuid', nullable: true })
  sourceId: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
