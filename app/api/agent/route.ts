import { z } from "zod";
import { runAgent } from "@/lib/ai/agent";
import { AppError, errorResponse } from "@/lib/utils/errors";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const schema = z.object({
  message: z.string().min(1).max(2000),
  conversationId: z.string().max(200).optional(),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(6000),
      }),
    )
    .max(20)
    .optional(),
});

export async function POST(request: Request) {
  try {
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new AppError(
        "VALIDATION_ERROR",
        "Send a message between 1 and 2,000 characters.",
      );
    }

    const response = await runAgent(parsed.data);
    return Response.json(response);
  } catch (error) {
    return errorResponse(error);
  }
}
