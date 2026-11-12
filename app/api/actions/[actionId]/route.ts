import { getAction } from "@/lib/services/action-service";
import { errorResponse } from "@/lib/utils/errors";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ actionId: string }> },
) {
  try {
    const { actionId } = await context.params;
    return Response.json({ action: getAction(actionId) });
  } catch (error) {
    return errorResponse(error);
  }
}
