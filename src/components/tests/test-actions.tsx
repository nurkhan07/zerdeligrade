"use client";
import { Archive, ArchiveRestore, Copy, KeyRound, Printer, Send, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { useI18n } from "@/lib/i18n/client";
import { useAction } from "@/lib/use-action";
import {
  assignTestAction,
  deleteTestAction,
  duplicateTestAction,
  publishTestAction,
  setTestArchivedAction,
  unassignTestAction,
} from "@/server/actions/tests";

export function TestActions({
  testId,
  status,
  canEdit,
  canDuplicate,
  isTemplate,
}: {
  testId: string;
  status: "draft" | "published" | "archived";
  canEdit: boolean;
  canDuplicate: boolean;
  isTemplate: boolean;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const { run, pending } = useAction();
  return (
    <div className="flex flex-wrap gap-2">
      {status === "published" && !isTemplate ? (
        <>
          <Button asChild variant="secondary">
            <Link href={`/answer-sheets?test=${testId}`}>
              <Printer /> {t.tests.sheetsLink}
            </Link>
          </Button>
          <Button asChild variant="secondary">
            <Link href={`/print/answer-key/${testId}`} target="_blank">
              <KeyRound /> {t.tests.keyLink}
            </Link>
          </Button>
        </>
      ) : null}
      {canDuplicate ? (
        <Button
          variant="secondary"
          loading={pending}
          onClick={async () => {
            const res = await run(() => duplicateTestAction(testId), { refresh: false });
            if (res.ok && res.data) router.push(`/tests/${res.data.id}`);
          }}
        >
          <Copy /> {isTemplate ? t.templates.use : t.tests.duplicate}
        </Button>
      ) : null}
      {canEdit && status === "published" ? (
        <Button variant="secondary" loading={pending} onClick={() => run(() => setTestArchivedAction(testId, true))}>
          <Archive /> {t.tests.archive}
        </Button>
      ) : null}
      {canEdit && status === "archived" ? (
        <Button variant="secondary" loading={pending} onClick={() => run(() => setTestArchivedAction(testId, false))}>
          <ArchiveRestore /> {t.tests.unarchive}
        </Button>
      ) : null}
      {canEdit && status === "draft" ? (
        <>
          <ConfirmDialog
            danger
            title={t.common.confirmDeleteTitle}
            description={t.common.confirmDeleteText}
            confirmLabel={t.common.delete}
            cancelLabel={t.common.cancel}
            onConfirm={async () => {
              const res = await run(() => deleteTestAction(testId), { refresh: false });
              if (res.ok) router.push(isTemplate ? "/templates" : "/tests");
            }}
            trigger={
              <Button variant="ghost">
                <Trash2 /> {t.common.delete}
              </Button>
            }
          />
          <ConfirmDialog
            title={t.tests.publishConfirmTitle}
            description={t.tests.publishConfirmText}
            confirmLabel={t.tests.publish}
            cancelLabel={t.common.cancel}
            onConfirm={async () => {
              await run(() => publishTestAction(testId));
            }}
            trigger={
              <Button variant="accent">
                <Send /> {t.tests.publish}
              </Button>
            }
          />
        </>
      ) : null}
    </div>
  );
}

export function TestAssignments({
  testId,
  assigned,
  classes,
  canAssign,
}: {
  testId: string;
  assigned: Array<{ id: string; name: string }>;
  classes: Array<{ id: string; name: string }>;
  canAssign: boolean;
}) {
  const { t } = useI18n();
  const { run, pending } = useAction();
  const [pick, setPick] = useState("");
  const available = classes.filter((c) => !assigned.some((a) => a.id === c.id));
  return (
    <div className="flex flex-col gap-3">
      {assigned.length === 0 ? <p className="text-sm text-muted">{t.tests.noAssignments}</p> : null}
      <ul className="flex flex-wrap gap-2">
        {assigned.map((a) => (
          <li key={a.id} className="inline-flex items-center gap-2 rounded-full bg-surface px-3 py-1 text-sm">
            {a.name}
            {canAssign ? (
              <button type="button" className="text-xs text-muted hover:text-danger" onClick={() => run(() => unassignTestAction(testId, a.id))}>
                {t.tests.unassign}
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {canAssign && available.length ? (
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="assign-class" className="sr-only">
            {t.common.class}
          </label>
          <select id="assign-class" value={pick} onChange={(e) => setPick(e.target.value)} className="h-10 rounded-[var(--radius-control)] border border-line bg-white px-3 text-sm">
            <option value="">{t.common.select}</option>
            {available.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <Button
            variant="secondary"
            disabled={!pick}
            loading={pending}
            onClick={async () => {
              const res = await run(() => assignTestAction(testId, pick));
              if (res.ok) setPick("");
            }}
          >
            {t.tests.assign}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
