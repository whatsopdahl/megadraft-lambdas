import { SchedulerClient, CreateScheduleCommand, DeleteScheduleCommand } from "@aws-sdk/client-scheduler";
import { env } from "./env.js";

const scheduler = new SchedulerClient({});

function scheduleName(draftId: string, pickNumber: number): string {
  return `pt-${draftId}-${pickNumber}`;
}

/** Schedules a one-time invocation of the pickTimeout handler at the pick deadline. */
export async function schedulePickTimeout(draftId: string, pickNumber: number, deadline: Date): Promise<void> {
  const at = deadline.toISOString().replace(/\.\d{3}Z$/, "");

  await scheduler.send(
    new CreateScheduleCommand({
      Name: scheduleName(draftId, pickNumber),
      ScheduleExpression: `at(${at})`,
      FlexibleTimeWindow: { Mode: "OFF" },
      ActionAfterCompletion: "DELETE",
      Target: {
        Arn: env.pickTimeoutFunctionArn,
        RoleArn: env.schedulerRoleArn,
        Input: JSON.stringify({ draftId, pickNumber }),
      },
    }),
  );
}

/** Cancels a pending pick-timeout schedule (called when a pick is made before the deadline). */
export async function cancelPickTimeout(draftId: string, pickNumber: number): Promise<void> {
  try {
    await scheduler.send(new DeleteScheduleCommand({ Name: scheduleName(draftId, pickNumber) }));
  } catch (error) {
    if ((error as { name?: string }).name !== "ResourceNotFoundException") {
      throw error;
    }
  }
}
