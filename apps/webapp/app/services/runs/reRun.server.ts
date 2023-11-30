import { Prisma, PrismaClient, prisma } from "~/db.server";
import { CreateRunService } from "../runs/createRun.server";

export class ReRunService {
  #prismaClient: PrismaClient;

  constructor(prismaClient: PrismaClient = prisma) {
    this.#prismaClient = prismaClient;
  }

  public async call({ runId }: { runId: string }) {
    try {
      return await this.#prismaClient.$transaction(async (tx) => {
        //get the run info required for a rerun
        const existingRun = await tx.jobRun.findUniqueOrThrow({
          include: {
            organization: true,
            project: true,
            environment: true,
            version: true,
            job: true,
            event: true,
            externalAccount: true,
          },
          where: {
            id: runId,
          },
        });

        const eventLog = await this.#prismaClient.eventRecord.create({
          data: {
            organization: {
              connect: {
                id: existingRun.environment.organizationId,
              },
            },
            project: {
              connect: {
                id: existingRun.environment.projectId,
              },
            },
            environment: {
              connect: {
                id: existingRun.environment.id,
              },
            },
            externalAccount: existingRun.externalAccount
              ? {
                  connect: {
                    id: existingRun.externalAccount.id,
                  },
                }
              : undefined,
            eventId: `${existingRun.id}-batch:retry:${new Date().getTime()}`,
            name: existingRun.event.name,
            timestamp: new Date(),
            // Get payload directly from Run if batched
            payload:
              existingRun.batched && existingRun.payload
                ? (JSON.parse(existingRun.payload) as Prisma.InputJsonValue)
                : existingRun.event.payload ?? {},
            context: existingRun.event.context ?? {},
            source: existingRun.event.source,
            isTest: existingRun.event.isTest,
          },
        });

        const createRunService = new CreateRunService(tx);

        return createRunService.call({
          environment: {
            ...existingRun.environment,
            organization: existingRun.organization,
            project: existingRun.project,
          },
          eventIds: [eventLog.id],
          job: existingRun.job,
          version: existingRun.version,
          batched: existingRun.batched,
        });
      });
    } catch (error) {
      throw error;
    }
  }
}
