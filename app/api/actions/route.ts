import { z } from "zod";
import {
  buildManualDraft,
  createDraftAction,
  listActions,
} from "@/lib/services/action-service";
import { getInvoiceById } from "@/lib/services/invoice-service";
import { AppError, errorResponse } from "@/lib/utils/errors";
import type { AgentAction } from "@/lib/types";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  invoiceId: z.string().min(1).max(200),
  tone: z.enum(["friendly", "professional", "firm"]).optional(),
});

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const status = url.searchParams.get("status") as
      | AgentAction["status"]
      | null;
    const items = listActions({
      status: status ?? undefined,
      limit: 100,
    });
    return Response.json({ items });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const parsed = createSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success) {
      throw new AppError(
        "VALIDATION_ERROR",
        "Provide a valid invoiceId and optional tone.",
      );
    }

    const invoice = await getInvoiceById(parsed.data.invoiceId);
    const draft = buildManualDraft(invoice, parsed.data.tone ?? "professional");
    const action = createDraftAction({
      invoice,
      subject: draft.subject,
      message: draft.message,
      rationale:
        "Draft created manually from the invoice screen. PayPilot has not sent anything.",
      origin: "MANUAL",
    });

    return Response.json({ action }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
