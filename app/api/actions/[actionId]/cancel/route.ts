import { cancelAction } from "@/lib/services/action-service";
import { errorResponse } from "@/lib/utils/errors";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  context: { params: Promise<{ actionId: string }> },
) {
  try {
    const { actionId } = await context.params;
    const action = cancelAction(actionId);
    return Response.json({ action });
  } catch (error) {
    return errorResponse(error);
  }
}
