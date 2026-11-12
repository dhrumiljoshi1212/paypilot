import { executeAction } from "@/lib/services/action-service";
import { errorResponse } from "@/lib/utils/errors";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(
  _request: Request,
  context: { params: Promise<{ actionId: string }> },
) {
  try {
    const { actionId } = await context.params;
    const action = await executeAction(actionId);
    return Response.json({ action });
  } catch (error) {
    return errorResponse(error);
  }
}
