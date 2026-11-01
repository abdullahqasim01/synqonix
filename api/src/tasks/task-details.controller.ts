import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiParam, ApiTags } from '@nestjs/swagger';
import type { Membership } from '../generated/prisma/client.js';
import { CurrentMembership, RequirePermission, WorkspaceGuard } from '../permissions/workspace.guard.js';
import { ActivityService } from './activity.service.js';
import { ConfirmUploadDto, DownloadUrlDto, RequestUploadDto, UploadTargetDto } from '../storage/storage.dto.js';
import { AttachmentsService } from './attachments.service.js';
import { ChecklistsService } from './checklists.service.js';
import { CommentsService } from './comments.service.js';
import {
  ActivityQueryDto, CommentBodyDto, CommentDto, CreateChecklistDto, CreateChecklistItemDto,
  CreateRelationDto, UpdateChecklistDto, UpdateChecklistItemDto,
} from './dto/details.dto.js';
import { ActivityDto, AttachmentDto, ChecklistDto } from './dto/task.dto.js';
import { RelationsService } from './relations.service.js';
import { TaskAccessService } from './task-access.service.js';
import { WatchersService } from './watchers.service.js';


/** Everything that hangs off a single task: comments, checklists, relations, files, activity. */
@ApiTags('tasks')
@ApiBearerAuth()
@UseGuards(WorkspaceGuard)
@ApiParam({ name: 'workspaceId', type: String })
@ApiParam({ name: 'taskId', type: String })
@Controller('workspaces/:workspaceId/tasks/:taskId')
export class TaskDetailsController {
  constructor(
    private readonly comments: CommentsService,
    private readonly checklists: ChecklistsService,
    private readonly relations: RelationsService,
    private readonly watchers: WatchersService,
    private readonly attachments: AttachmentsService,
    private readonly activity: ActivityService,
    private readonly access: TaskAccessService,
  ) {}

  // ----- activity -----

  @Get('activity') @RequirePermission('task.read')
  @ApiOkResponse({ type: [ActivityDto] })
  async history(@CurrentMembership() m: Membership, @Param('taskId') ref: string, @Query() q: ActivityQueryDto) {
    const { task } = await this.access.load(m, ref);
    return this.activity.list(task.id, q.limit, q.before);
  }

  // ----- comments -----

  @Get('comments') @RequirePermission('task.read')
  @ApiOkResponse({ type: [CommentDto] })
  listComments(@CurrentMembership() m: Membership, @Param('taskId') ref: string) {
    return this.comments.list(m, ref);
  }

  @Post('comments') @RequirePermission('task.write')
  @ApiCreatedResponse({ type: CommentDto })
  addComment(@CurrentMembership() m: Membership, @Param('taskId') ref: string, @Body() dto: CommentBodyDto) {
    return this.comments.create(m, ref, dto.body);
  }

  @Patch('comments/:commentId') @RequirePermission('task.write')
  @ApiOkResponse({ type: CommentDto })
  editComment(@CurrentMembership() m: Membership, @Param('taskId') ref: string, @Param('commentId') id: string, @Body() dto: CommentBodyDto) {
    return this.comments.update(m, ref, id, dto.body);
  }

  @Delete('comments/:commentId') @HttpCode(204) @RequirePermission('task.write')
  deleteComment(@CurrentMembership() m: Membership, @Param('taskId') ref: string, @Param('commentId') id: string) {
    return this.comments.remove(m, ref, id);
  }

  // ----- checklists -----

  @Post('checklists') @RequirePermission('task.write')
  @ApiCreatedResponse({ type: ChecklistDto })
  addChecklist(@CurrentMembership() m: Membership, @Param('taskId') ref: string, @Body() dto: CreateChecklistDto) {
    return this.checklists.create(m, ref, dto.title);
  }

  @Patch('checklists/:checklistId') @RequirePermission('task.write')
  @ApiOkResponse({ type: ChecklistDto })
  renameChecklist(@CurrentMembership() m: Membership, @Param('taskId') ref: string, @Param('checklistId') id: string, @Body() dto: UpdateChecklistDto) {
    return this.checklists.rename(m, ref, id, dto.title);
  }

  @Delete('checklists/:checklistId') @HttpCode(204) @RequirePermission('task.write')
  deleteChecklist(@CurrentMembership() m: Membership, @Param('taskId') ref: string, @Param('checklistId') id: string) {
    return this.checklists.remove(m, ref, id);
  }

  @Post('checklists/:checklistId/items') @RequirePermission('task.write')
  @ApiCreatedResponse({ type: ChecklistDto })
  addItem(@CurrentMembership() m: Membership, @Param('taskId') ref: string, @Param('checklistId') id: string, @Body() dto: CreateChecklistItemDto) {
    return this.checklists.addItem(m, ref, id, dto.text);
  }

  @Patch('checklists/:checklistId/items/:itemId') @RequirePermission('task.write')
  @ApiOkResponse({ type: ChecklistDto })
  updateItem(
    @CurrentMembership() m: Membership, @Param('taskId') ref: string, @Param('checklistId') id: string,
    @Param('itemId') itemId: string, @Body() dto: UpdateChecklistItemDto,
  ) {
    return this.checklists.updateItem(m, ref, id, itemId, dto);
  }

  @Delete('checklists/:checklistId/items/:itemId') @RequirePermission('task.write')
  @ApiOkResponse({ type: ChecklistDto })
  deleteItem(@CurrentMembership() m: Membership, @Param('taskId') ref: string, @Param('checklistId') id: string, @Param('itemId') itemId: string) {
    return this.checklists.removeItem(m, ref, id, itemId);
  }

  // ----- relations -----

  @Post('relations') @HttpCode(204) @RequirePermission('task.write')
  addRelation(@CurrentMembership() m: Membership, @Param('taskId') ref: string, @Body() dto: CreateRelationDto) {
    return this.relations.add(m, ref, dto.type, dto.targetTask);
  }

  @Delete('relations/:relationId') @HttpCode(204) @RequirePermission('task.write')
  removeRelation(@CurrentMembership() m: Membership, @Param('taskId') ref: string, @Param('relationId') id: string) {
    return this.relations.remove(m, ref, id);
  }

  // ----- watchers -----

  @Put('watch') @HttpCode(204) @RequirePermission('task.read')
  watch(@CurrentMembership() m: Membership, @Param('taskId') ref: string) {
    return this.watchers.watch(m, ref);
  }

  @Delete('watch') @HttpCode(204) @RequirePermission('task.read')
  unwatch(@CurrentMembership() m: Membership, @Param('taskId') ref: string) {
    return this.watchers.unwatch(m, ref);
  }

  // ----- attachments -----

  /** Step 1 of an upload: get a presigned link, then `PUT` the file to it. */
  @Post('attachments/upload-url') @RequirePermission('task.write')
  @ApiCreatedResponse({ type: UploadTargetDto })
  requestUpload(@CurrentMembership() m: Membership, @Param('taskId') ref: string, @Body() dto: RequestUploadDto) {
    return this.attachments.requestUpload(m, ref, dto);
  }

  /** Step 2: confirm the upload so the file shows up on the task. */
  @Post('attachments') @RequirePermission('task.write')
  @ApiCreatedResponse({ type: AttachmentDto })
  confirmUpload(@CurrentMembership() m: Membership, @Param('taskId') ref: string, @Body() dto: ConfirmUploadDto) {
    return this.attachments.confirmUpload(m, ref, dto.uploadToken);
  }

  /** A short-lived presigned link; the file is always served as a download, never inline. */
  @Get('attachments/:attachmentId/download-url') @RequirePermission('task.read')
  @ApiOkResponse({ type: DownloadUrlDto })
  downloadUrl(@CurrentMembership() m: Membership, @Param('taskId') ref: string, @Param('attachmentId') id: string) {
    return this.attachments.downloadUrl(m, ref, id);
  }

  @Delete('attachments/:attachmentId') @HttpCode(204) @RequirePermission('task.write')
  deleteAttachment(@CurrentMembership() m: Membership, @Param('taskId') ref: string, @Param('attachmentId') id: string) {
    return this.attachments.remove(m, ref, id);
  }
}
