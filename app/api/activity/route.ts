import { listActivity } from "@/lib/db";
import { errorResponse } from "@/lib/utils/errors";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const limit = Math.min(
      200,
      Math.max(1, Number(url.searchParams.get("limit") ?? "100")),
    );
    return Response.json({ items: listActivity(limit) });
  } catch (error) {
    return errorResponse(error);
  }
}
