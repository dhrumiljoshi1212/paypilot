import { getAllInvoices, refreshInvoices } from "@/lib/services/invoice-service";
import { errorResponse } from "@/lib/utils/errors";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    if (url.searchParams.get("refresh") === "1") {
      const result = await refreshInvoices();
      const items = await getAllInvoices({ autoSync: false });
      return Response.json({
        items,
        page: 1,
        hasMore: false,
        source: result.source,
        refreshed: result.count,
      });
    }

    const items = await getAllInvoices();
    return Response.json({
      items,
      page: 1,
      hasMore: false,
      source: items[0]?.source ?? "DEMO",
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST() {
  try {
    const result = await refreshInvoices();
    const items = await getAllInvoices({ autoSync: false });
    return Response.json({
      items,
      page: 1,
      hasMore: false,
      source: result.source,
      refreshed: result.count,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
