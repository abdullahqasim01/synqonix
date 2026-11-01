import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

const toBool = ({ value }: { value: unknown }) => value === 'true' || value === true;

export class ExportQueryDto {
  @IsOptional() @IsIn(['csv', 'json']) format?: 'csv' | 'json';
}

export class ImportOptionsDto {
  /** Where the file comes from; ids are remembered per source so importing again changes nothing. */
  @IsOptional() @IsIn(['csv', 'jira', 'github', 'synqonix']) source?: 'csv' | 'jira' | 'github' | 'synqonix';
  /** Check the file and report what would happen without creating anything. */
  @IsOptional() @Transform(toBool) @IsBoolean() dryRun?: boolean;
  /** JSON object mapping column names to fields (`title`, `description`, `status`, `priority`, `type`, `assignees`, `labels`, `estimate`, `startDate`, `dueDate`, `parent`, `externalId`, `ignore`). */
  @IsOptional() @IsString() @MaxLength(5000) mapping?: string;
}

export class ImportMessageDto {
  level: 'error' | 'warning';
  text: string;
}

export class ImportRowDto {
  /** Line in the file (1 is the header). */
  row: number;
  status: 'created' | 'skipped' | 'error';
  /** Key of the created task, or of the one imported earlier. */
  key: string | null;
  messages: ImportMessageDto[];
}

export class ImportColumnDto {
  column: string;
  /** The field it feeds, or `ignore`. */
  field: string;
}

export class ImportResultDto {
  dryRun: boolean;
  source: string;
  total: number;
  /** With `dryRun`: how many would be created. */
  created: number;
  /** Rows that were imported before. */
  skipped: number;
  failed: number;
  warnings: number;
  columns: ImportColumnDto[];
  /** Rows with something to say (errors, warnings, skips), at most 500. */
  rows: ImportRowDto[];
  truncated: boolean;
}
