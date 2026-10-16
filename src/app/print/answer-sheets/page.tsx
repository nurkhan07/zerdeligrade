import { notFound } from "next/navigation";
import { PrintToolbar } from "@/components/print-toolbar";
import { getI18n } from "@/lib/i18n/server";
import { renderSheetSvg } from "@/lib/omr/svg";
import { createClient } from "@/lib/supabase/server";
import { uuidParam } from "@/lib/utils";
import { buildSheetBatch } from "@/server/sheets";

export default async function PrintSheetsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { t } = await getI18n();
  const batchId = uuidParam((await searchParams).batch);
  if (!batchId) notFound();
  const supabase = await createClient();
  const batch = await buildSheetBatch(supabase, batchId);
  if (!batch) notFound();

  const svgs = batch.pages.map((page) => renderSheetSvg(page));
  // A5: two half-sheets side by side on an A4 landscape page, dashed cut line in the middle.
  const sheets =
    batch.format === "a5"
      ? Array.from({ length: Math.ceil(svgs.length / 2) }, (_, i) => (
          <div key={i} className="print-page relative flex bg-white shadow-lg" style={{ width: "297mm", height: "210mm" }}>
            <div style={{ width: "148.5mm", height: "210mm" }} dangerouslySetInnerHTML={{ __html: svgs[i * 2]! }} />
            <div className="absolute inset-y-0 left-1/2 border-l border-dashed border-neutral-400" aria-hidden />
            {svgs[i * 2 + 1] ? <div style={{ width: "148.5mm", height: "210mm" }} dangerouslySetInnerHTML={{ __html: svgs[i * 2 + 1]! }} /> : null}
          </div>
        ))
      : svgs.map((svg, i) => (
          // The SVG is generated server-side from trusted primitives; all text is escaped in renderSheetSvg.
          <div key={i} className="print-page bg-white shadow-lg" style={{ width: "210mm", height: "297mm" }} dangerouslySetInnerHTML={{ __html: svg }} />
        ));

  return (
    <>
      {batch.format === "a5" ? <style>{"@media print { @page { size: A4 landscape; margin: 0; } }"}</style> : null}
      <PrintToolbar
        title={`${t.sheets.title}: ${batch.title} (${batch.pages.length})`}
        note={batch.format === "a5" ? t.sheets.a5PrintTip : t.sheets.printTips}
        pdfHref={`/api/answer-sheets/pdf?batch=${batchId}`}
      />
      <div className="flex flex-col items-center gap-6 py-6 print:block print:p-0">{sheets}</div>
    </>
  );
}
