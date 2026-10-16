"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Field, FormError, Input, Select } from "@/components/ui/form";
import { useI18n } from "@/lib/i18n/client";
import { useAction, useFieldError } from "@/lib/use-action";
import { classSchema, type ClassInput } from "@/lib/validation/schemas";
import { assignTeacherAction, deleteClassAction, removeTeacherAction, saveClassAction } from "@/server/actions/classes";
import type { z } from "zod";

type ClassOutput = z.output<typeof classSchema>;

export function ClassFormDialog({ value }: { value?: ClassInput & { id: string } }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const { run, pending } = useAction();
  const fe = useFieldError();
  const thisYear = new Date().getFullYear();
  const defaultYear = new Date().getMonth() >= 7 ? `${thisYear}-${thisYear + 1}` : `${thisYear - 1}-${thisYear}`;
  const form = useForm<ClassInput, unknown, ClassOutput>({
    resolver: zodResolver(classSchema),
    defaultValues: value ?? { name: "", kind: "class", grade: "", academic_year: defaultYear, is_active: true },
  });
  const errors = form.formState.errors;
  const onSubmit = form.handleSubmit(async (values) => {
    setServerError(null);
    const res = await run(() => saveClassAction({ ...values, id: value?.id }));
    if (res.ok) {
      setOpen(false);
      if (!value) form.reset();
    } else setServerError(res.error);
  });
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      closeLabel={t.common.close}
      title={value ? t.classes.editTitle : t.classes.add}
      trigger={
        value ? (
          <Button variant="ghost" size="icon" aria-label={t.common.edit}>
            <Pencil />
          </Button>
        ) : (
          <Button>
            <Plus /> {t.classes.add}
          </Button>
        )
      }
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <Field id="name" label={t.classes.name} error={fe(errors.name?.message)}>
          <Input id="name" aria-invalid={!!errors.name} {...form.register("name")} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field id="kind" label={t.classes.kind}>
            <Select id="kind" {...form.register("kind")}>
              <option value="class">{t.classes.kind_class}</option>
              <option value="group">{t.classes.kind_group}</option>
            </Select>
          </Field>
          <Field id="grade" label={t.classes.grade} error={fe(errors.grade?.message)}>
            <Input id="grade" type="number" min={0} max={12} {...form.register("grade")} />
          </Field>
          <Field id="academic_year" label={t.classes.year} error={fe(errors.academic_year?.message)}>
            <Input id="academic_year" placeholder="2026-2027" {...form.register("academic_year")} />
          </Field>
        </div>
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

export function DeleteClassButton({ id }: { id: string }) {
  const { t } = useI18n();
  const { run } = useAction();
  return (
    <ConfirmDialog
      danger
      title={t.common.confirmDeleteTitle}
      description={t.classes.deleteText}
      confirmLabel={t.common.delete}
      cancelLabel={t.common.cancel}
      onConfirm={async () => {
        await run(() => deleteClassAction(id));
      }}
      trigger={
        <Button variant="ghost" size="icon" aria-label={t.common.delete}>
          <Trash2 />
        </Button>
      }
    />
  );
}

export function ClassTeachers({
  classId,
  assigned,
  available,
  manage,
}: {
  classId: string;
  assigned: Array<{ id: string; name: string }>;
  available: Array<{ id: string; name: string }>;
  manage: boolean;
}) {
  const { t } = useI18n();
  const { run, pending } = useAction();
  const [pick, setPick] = useState("");
  const options = available.filter((a) => !assigned.some((x) => x.id === a.id));
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {assigned.length === 0 ? <span className="text-sm text-muted">{t.classes.noTeachers}</span> : null}
      {assigned.map((a) => (
        <span key={a.id} className="inline-flex items-center gap-1 rounded-full bg-surface px-2.5 py-0.5 text-xs">
          {a.name}
          {manage ? (
            <button
              type="button"
              className="rounded-full p-0.5 text-muted hover:text-danger"
              aria-label={`${t.classes.removeTeacher}: ${a.name}`}
              onClick={() => run(() => removeTeacherAction(classId, a.id))}
            >
              <X className="size-3" />
            </button>
          ) : null}
        </span>
      ))}
      {manage && options.length ? (
        <span className="inline-flex items-center gap-1">
          <label className="sr-only" htmlFor={`assign-${classId}`}>
            {t.classes.assignTeacher}
          </label>
          <select id={`assign-${classId}`} value={pick} onChange={(e) => setPick(e.target.value)} className="h-7 rounded-full border border-line bg-white px-2 text-xs">
            <option value="">{t.classes.assignTeacher}…</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            variant="secondary"
            className="h-7"
            disabled={!pick}
            loading={pending}
            onClick={async () => {
              const res = await run(() => assignTeacherAction(classId, pick));
              if (res.ok) setPick("");
            }}
          >
            {t.common.add}
          </Button>
        </span>
      ) : null}
    </div>
  );
}
