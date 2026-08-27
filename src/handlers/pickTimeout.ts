import { performAutoPick } from "../lib/autoPick.js";

/**
 * Durable fallback: EventBridge Scheduler invokes this directly at a pick's
 * deadline. In the common case a connected client's checkPickTimeout trigger
 * (see handlers/checkPickTimeout.ts) will have already resolved the pick by
 * the time this fires - performAutoPick no-ops safely when that's happened.
 */
export const handler = async (event: { draftId: string; pickNumber: number }): Promise<void> => {
  try {
    await performAutoPick(event.draftId, event.pickNumber);
  } catch (error) {
    console.error("Pick timeout error:", error);
    throw error;
  }
};
