"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/form";
import { useI18n } from "@/lib/i18n/client";
import { useAction } from "@/lib/use-action";
import { createSubjectAction, removeDemoDataAction, setSubjectActiveAction, updateProfileAction } from "@/server/actions/admin";

export function ProfileForm({ fullName }: { fullName: string }) {
  const { t } = useI18n();
  const { run, pending } = useAction();
  const [name, setName] = useState(fullName);
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => updateProfileAction(name));
      }}
    >
      <Field id="full-name" label={t.settings.fullName} className="min-w-64 flex-1">
        <Input id="full-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
      </Field>
      <Button type="submit" loading={pending} disabled={name.trim() === fullName}>
        {t.common.save}
      </Button>
    </form>
  );
}

export function AddSubjectForm() {
  const { t } = useI18n();
  const { run, pending } = useAction();
  const [v, setV] = useState({ code: "", name_kk: "", name_ru: "" });
  return (
    <form
      className="grid gap-3 sm:grid-cols-[1fr_2fr_2fr_auto] sm:items-end"
      onSubmit={async (e) => {
        e.preventDefault();
        const res = await run(() => createSubjectAction(v));
        if (res.ok) setV({ code: "", name_kk: "", name_ru: "" });
      }}
    >
      <Field id="s-code" label={t.settings.subjectCode}>
        <Input id="s-code" value={v.code} onChange={(e) => setV({ ...v, code: e.target.value })} placeholder="math" />
      </Field>
      <Field id="s-kk" label={t.settings.nameKk}>
        <Input id="s-kk" value={v.name_kk} onChange={(e) => setV({ ...v, name_kk: e.target.value })} />
      </Field>
      <Field id="s-ru" label={t.settings.nameRu}>
        <Input id="s-ru" value={v.name_ru} onChange={(e) => setV({ ...v, name_ru: e.target.value })} />
      </Field>
      <Button type="submit" loading={pending} disabled={!v.code || !v.name_kk || !v.name_ru}>
        {t.settings.addSubject}
      </Button>
    </form>
  );
}

export function SubjectToggle({ id, active }: { id: string; active: boolean }) {
  const { t } = useI18n();
  const { run, pending } = useAction();
  return (
    <Button variant="ghost" size="sm" loading={pending} onClick={() => run(() => setSubjectActiveAction(id, !active))}>
      {active ? t.students.deactivate : t.students.activate}
    </Button>
  );
}

export function RemoveDemoButton({ disabled }: { disabled: boolean }) {
  const { t } = useI18n();
  const { run } = useAction();
  return (
    <ConfirmDialog
      danger
      title={t.settings.removeDemo}
      description={t.settings.removeDemoText}
      confirmLabel={t.common.delete}
      cancelLabel={t.common.cancel}
      onConfirm={async () => {
        await run(() => removeDemoDataAction());
      }}
      trigger={
        <Button variant="danger" disabled={disabled}>
          {t.settings.removeDemo}
        </Button>
      }
    />
  );
}
