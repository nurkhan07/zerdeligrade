"use client";
import Link from "next/link";
import { useState } from "react";
import { Badge, RESULT_STATUS_TONE } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { formatDateTime, formatNumber, formatPercent } from "@/lib/i18n/format";
import { useI18n } from "@/lib/i18n/client";
import { useAction } from "@/lib/use-action";
import { finalizeManyAction } from "@/server/actions/results";

export interface ResultListRow {
  id: string;
  student: string | null;
  className: string | null;
  test: string;
  centerCode: string | null;
  score: number;
  maxScore: number;
  percentage: number;
  status: string;
  openWarnings: number;
  submittedAt: string;
  source: "scan" | "manual";
  isDemo: boolean;
}

export function ResultsTable({ rows, showCenter, canFinalize }: { rows: ResultListRow[]; showCenter: boolean; canFinalize: boolean }) {
  const { t, locale } = useI18n();
  const { run, pending } = useAction();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const selectable = rows.filter((r) => canFinalize && r.status !== "finalized" && r.status !== "voided" && r.openWarnings === 0 && r.student);
  const toggle = (id: string) =>
    setSelected((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <>
      {selectable.length ? (
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={selected.size > 0 && selected.size === selectable.length}
              onChange={(e) => setSelected(e.target.checked ? new Set(selectable.map((r) => r.id)) : new Set())}
            />
            {t.results.selectAll}
          </label>
          <Button
            size="sm"
            disabled={selected.size === 0}
            loading={pending}
            onClick={async () => {
              const res = await run(() => finalizeManyAction([...selected]));
              if (res.ok) setSelected(new Set());
            }}
          >
            {t.results.batchFinalize} ({selected.size})
          </Button>
        </div>
      ) : null}
      <Table>
        <THead>
          <tr>
            {selectable.length ? <TH className="w-10"><span className="sr-only">{t.results.selectAll}</span></TH> : null}
            <TH>{t.results.student}</TH>
            <TH>{t.common.test}</TH>
            {showCenter ? <TH>{t.common.center}</TH> : null}
            <TH className="text-right">{t.results.score}</TH>
            <TH className="text-right">{t.results.percentage}</TH>
            <TH>{t.common.status}</TH>
            <TH>{t.results.submitted}</TH>
          </tr>
        </THead>
        <tbody>
          {rows.map((r) => {
            const canSelect = selectable.some((s) => s.id === r.id);
            return (
              <TR key={r.id} className={r.status === "voided" ? "text-muted line-through decoration-muted/60" : undefined}>
                {selectable.length ? (
                  <TD>
                    {canSelect ? (
                      <input type="checkbox" aria-label={r.student ?? r.id} className="size-4 accent-primary" checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                    ) : null}
                  </TD>
                ) : null}
                <TD className="font-medium">
                  <Link href={`/results/${r.id}`} className="hover:text-primary">
                    {r.student ?? <span className="text-warning">{t.results.noStudent}</span>}
                  </Link>
                  {r.className ? <span className="ml-1 text-xs text-muted">{r.className}</span> : null}
                  {r.isDemo ? <Badge tone="accent" className="ml-2">{t.common.demo}</Badge> : null}
                </TD>
                <TD>
                  {r.test}
                  {r.source === "manual" ? <span className="ml-1 text-xs text-muted">({t.results.source_manual})</span> : null}
                </TD>
                {showCenter ? <TD className="text-muted">{r.centerCode}</TD> : null}
                <TD className="tabular text-right">
                  {formatNumber(r.score, locale, 2)} / {formatNumber(r.maxScore, locale, 2)}
                </TD>
                <TD className="tabular text-right font-medium">{formatPercent(r.percentage, locale)}</TD>
                <TD>
                  <div className="flex flex-wrap items-center gap-1">
                    <Badge tone={RESULT_STATUS_TONE[r.status]}>{t.results[`status_${r.status}` as "status_finalized"]}</Badge>
                    {r.openWarnings > 0 && r.status === "needs_review" ? <Badge tone="warning">⚠ {r.openWarnings}</Badge> : null}
                  </div>
                </TD>
                <TD className="whitespace-nowrap text-muted">{formatDateTime(r.submittedAt, locale)}</TD>
              </TR>
            );
          })}
        </tbody>
      </Table>
    </>
  );
}
