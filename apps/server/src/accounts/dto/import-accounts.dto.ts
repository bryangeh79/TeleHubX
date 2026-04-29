import { IsIn, IsOptional, IsString } from 'class-validator';

export interface CsvAccountRow {
  phoneNumber: string;
  role?: string;
  proxyHost?: string;
  proxyPort?: string;
  proxyUsername?: string;
  proxyPassword?: string;
}

export interface ImportResult {
  total: number;
  created: number;
  skipped: number;
  errors: Array<{ row: number; phone: string; reason: string }>;
}
