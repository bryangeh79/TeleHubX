import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum KbSourceKind {
  TXT = 'txt',
  MD = 'md',
  PDF = 'pdf',
  DOCX = 'docx',
  MANUAL = 'manual',
  URL = 'url',
}

export enum KbSourceStatus {
  PENDING = 'pending',
  PROCESSED = 'processed',
  FAILED = 'failed',
}

/**
 * Uploaded source documents per knowledge base. After upload the parser
 * extracts plain text into `rawText`; chunking + embedding happens later
 * for FAQ generation.
 */
@Entity('kb_sources')
export class KbSource {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  @Index()
  kbId: string;

  @Column()
  fileName: string;

  @Column({ type: 'enum', enum: KbSourceKind, default: KbSourceKind.TXT })
  kind: KbSourceKind;

  @Column({ nullable: true })
  mime: string;

  @Column({ type: 'int', default: 0 })
  byteSize: number;

  @Column({ type: 'text', nullable: true })
  rawText: string | null;

  @Column({ type: 'enum', enum: KbSourceStatus, default: KbSourceStatus.PENDING })
  status: KbSourceStatus;

  @Column({ type: 'text', nullable: true })
  errorMsg: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  processedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
