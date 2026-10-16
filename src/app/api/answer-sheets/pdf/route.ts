import { NextResponse, type NextRequest } from "next/server";
import { getAppContext } from "@/lib/auth/context";
import { logError } from "@/lib/errors";
import { renderSheetsPdf } from "@/lib/omr/pdf";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/utils";
import { buildSheetBatch } from "@/server/sheets";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const ctx = await getAppContext();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const batchId = request.nextUrl.searchParams.get("batch");
  if (!isUuid(batchId)) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  try {
    const supabase = await createClient();
    const batch = await buildSheetBatch(supabase, batchId);
    if (!batch) return NextResponse.json({ error: "not_found" }, { status: 404 });
    const pdf = await renderSheetsPdf(batch.pages, batch.title, batch.format);
    const safeName = `zerdeligrade-${batchId.slice(0, 8)}.pdf`;
    return new NextResponse(Buffer.from(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${safeName}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    logError("sheets.pdf", error, { batchId });
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
