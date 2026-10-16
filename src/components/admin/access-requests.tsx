"use client";
import { Check, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Field, Textarea } from "@/components/ui/form";
import { formatDateTime } from "@/lib/i18n/format";
import { useI18n } from "@/lib/i18n/client";
import { useAction } from "@/lib/use-action";
import { decideAccessRequestAction } from "@/server/actions/access";

export interface AccessRequestRow {
  id: string;
  fullName: string;
  email: string;
  center: string;
  message: string;
  createdAt: string;
}

export function AccessRequests({ rows }: { rows: AccessRequestRow[] }) {
  const { t, locale } = useI18n();
  const { run, pending } = useAction();
  const [reason, setReason] = useState("");
  if (!rows.length) return null;
  return (
    <Card className="mb-6 border-accent">
      <CardHeader title={`${t.access.requests} (${rows.length})`} description={t.access.requestsHelp} />
      <ul className="divide-y divide-line">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
            <div className="min-w-0">
              <p className="font-medium">{r.fullName}</p>
              <p className="truncate text-sm text-muted">
                {r.email} · {r.center} · {formatDateTime(r.createdAt, locale)}
              </p>
              {r.message ? <p className="mt-1 text-sm">“{r.message}”</p> : null}
            </div>
            <div className="flex gap-2">
              <Button size="sm" loading={pending} onClick={() => run(() => decideAccessRequestAction(r.id, true))}>
                <Check /> {t.access.approve}
              </Button>
              <ConfirmDialog
                danger
                title={t.access.rejectTitle}
                description={`${r.fullName} · ${r.email}`}
                confirmLabel={t.access.reject}
                cancelLabel={t.common.cancel}
                onConfirm={async () => {
                  const res = await run(() => decideAccessRequestAction(r.id, false, reason));
                  if (res.ok) setReason("");
                  return res.ok;
                }}
                trigger={
                  <Button size="sm" variant="secondary">
                    <X /> {t.access.reject}
                  </Button>
                }
              >
                <Field id={`rr-${r.id}`} label={t.access.rejectReason}>
                  <Textarea id={`rr-${r.id}`} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} />
                </Field>
              </ConfirmDialog>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
