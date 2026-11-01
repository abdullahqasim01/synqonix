import { Body, Controller, Get, HttpCode, Param, Post, Query, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOkResponse, ApiParam, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { Membership } from '../generated/prisma/client.js';
import { CurrentMembership, RequirePermission, WorkspaceGuard } from '../permissions/workspace.guard.js';
import { ExportQueryDto, ImportOptionsDto, ImportResultDto } from './dto/dataio.dto.js';
import { ExportService } from './export.service.js';
import { ImportService } from './import.service.js';

const MAX_FILE_BYTES = 5 * 1024 * 1024;

@ApiTags('import-export')
@ApiBearerAuth()
@UseGuards(WorkspaceGuard)
@ApiParam({ name: 'workspaceId', type: String })
@ApiParam({ name: 'projectId', type: String })
@Controller('workspaces/:workspaceId/projects/:projectId')
export class DataIoController {
  constructor(
    private readonly exporter: ExportService,
    private readonly importer: ImportService,
  ) {}

  /** Downloads the project's tasks as CSV (default) or JSON. Cells that could run as spreadsheet formulas are neutralised. */
  @Get('export') @RequirePermission('task.read')
  @ApiOkResponse({ description: 'The file contents' })
  async export(@CurrentMembership() m: Membership, @Param('projectId') id: string, @Query() q: ExportQueryDto, @Res() res: Response) {
    const file = q.format === 'json' ? await this.exporter.json(m, id) : await this.exporter.csv(m, id);
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(file.body);
  }

  /** Imports a CSV (ours, Jira's or GitHub's columns) or our JSON export. Importing the same file again creates nothing new. */
  @Post('import') @HttpCode(200) @RequirePermission('task.write')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object', required: ['file'],
      properties: {
        file: { type: 'string', format: 'binary' }, source: { type: 'string', enum: ['csv', 'jira', 'github', 'synqonix'] },
        dryRun: { type: 'boolean' }, mapping: { type: 'string' },
      },
    },
  })
  @ApiOkResponse({ type: ImportResultDto })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_BYTES, files: 1 } }))
  import(
    @CurrentMembership() m: Membership, @Param('projectId') id: string, @UploadedFile() file: Express.Multer.File | undefined, @Body() opts: ImportOptionsDto,
  ) {
    return this.importer.run(m, id, file, opts);
  }
}
