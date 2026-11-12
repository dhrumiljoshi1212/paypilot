import { z } from "zod";
import { executeAction, getAction } from "@/lib/services/action-service";
import { AppError, errorResponse } from "@/lib/utils/errors";

export const dynamic = "force-dynamic";

const schema = z.object({ actionId: z.string().min(1).max(200) });

/**
 * PayPal-centric alias for reminder execution.
 *
 * The action must already exist, be approved, and belong to the invoice in the
 * URL. This route never accepts an invoice ID alone: the human approval record
 * is the source of truth.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new AppError(
        "VALIDATION_ERROR",
        "Provide the approved actionId for this invoice.",
      );
    }

    const action = getAction(parsed.data.actionId);
    if (action.invoiceId !== decodeURIComponent(id)) {
      throw new AppError(
        "VALIDATION_ERROR",
        "That action does not belong to this invoice.",
      );
    }
    if (action.status !== "APPROVED") {
      throw new AppError(
        "CONFLICT",
        "The action must be approved before a reminder can be executed.",
      );
    }

    const executed = await executeAction(action.id);
    return Response.json({ action: executed });
  } catch (error) {
    return errorResponse(error);
  }
}
