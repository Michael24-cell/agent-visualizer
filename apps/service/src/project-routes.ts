import type { FastifyInstance } from 'fastify';
import { commitDiff, listCommits, similarFunctions } from './review.js';
import { z } from 'zod';
import {
  AgentCommandSchema,
  AgentIdSchema,
  ApplyMethodCommandSchema,
  AttachRepositoryCommandSchema,
  FolderListingSchema,
  BriefFieldCommandSchema,
  BriefFieldIdSchema,
  MethodDefinitionSchema,
  MethodOverrideCommandSchema,
  MethodResetCommandSchema,
  PlanSectionCommandSchema,
  AskDecisionCommandSchema,
  AskIdSchema,
  CommandErrorSchema,
  CommandResponseSchema,
  CreateAgentCommandSchema,
  CreateProjectCommandSchema,
  MessagesPageSchema,
  MessagesQuerySchema,
  PostMessageCommandSchema,
  ProjectEventsPageSchema,
  ProjectFileSchema,
  ProjectIdSchema,
  ProjectListResponseSchema,
  ProjectResponseSchema,
  ProposalDecisionCommandSchema,
  ProposalIdSchema,
  RenameAgentCommandSchema,
  RenameProjectCommandSchema,
  ArchiveProjectCommandSchema,
  CreateFolderCommandSchema,
  SetTrustCommandSchema,
  SetAgentModelCommandSchema,
} from '@harness/contracts';
import { METHOD_CATALOG } from '@harness/runtime-simulated';
import { execFile } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { extname } from 'node:path';
import { FolderError, createFolder, listFolders } from './folders.js';
import {
  IMAGE_EXTENSIONS,
  ProjectCommandError,
  commandErrorStatus,
  type ProjectService,
} from './projects.js';

const ProjectParams = z.strictObject({ projectId: ProjectIdSchema });
const ThreadParams = ProjectParams.extend({ threadId: z.string().min(1) });
const AgentParams = ProjectParams.extend({ agentId: AgentIdSchema });
const AskParams = AgentParams.extend({ askId: AskIdSchema });
const ProposalParams = ProjectParams.extend({ proposalId: ProposalIdSchema });

// Every route: validate params and body at the boundary, run the command,
// validate the response, and map command errors to status codes.
export function registerProjectRoutes(
  service: FastifyInstance,
  projects: ProjectService,
): void {
  const handle = <T>(work: () => T) => {
    try {
      return { ok: true as const, value: work() };
    } catch (error) {
      if (error instanceof ProjectCommandError) {
        return {
          ok: false as const,
          status: commandErrorStatus(error.code),
          body: CommandErrorSchema.parse({
            error: error.message,
            code: error.code,
          }),
        };
      }
      throw error;
    }
  };

  const invalid = (what: string) =>
    CommandErrorSchema.parse({
      error: `Invalid ${what}.`,
      code: 'invalid_command',
    });

  service.get('/api/projects', async () =>
    ProjectListResponseSchema.parse(projects.listProjects()),
  );

  service.post('/api/projects', async (request, reply) => {
    const command = CreateProjectCommandSchema.safeParse(request.body);
    if (!command.success) {
      return reply.code(400).send(invalid('project command'));
    }
    const result = handle(() => projects.createProject(command.data));
    if (!result.ok) return reply.code(result.status).send(result.body);
    return reply
      .code(result.value.receipt.replayed ? 200 : 201)
      .send(CommandResponseSchema.parse(result.value));
  });

  service.get('/api/projects/:projectId', async (request, reply) => {
    const params = ProjectParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send(invalid('project id'));
    const result = handle(() => projects.getProject(params.data.projectId));
    if (!result.ok) return reply.code(result.status).send(result.body);
    return ProjectResponseSchema.parse(result.value);
  });

  service.get('/api/projects/:projectId/events', async (request, reply) => {
    const params = ProjectParams.safeParse(request.params);
    const query = z
      .strictObject({ after: z.coerce.number().int().nonnegative().default(0) })
      .safeParse(request.query);
    if (!params.success || !query.success) {
      return reply.code(400).send(invalid('event cursor'));
    }
    const result = handle(() =>
      projects.listEvents(params.data.projectId, query.data.after),
    );
    if (!result.ok) return reply.code(result.status).send(result.body);
    return ProjectEventsPageSchema.parse(result.value);
  });

  service.post('/api/projects/:projectId/agents', async (request, reply) => {
    const params = ProjectParams.safeParse(request.params);
    const command = CreateAgentCommandSchema.safeParse(request.body);
    if (!params.success || !command.success) {
      return reply.code(400).send(invalid('agent command'));
    }
    const result = handle(() =>
      projects.createAgent(params.data.projectId, command.data),
    );
    if (!result.ok) return reply.code(result.status).send(result.body);
    return reply
      .code(result.value.receipt.replayed ? 200 : 201)
      .send(CommandResponseSchema.parse(result.value));
  });

  service.get(
    '/api/projects/:projectId/threads/:threadId/messages',
    async (request, reply) => {
      const params = ThreadParams.safeParse(request.params);
      const query = MessagesQuerySchema.safeParse(request.query);
      if (!params.success || !query.success) {
        return reply.code(400).send(invalid('message query'));
      }
      const result = handle(() =>
        projects.listMessages(
          params.data.projectId,
          params.data.threadId,
          query.data,
        ),
      );
      if (!result.ok) return reply.code(result.status).send(result.body);
      return MessagesPageSchema.parse(result.value);
    },
  );

  service.post(
    '/api/projects/:projectId/threads/:threadId/messages',
    async (request, reply) => {
      const params = ThreadParams.safeParse(request.params);
      const command = PostMessageCommandSchema.safeParse(request.body);
      if (!params.success) return reply.code(400).send(invalid('thread'));
      if (!command.success) {
        const tooLong = command.error.issues.some(
          (issue) => issue.code === 'too_big',
        );
        return reply.code(400).send(
          CommandErrorSchema.parse({
            error: tooLong
              ? 'Message is too long.'
              : 'Message needs a body, a commandId, and an expectedSequence.',
            code: tooLong ? 'message_too_long' : 'message_empty',
          }),
        );
      }
      const result = handle(() =>
        projects.postMessage(
          params.data.projectId,
          params.data.threadId,
          command.data,
        ),
      );
      if (!result.ok) return reply.code(result.status).send(result.body);
      return reply
        .code(result.value.receipt.replayed ? 200 : 201)
        .send(CommandResponseSchema.parse(result.value));
    },
  );

  service.get('/api/projects/:projectId/files', async (request, reply) => {
    const params = ProjectParams.safeParse(request.params);
    const query = z
      .strictObject({ path: z.string().min(1).max(1_000) })
      .safeParse(request.query);
    if (!params.success || !query.success) {
      return reply.code(400).send(invalid('file path'));
    }
    const result = handle(() =>
      projects.readProjectFile(params.data.projectId, query.data.path),
    );
    if (!result.ok) return reply.code(result.status).send(result.body);
    return ProjectFileSchema.parse(result.value);
  });

  // Review: near-duplicate functions in the folder, and its git history.
  // Read-only; the folder is the one attached to the project.
  service.get(
    '/api/projects/:projectId/review/similar',
    async (request, reply) => {
      const params = ProjectParams.safeParse(request.params);
      if (!params.success) return reply.code(400).send(invalid('project'));
      const target = handle(() => projects.reviewTarget(params.data.projectId));
      if (!target.ok) return reply.code(target.status).send(target.body);
      return similarFunctions(target.value.root, target.value.touched);
    },
  );

  service.get(
    '/api/projects/:projectId/review/commits',
    async (request, reply) => {
      const params = ProjectParams.safeParse(request.params);
      if (!params.success) return reply.code(400).send(invalid('project'));
      const target = handle(() => projects.reviewTarget(params.data.projectId));
      if (!target.ok) return reply.code(target.status).send(target.body);
      return listCommits(target.value.root);
    },
  );

  service.get(
    '/api/projects/:projectId/review/commits/:sha',
    async (request, reply) => {
      const params = ProjectParams.extend({
        sha: z.string().regex(/^[0-9a-f]{7,40}$/),
      }).safeParse(request.params);
      if (!params.success) return reply.code(400).send(invalid('commit id'));
      const target = handle(() => projects.reviewTarget(params.data.projectId));
      if (!target.ok) return reply.code(target.status).send(target.body);
      try {
        return await commitDiff(target.value.root, params.data.sha);
      } catch {
        return reply.code(404).send({
          error: 'That commit is not in this folder.',
          code: 'not_found',
        });
      }
    },
  );

  // Saving a file you edited in the artifacts viewer.
  service.post('/api/projects/:projectId/files', async (request, reply) => {
    const params = ProjectParams.safeParse(request.params);
    const body = z
      .strictObject({
        path: z.string().min(1).max(1_000),
        content: z.string().max(2_000_000),
        expectedModifiedAt: z.iso.datetime().optional(),
      })
      .safeParse(request.body);
    if (!params.success || !body.success) {
      return reply.code(400).send(invalid('file contents'));
    }
    const result = handle(() =>
      projects.writeProjectFile(
        params.data.projectId,
        body.data.path,
        body.data.content,
        body.data.expectedModifiedAt,
      ),
    );
    if (!result.ok) return reply.code(result.status).send(result.body);
    return ProjectFileSchema.parse(result.value);
  });

  // The file's bytes, for images (and anything else the viewer embeds).
  service.get('/api/projects/:projectId/files/raw', async (request, reply) => {
    const params = ProjectParams.safeParse(request.params);
    // `v` is a cache-buster the viewer adds; it carries no meaning here.
    const query = z
      .object({ path: z.string().min(1).max(1_000), v: z.string().optional() })
      .safeParse(request.query);
    if (!params.success || !query.success) {
      return reply.code(400).send(invalid('file path'));
    }
    const resolved = handle(() =>
      projects.resolveProjectFile(params.data.projectId, query.data.path),
    );
    if (!resolved.ok) return reply.code(resolved.status).send(resolved.body);
    let stats;
    try {
      stats = statSync(resolved.value);
    } catch {
      return reply.code(404).send(
        CommandErrorSchema.parse({
          error: `${query.data.path} was not found.`,
          code: 'not_found',
        }),
      );
    }
    if (!stats.isFile() || stats.size > 15 * 1024 * 1024) {
      return reply.code(413).send(
        CommandErrorSchema.parse({
          error: 'Only files up to 15 MB are served.',
          code: 'invalid_command',
        }),
      );
    }
    const type =
      IMAGE_EXTENSIONS[extname(query.data.path).toLowerCase()] ??
      'application/octet-stream';
    return reply
      .type(type)
      .header('cache-control', 'no-store')
      .send(readFileSync(resolved.value));
  });

  // Shows the file in Finder (macOS) or opens it with the default app.
  service.post(
    '/api/projects/:projectId/files/reveal',
    async (request, reply) => {
      const params = ProjectParams.safeParse(request.params);
      const body = z
        .strictObject({
          path: z.string().min(1).max(1_000),
          mode: z.enum(['reveal', 'open']).default('reveal'),
        })
        .safeParse(request.body);
      if (!params.success || !body.success) {
        return reply.code(400).send(invalid('reveal request'));
      }
      const resolved = handle(() =>
        projects.resolveProjectFile(params.data.projectId, body.data.path),
      );
      if (!resolved.ok) return reply.code(resolved.status).send(resolved.body);
      if (process.platform !== 'darwin') {
        return reply.code(501).send(
          CommandErrorSchema.parse({
            error: 'Reveal is only available on macOS in this build.',
            code: 'invalid_command',
          }),
        );
      }
      const args =
        body.data.mode === 'reveal' ? ['-R', resolved.value] : [resolved.value];
      await new Promise<void>((resolve, reject) => {
        execFile('/usr/bin/open', args, (error) =>
          error ? reject(error) : resolve(),
        );
      });
      return { ok: true };
    },
  );

  service.get('/api/folders', async (request, reply) => {
    const query = z
      .strictObject({ path: z.string().min(1).optional() })
      .safeParse(request.query);
    if (!query.success) return reply.code(400).send(invalid('folder path'));
    try {
      return FolderListingSchema.parse(
        listFolders(query.data.path, projects.folders),
      );
    } catch (error) {
      if (error instanceof FolderError) {
        return reply.code(error.code === 'folder_not_found' ? 404 : 403).send(
          CommandErrorSchema.parse({
            error: error.message,
            code: error.code,
          }),
        );
      }
      throw error;
    }
  });

  service.post('/api/folders', async (request, reply) => {
    const command = CreateFolderCommandSchema.safeParse(request.body);
    if (!command.success) {
      return reply.code(400).send(invalid('folder name'));
    }
    try {
      const path = createFolder(
        command.data.parent,
        command.data.name,
        projects.folders,
      );
      return reply
        .code(201)
        .send(FolderListingSchema.parse(listFolders(path, projects.folders)));
    } catch (error) {
      if (error instanceof FolderError) {
        const status =
          error.code === 'folder_not_found'
            ? 404
            : error.code === 'folder_exists'
              ? 409
              : 403;
        return reply.code(status).send(
          CommandErrorSchema.parse({
            error: error.message,
            code: error.code,
          }),
        );
      }
      throw error;
    }
  });

  service.post(
    '/api/projects/:projectId/repository',
    async (request, reply) => {
      const params = ProjectParams.safeParse(request.params);
      const command = AttachRepositoryCommandSchema.safeParse(request.body);
      if (!params.success || !command.success) {
        return reply.code(400).send(invalid('repository command'));
      }
      const result = handle(() =>
        projects.attachRepository(params.data.projectId, command.data),
      );
      if (!result.ok) return reply.code(result.status).send(result.body);
      return CommandResponseSchema.parse(result.value);
    },
  );

  service.get('/api/methods', async () => ({
    methods: z.array(MethodDefinitionSchema).parse(METHOD_CATALOG),
  }));

  service.post('/api/projects/:projectId/method', async (request, reply) => {
    const params = ProjectParams.safeParse(request.params);
    const command = ApplyMethodCommandSchema.safeParse(request.body);
    if (!params.success || !command.success) {
      return reply.code(400).send(invalid('method command'));
    }
    const result = handle(() =>
      projects.applyMethod(params.data.projectId, command.data),
    );
    if (!result.ok) return reply.code(result.status).send(result.body);
    return CommandResponseSchema.parse(result.value);
  });

  service.post(
    '/api/projects/:projectId/method/overrides',
    async (request, reply) => {
      const params = ProjectParams.safeParse(request.params);
      const command = MethodOverrideCommandSchema.safeParse(request.body);
      if (!params.success || !command.success) {
        return reply.code(400).send(invalid('method override'));
      }
      const result = handle(() =>
        projects.overrideMethod(params.data.projectId, command.data),
      );
      if (!result.ok) return reply.code(result.status).send(result.body);
      return CommandResponseSchema.parse(result.value);
    },
  );

  service.post(
    '/api/projects/:projectId/method/reset',
    async (request, reply) => {
      const params = ProjectParams.safeParse(request.params);
      const command = MethodResetCommandSchema.safeParse(request.body);
      if (!params.success || !command.success) {
        return reply.code(400).send(invalid('method reset'));
      }
      const result = handle(() =>
        projects.resetMethod(params.data.projectId, command.data),
      );
      if (!result.ok) return reply.code(result.status).send(result.body);
      return CommandResponseSchema.parse(result.value);
    },
  );

  service.post(
    '/api/projects/:projectId/plan/sections',
    async (request, reply) => {
      const params = ProjectParams.safeParse(request.params);
      const command = PlanSectionCommandSchema.safeParse(request.body);
      if (!params.success || !command.success) {
        return reply.code(400).send(invalid('plan section'));
      }
      const result = handle(() =>
        projects.editPlanSection(params.data.projectId, command.data),
      );
      if (!result.ok) return reply.code(result.status).send(result.body);
      return CommandResponseSchema.parse(result.value);
    },
  );

  service.post(
    '/api/projects/:projectId/brief/fields/:fieldId',
    async (request, reply) => {
      const params = ProjectParams.extend({
        fieldId: BriefFieldIdSchema,
      }).safeParse(request.params);
      const body = BriefFieldCommandSchema.omit({ fieldId: true }).safeParse(
        request.body,
      );
      if (!params.success || !body.success) {
        return reply.code(400).send(invalid('brief field command'));
      }
      const result = handle(() =>
        projects.updateBriefField(params.data.projectId, {
          ...body.data,
          fieldId: params.data.fieldId,
        }),
      );
      if (!result.ok) return reply.code(result.status).send(result.body);
      return CommandResponseSchema.parse(result.value);
    },
  );

  service.post(
    '/api/projects/:projectId/proposals/:proposalId',
    async (request, reply) => {
      const params = ProposalParams.safeParse(request.params);
      const command = ProposalDecisionCommandSchema.safeParse(request.body);
      if (!params.success || !command.success) {
        return reply.code(400).send(invalid('proposal decision'));
      }
      const result = handle(() =>
        projects.decideProposal(
          params.data.projectId,
          params.data.proposalId,
          command.data,
        ),
      );
      if (!result.ok) return reply.code(result.status).send(result.body);
      return CommandResponseSchema.parse(result.value);
    },
  );

  service.post(
    '/api/projects/:projectId/agents/:agentId/advance',
    async (request, reply) => {
      const params = AgentParams.safeParse(request.params);
      const command = AgentCommandSchema.safeParse(request.body);
      if (!params.success || !command.success) {
        return reply.code(400).send(invalid('advance command'));
      }
      const result = handle(() =>
        projects.advanceAgent(
          params.data.projectId,
          params.data.agentId,
          command.data,
        ),
      );
      if (!result.ok) return reply.code(result.status).send(result.body);
      return CommandResponseSchema.parse(result.value);
    },
  );

  service.post(
    '/api/projects/:projectId/agents/:agentId/asks/:askId',
    async (request, reply) => {
      const params = AskParams.safeParse(request.params);
      const command = AskDecisionCommandSchema.safeParse(request.body);
      if (!params.success || !command.success) {
        return reply.code(400).send(invalid('ask decision'));
      }
      const result = handle(() =>
        projects.decideAsk(
          params.data.projectId,
          params.data.agentId,
          params.data.askId,
          command.data,
        ),
      );
      if (!result.ok) return reply.code(result.status).send(result.body);
      return CommandResponseSchema.parse(result.value);
    },
  );

  service.post('/api/projects/:projectId/name', async (request, reply) => {
    const params = ProjectParams.safeParse(request.params);
    const command = RenameProjectCommandSchema.safeParse(request.body);
    if (!params.success || !command.success) {
      return reply.code(400).send(invalid('rename command'));
    }
    const result = handle(() =>
      projects.renameProject(params.data.projectId, command.data),
    );
    if (!result.ok) return reply.code(result.status).send(result.body);
    return CommandResponseSchema.parse(result.value);
  });

  service.post('/api/projects/:projectId/archive', async (request, reply) => {
    const params = ProjectParams.safeParse(request.params);
    const command = ArchiveProjectCommandSchema.safeParse(request.body);
    if (!params.success || !command.success) {
      return reply.code(400).send(invalid('archive command'));
    }
    const result = handle(() =>
      projects.archiveProject(params.data.projectId, command.data),
    );
    if (!result.ok) return reply.code(result.status).send(result.body);
    return CommandResponseSchema.parse(result.value);
  });

  service.delete('/api/projects/:projectId', async (request, reply) => {
    const params = ProjectParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send(invalid('project id'));
    const result = handle(() => projects.deleteProject(params.data.projectId));
    if (!result.ok) return reply.code(result.status).send(result.body);
    return reply.code(204).send();
  });

  service.post('/api/projects/:projectId/trust', async (request, reply) => {
    const params = ProjectParams.safeParse(request.params);
    const command = SetTrustCommandSchema.safeParse(request.body);
    if (!params.success || !command.success) {
      return reply.code(400).send(invalid('trust command'));
    }
    const result = handle(() =>
      projects.setTrust(params.data.projectId, command.data),
    );
    if (!result.ok) return reply.code(result.status).send(result.body);
    return CommandResponseSchema.parse(result.value);
  });

  service.post(
    '/api/projects/:projectId/agents/:agentId/name',
    async (request, reply) => {
      const params = AgentParams.safeParse(request.params);
      const command = RenameAgentCommandSchema.safeParse(request.body);
      if (!params.success || !command.success) {
        return reply.code(400).send(invalid('rename command'));
      }
      const result = handle(() =>
        projects.renameAgent(
          params.data.projectId,
          params.data.agentId,
          command.data,
        ),
      );
      if (!result.ok) return reply.code(result.status).send(result.body);
      return CommandResponseSchema.parse(result.value);
    },
  );

  service.post(
    '/api/projects/:projectId/agents/:agentId/model',
    async (request, reply) => {
      const params = AgentParams.safeParse(request.params);
      const command = SetAgentModelCommandSchema.safeParse(request.body);
      if (!params.success || !command.success) {
        return reply.code(400).send(invalid('model command'));
      }
      const result = handle(() =>
        projects.setAgentModel(
          params.data.projectId,
          params.data.agentId,
          command.data,
        ),
      );
      if (!result.ok) return reply.code(result.status).send(result.body);
      return CommandResponseSchema.parse(result.value);
    },
  );

  service.post(
    '/api/projects/:projectId/agents/:agentId/stop',
    async (request, reply) => {
      const params = AgentParams.safeParse(request.params);
      const command = AgentCommandSchema.safeParse(request.body);
      if (!params.success || !command.success) {
        return reply.code(400).send(invalid('stop command'));
      }
      const result = handle(() =>
        projects.stopAgent(
          params.data.projectId,
          params.data.agentId,
          command.data,
        ),
      );
      if (!result.ok) return reply.code(result.status).send(result.body);
      return CommandResponseSchema.parse(result.value);
    },
  );
}
