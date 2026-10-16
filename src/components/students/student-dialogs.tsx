"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { FileUp, Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, FormError, Input, Select } from "@/components/ui/form";
import type { ImportPreview } from "@/lib/csv/students";
import { fmt } from "@/lib/i18n/config";
import { useI18n } from "@/lib/i18n/client";
import { useAction, useFieldError } from "@/lib/use-action";
import { studentSchema, type StudentInput, type StudentOutput } from "@/lib/validation/schemas";
import { importStudentsAction, previewStudentImportAction, saveStudentAction, setStudentStatusAction } from "@/server/actions/students";

interface ClassOption {
  id: string;
  name: string;
}

export function StudentFormDialog({ classes, student }: { classes: ClassOption[]; student?: StudentInput & { id: string } }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const { run, pending } = useAction();
  const fe = useFieldError();
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<StudentInput, unknown, StudentOutput>({
    resolver: zodResolver(studentSchema),
    defaultValues: student ?? { first_name: "", last_name: "", student_code: "", class_id: "", status: "active" },
  });
  const errors = form.formState.errors;

  const onSubmit = form.handleSubmit(async (values) => {
    setServerError(null);
    const res = await run(() => saveStudentAction({ ...values, id: student?.id }));
    if (res.ok) {
      setOpen(false);
      if (!student) form.reset();
    } else {
      setServerError(res.error);
      for (const [k, v] of Object.entries(res.fieldErrors ?? {})) form.setError(k as keyof StudentInput, { message: v });
    }
  });

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      closeLabel={t.common.close}
      title={student ? t.students.editTitle : t.students.add}
      trigger={
        student ? (
          <Button variant="ghost" size="icon" aria-label={t.common.edit}>
            <Pencil />
          </Button>
        ) : (
          <Button>
            <Plus /> {t.students.add}
          </Button>
        )
      }
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="last_name" label={t.students.lastName} error={fe(errors.last_name?.message)}>
            <Input id="last_name" autoComplete="off" aria-invalid={!!errors.last_name} {...form.register("last_name")} />
          </Field>
          <Field id="first_name" label={t.students.firstName} error={fe(errors.first_name?.message)}>
            <Input id="first_name" autoComplete="off" aria-invalid={!!errors.first_name} {...form.register("first_name")} />
          </Field>
        </div>
        <Field
          id="student_code"
          label={t.students.code}
          optional
          optionalText={t.common.optional}
          hint={t.students.codeHelp}
          error={errors.student_code?.message === "duplicateCode" ? t.students.duplicateCode : fe(errors.student_code?.message)}
        >
          <Input id="student_code" autoComplete="off" aria-invalid={!!errors.student_code} {...form.register("student_code")} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="class_id" label={t.students.class}>
            <Select id="class_id" {...form.register("class_id")}>
              <option value="">{t.students.noClass}</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="status" label={t.common.status}>
            <Select id="status" {...form.register("status")}>
              <option value="active">{t.students.status_active}</option>
              <option value="inactive">{t.students.status_inactive}</option>
              <option value="graduated">{t.students.status_graduated}</option>
            </Select>
          </Field>
        </div>
        <p className="text-xs text-muted">{t.students.privacyNote}</p>
        <FormError message={serverError} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
            {t.common.cancel}
          </Button>
          <Button type="submit" loading={pending}>
            {t.common.save}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function StudentStatusButton({ id, status }: { id: string; status: string }) {
  const { t } = useI18n();
  const { run, pending } = useAction();
  const next = status === "active" ? "inactive" : "active";
  return (
    <Button variant="ghost" size="sm" loading={pending} onClick={() => run(() => setStudentStatusAction(id, next), {})}>
      {status === "active" ? t.students.deactivate : t.students.activate}
    </Button>
  );
}

export function ImportStudentsDialog() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [csv, setCsv] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { run, pending } = useAction();

  async function onFile(file: File | undefined) {
    setPreview(null);
    setError(null);
    if (!file) return;
    if (file.size > 2_000_000) {
      setError(t.students.importTooMany);
      return;
    }
    const text = await file.text();
    setCsv(text);
    const res = await previewStudentImportAction(text);
    if (res.ok && res.data) setPreview(res.data);
    else if (!res.ok) setError(res.error);
  }

  const issueText = (issue: string) => (t.students as Record<string, string>)[`issue_${issue}`] ?? issue;

  return (
    <Dialog
      wide
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setPreview(null);
          setCsv(null);
          setError(null);
        }
      }}
      closeLabel={t.common.close}
      title={t.students.importTitle}
      description={t.students.importHelp}
      trigger={
        <Button variant="secondary">
          <FileUp /> {t.common.import}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <Field id="csv" label={t.students.importFile}>
          <Input id="csv" type="file" accept=".csv,text/csv" className="py-1.5" onChange={(e) => onFile(e.target.files?.[0])} />
        </Field>
        <FormError message={error} />
        {preview?.missingColumns.length ? <Notice tone="danger">{t.students.importMissingColumns}</Notice> : null}
        {preview?.tooManyRows ? <Notice tone="warning">{t.students.importTooMany}</Notice> : null}
        {preview && !preview.missingColumns.length ? (
          <>
            <p className="text-sm font-medium">{fmt(t.students.importPreview, { valid: preview.validCount, total: preview.rows.length })}</p>
            <div className="max-h-80 overflow-auto rounded-[var(--radius-control)] border border-line">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-surface text-xs text-muted">
                  <tr>
                    <th className="px-3 py-2">{t.students.line}</th>
                    <th className="px-3 py-2">{t.students.lastName}</th>
                    <th className="px-3 py-2">{t.students.firstName}</th>
                    <th className="px-3 py-2">{t.students.code}</th>
                    <th className="px-3 py-2">{t.students.class}</th>
                    <th className="px-3 py-2">{t.common.status}</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.slice(0, 300).map((r) => (
                    <tr key={r.line} className="border-t border-line">
                      <td className="tabular px-3 py-1.5 text-muted">{r.line}</td>
                      <td className="px-3 py-1.5">{r.raw.last_name}</td>
                      <td className="px-3 py-1.5">{r.raw.first_name}</td>
                      <td className="px-3 py-1.5">{r.raw.student_code}</td>
                      <td className="px-3 py-1.5">{r.raw.class_name}</td>
                      <td className="px-3 py-1.5">
                        <div className="flex flex-wrap gap-1">
                          {r.errors.map((e, i) => (
                            <Badge key={i} tone="danger">
                              {issueText(e.issue)}
                            </Badge>
                          ))}
                          {r.warnings.map((w, i) => (
                            <Badge key={`w${i}`} tone="warning">
                              {issueText(w.issue)}
                            </Badge>
                          ))}
                          {!r.errors.length && !r.warnings.length ? <Badge tone="success">OK</Badge> : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setOpen(false)}>
            {t.common.cancel}
          </Button>
          <Button
            disabled={!csv || !preview || preview.validCount === 0}
            loading={pending}
            onClick={async () => {
              if (!csv) return;
              const res = await run(() => importStudentsAction(csv));
              if (res.ok) setOpen(false);
            }}
          >
            {fmt(t.students.importDo, { count: preview?.validCount ?? 0 })}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
