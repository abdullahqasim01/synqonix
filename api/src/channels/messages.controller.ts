import {
  Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query, Res, UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiCreatedResponse, ApiOkResponse, ApiParam, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { Membership } from '../generated/prisma/client.js';
import { CurrentMembership, RequirePermission, WorkspaceGuard } from '../permissions/workspace.guard.js';
import { TaskRefDto } from '../tasks/dto/task.dto.js';
import {
  CreateTaskFromMessageDto, DiscussionDto, EditMessageDto, LinkTaskDto, ListMessagesQueryDto, MarkReadDto, MessageAttachmentDto,
  MessageDto, MessageListDto, PostMessageDto, RepliesQueryDto, TaskRefsQueryDto,
} from './dto/channels.dto.js';
import { MessagesService } from './messages.service.js';

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // hard ceiling; the configured limit is enforced in the service

@ApiTags('messages')
@ApiBearerAuth()
@UseGuards(WorkspaceGuard)
@ApiParam({ name: 'workspaceId', type: String })
@Controller('workspaces/:workspaceId')
export class MessagesController {
  constructor(private readonly messages: MessagesService) {}

  // ----- cross references -----

  /** Resolves task keys written in messages to cards, hiding tasks the caller cannot see. */
  @Get('task-refs') @RequirePermission('task.read')
  @ApiOkResponse({ type: [TaskRefDto] })
  taskRefs(@CurrentMembership() m: Membership, @Query() q: TaskRefsQueryDto) {
    return this.messages.taskRefs(m, q.keys);
  }

  @Get('tasks/:taskId/discussions') @RequirePermission('task.read')
  @ApiParam({ name: 'taskId', type: String })
  @ApiOkResponse({ type: [DiscussionDto] })
  discussions(@CurrentMembership() m: Membership, @Param('taskId') ref: string) {
    return this.messages.discussions(m, ref);
  }

  // ----- messages -----

  @Get('channels/:channelId/messages') @RequirePermission('workspace.read')
  @ApiParam({ name: 'channelId', type: String })
  @ApiOkResponse({ type: MessageListDto })
  list(@CurrentMembership() m: Membership, @Param('channelId') id: string, @Query() q: ListMessagesQueryDto) {
    return this.messages.list(m, id, q);
  }

  @Post('channels/:channelId/messages') @RequirePermission('workspace.read')
  @ApiParam({ name: 'channelId', type: String })
  @ApiCreatedResponse({ type: MessageDto })
  post(@CurrentMembership() m: Membership, @Param('channelId') id: string, @Body() dto: PostMessageDto) {
    return this.messages.post(m, id, dto);
  }

  @Post('channels/:channelId/read') @HttpCode(200) @RequirePermission('workspace.read')
  @ApiParam({ name: 'channelId', type: String })
  markRead(@CurrentMembership() m: Membership, @Param('channelId') id: string, @Body() dto: MarkReadDto) {
    return this.messages.markRead(m, id, dto.seq);
  }

  @Post('channels/:channelId/attachments') @RequirePermission('workspace.read')
  @ApiParam({ name: 'channelId', type: String })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } }, required: ['file'] } })
  @ApiCreatedResponse({ type: MessageAttachmentDto })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }))
  upload(@CurrentMembership() m: Membership, @Param('channelId') id: string, @UploadedFile() file: Express.Multer.File | undefined) {
    return this.messages.upload(m, id, file);
  }

  /** Always served as a download so uploaded files cannot run scripts on our origin. */
  @Get('channels/:channelId/attachments/:attachmentId/download') @RequirePermission('workspace.read')
  @ApiParam({ name: 'channelId', type: String })
  @ApiOkResponse({ description: 'The file contents' })
  async download(
    @CurrentMembership() m: Membership, @Param('channelId') id: string, @Param('attachmentId') attachmentId: string, @Res() res: Response,
  ) {
    const { stream, filename, size } = await this.messages.download(m, id, attachmentId);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', String(size));
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    stream.pipe(res);
  }

  @Get('channels/:channelId/messages/:messageId') @RequirePermission('workspace.read')
  @ApiParam({ name: 'channelId', type: String })
  @ApiOkResponse({ type: MessageDto })
  get(@CurrentMembership() m: Membership, @Param('channelId') id: string, @Param('messageId') messageId: string) {
    return this.messages.get(m, id, messageId);
  }

  @Get('channels/:channelId/messages/:messageId/replies') @RequirePermission('workspace.read')
  @ApiParam({ name: 'channelId', type: String })
  @ApiOkResponse({ type: MessageListDto })
  replies(@CurrentMembership() m: Membership, @Param('channelId') id: string, @Param('messageId') messageId: string, @Query() q: RepliesQueryDto) {
    return this.messages.replies(m, id, messageId, q);
  }

  @Patch('channels/:channelId/messages/:messageId') @RequirePermission('workspace.read')
  @ApiParam({ name: 'channelId', type: String })
  @ApiOkResponse({ type: MessageDto })
  edit(@CurrentMembership() m: Membership, @Param('channelId') id: string, @Param('messageId') messageId: string, @Body() dto: EditMessageDto) {
    return this.messages.edit(m, id, messageId, dto.body);
  }

  @Delete('channels/:channelId/messages/:messageId') @HttpCode(204) @RequirePermission('workspace.read')
  @ApiParam({ name: 'channelId', type: String })
  remove(@CurrentMembership() m: Membership, @Param('channelId') id: string, @Param('messageId') messageId: string) {
    return this.messages.remove(m, id, messageId);
  }

  // ----- reactions -----

  /** `emoji` is the URL-encoded emoji character. */
  @Put('channels/:channelId/messages/:messageId/reactions/:emoji') @RequirePermission('workspace.read')
  @ApiParam({ name: 'channelId', type: String })
  @ApiOkResponse({ type: MessageDto })
  react(@CurrentMembership() m: Membership, @Param('channelId') id: string, @Param('messageId') messageId: string, @Param('emoji') emoji: string) {
    return this.messages.react(m, id, messageId, emoji);
  }

  @Delete('channels/:channelId/messages/:messageId/reactions/:emoji') @RequirePermission('workspace.read')
  @ApiParam({ name: 'channelId', type: String })
  @ApiOkResponse({ type: MessageDto })
  unreact(@CurrentMembership() m: Membership, @Param('channelId') id: string, @Param('messageId') messageId: string, @Param('emoji') emoji: string) {
    return this.messages.unreact(m, id, messageId, emoji);
  }

  // ----- tasks -----

  @Post('channels/:channelId/messages/:messageId/tasks') @HttpCode(200) @RequirePermission('workspace.read')
  @ApiParam({ name: 'channelId', type: String })
  @ApiOkResponse({ type: MessageDto })
  link(@CurrentMembership() m: Membership, @Param('channelId') id: string, @Param('messageId') messageId: string, @Body() dto: LinkTaskDto) {
    return this.messages.linkTask(m, id, messageId, dto.taskRef);
  }

  @Delete('channels/:channelId/messages/:messageId/tasks/:taskRef') @RequirePermission('workspace.read')
  @ApiParam({ name: 'channelId', type: String })
  @ApiOkResponse({ type: MessageDto })
  unlink(@CurrentMembership() m: Membership, @Param('channelId') id: string, @Param('messageId') messageId: string, @Param('taskRef') ref: string) {
    return this.messages.unlinkTask(m, id, messageId, ref);
  }

  /** Turns a message into a task in the given project and links the two. */
  @Post('channels/:channelId/messages/:messageId/create-task') @HttpCode(200) @RequirePermission('workspace.read')
  @ApiParam({ name: 'channelId', type: String })
  @ApiOkResponse({ type: MessageDto })
  createTask(@CurrentMembership() m: Membership, @Param('channelId') id: string, @Param('messageId') messageId: string, @Body() dto: CreateTaskFromMessageDto) {
    return this.messages.createTask(m, id, messageId, dto);
  }
}
