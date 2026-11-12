import {
  getInvoiceById,
  refreshInvoiceFromPayPal,
} from "@/lib/services/invoice-service";
import { AppError, errorResponse } from "@/lib/utils/errors";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    if (!id || id.length > 200) {
      throw new AppError("VALIDATION_ERROR", "A valid invoice ID is required.");
    }
    const url = new URL(request.url);
    const invoice =
      url.searchParams.get("refresh") === "1"
        ? await refreshInvoiceFromPayPal(decodeURIComponent(id))
        : await getInvoiceById(decodeURIComponent(id));
    return Response.json({ invoice });
  } catch (error) {
    return errorResponse(error);
  }
}
