"use client";
import { ArrowLeft, FileDown, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/client";

export function PrintToolbar({ title, pdfHref, note }: { title: string; pdfHref?: string; note?: string }) {
  const { t } = useI18n();
  return (
    <div className="no-print sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-line bg-white px-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <Button variant="ghost" size="icon" aria-label={t.common.back} onClick={() => history.back()}>
          <ArrowLeft />
        </Button>
        <div className="min-w-0">
          <p className="truncate font-medium">{title}</p>
          {note ? <p className="truncate text-xs text-muted">{note}</p> : null}
        </div>
      </div>
      <div className="flex gap-2">
        {pdfHref ? (
          <Button asChild variant="secondary">
            <a href={pdfHref}>
              <FileDown /> {t.sheets.downloadPdf}
            </a>
          </Button>
        ) : null}
        <Button variant="accent" onClick={() => window.print()}>
          <Printer /> {t.common.print}
        </Button>
      </div>
    </div>
  );
}
