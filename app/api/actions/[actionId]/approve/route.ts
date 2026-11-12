import { z } from "zod";
import { approveAction } from "@/lib/services/action-service";
import { AppError, errorResponse } from "@/lib/utils/errors";

export const dynamic = "force-dynamic";

const schema = z.object({
  subject: z.string().max(200).optional(),
  message: z.string().max(4000).optional(),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ actionId: string }> },
) {
  try {
    const { actionId } = await context.params;
    const parsed = schema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      throw new AppError(
        "VALIDATION_ERROR",
        "The edited subject or message is not valid.",
      );
    }

    const action = approveAction(actionId, parsed.data);
    return Response.json({ action });
  } catch (error) {
    return errorResponse(error);
  }
}
