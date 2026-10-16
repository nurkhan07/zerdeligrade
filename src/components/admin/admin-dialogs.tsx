"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { Pencil, Plus, UserPlus } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Checkbox, Field, FormError, Input, Select } from "@/components/ui/form";
import { useI18n } from "@/lib/i18n/client";
import { useAction, useFieldError } from "@/lib/use-action";
import { centerSchema, inviteSchema, type CenterInput, type InviteInput } from "@/lib/validation/schemas";
import { inviteUserAction, saveCenterAction, setCenterActiveAction, updateMembershipAction } from "@/server/actions/admin";

export function CenterFormDialog({ value }: { value?: CenterInput & { id: string } }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const { run, pending } = useAction();
  const fe = useFieldError();
  const form = useForm<CenterInput, unknown, z.output<typeof centerSchema>>({
    resolver: zodResolver(centerSchema),
    defaultValues: value ?? { name: "", code: "", city: "", address: "" },
  });
  const errors = form.formState.errors;
  const onSubmit = form.handleSubmit(async (values) => {
    setServerError(null);
    const res = await run(() => saveCenterAction({ ...values, id: value?.id }));
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
      title={value ? t.centers.editTitle : t.centers.add}
      trigger={
        value ? (
          <Button variant="ghost" size="icon" aria-label={t.common.edit}>
            <Pencil />
          </Button>
        ) : (
          <Button>
            <Plus /> {t.centers.add}
          </Button>
        )
      }
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <Field id="c-name" label={t.centers.name} error={fe(errors.name?.message)}>
          <Input id="c-name" aria-invalid={!!errors.name} {...form.register("name")} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="c-code" label={t.centers.code} hint={t.centers.codeHelp} error={errors.code?.message === "duplicate" ? t.centers.duplicateCode : fe(errors.code?.message)}>
            <Input id="c-code" className="uppercase" aria-invalid={!!errors.code} {...form.register("code")} />
          </Field>
          <Field id="c-city" label={t.centers.city} error={fe(errors.city?.message)}>
            <Input id="c-city" {...form.register("city")} />
          </Field>
        </div>
        <Field id="c-address" label={t.centers.address} optional optionalText={t.common.optional} error={fe(errors.address?.message)}>
          <Input id="c-address" {...form.register("address")} />
        </Field>
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

export function CenterActiveButton({ id, active }: { id: string; active: boolean }) {
  const { t } = useI18n();
  const { run, pending } = useAction();
  if (!active) {
    return (
      <Button variant="ghost" size="sm" loading={pending} onClick={() => run(() => setCenterActiveAction(id, true))}>
        {t.centers.activate}
      </Button>
    );
  }
  return (
    <ConfirmDialog
      danger
      title={t.centers.deactivate}
      description={t.centers.deactivateText}
      confirmLabel={t.centers.deactivate}
      cancelLabel={t.common.cancel}
      onConfirm={async () => {
        await run(() => setCenterActiveAction(id, false));
      }}
      trigger={
        <Button variant="ghost" size="sm">
          {t.centers.deactivate}
        </Button>
      }
    />
  );
}

export function InviteUserDialog({
  centers,
  roles,
  defaultCenter,
}: {
  centers: Array<{ id: string; name: string }>;
  roles: Array<"center_admin" | "teacher">;
  defaultCenter: string | null;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const { run, pending } = useAction();
  const fe = useFieldError();
  const form = useForm<InviteInput, unknown, z.output<typeof inviteSchema>>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { email: "", full_name: "", role: roles[roles.length - 1] ?? "teacher", center_id: defaultCenter ?? centers[0]?.id ?? "", can_finalize: true },
  });
  const errors = form.formState.errors;
  const onSubmit = form.handleSubmit(async (values) => {
    setServerError(null);
    const res = await run(() => inviteUserAction(values));
    if (res.ok) {
      setOpen(false);
      form.reset();
    } else setServerError(res.error);
  });
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      closeLabel={t.common.close}
      title={t.users.invite}
      description={t.users.inviteText}
      trigger={
        <Button disabled={!roles.length || !centers.length}>
          <UserPlus /> {t.users.invite}
        </Button>
      }
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <Field id="u-name" label={t.users.fullName} error={fe(errors.full_name?.message)}>
          <Input id="u-name" autoComplete="off" aria-invalid={!!errors.full_name} {...form.register("full_name")} />
        </Field>
        <Field id="u-email" label={t.users.email} error={fe(errors.email?.message)}>
          <Input id="u-email" type="email" autoComplete="off" aria-invalid={!!errors.email} {...form.register("email")} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="u-center" label={t.users.center}>
            <Select id="u-center" {...form.register("center_id")}>
              {centers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="u-role" label={t.users.role}>
            <Select id="u-role" {...form.register("role")}>
              {roles.map((r) => (
                <option key={r} value={r}>
                  {t.roles[r]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox {...form.register("can_finalize")} />
          {t.users.canFinalize}
        </label>
        <FormError message={serverError} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
            {t.common.cancel}
          </Button>
          <Button type="submit" loading={pending}>
            {t.users.invite}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function MembershipControls({
  id,
  role,
  active,
  canFinalize,
  roles,
  self,
}: {
  id: string;
  role: "center_admin" | "teacher";
  active: boolean;
  canFinalize: boolean;
  roles: Array<"center_admin" | "teacher">;
  self: boolean;
}) {
  const { t } = useI18n();
  const { run, pending } = useAction();
  const manageable = !self && roles.includes(role);
  if (!manageable) return <span className="text-xs text-muted">{self ? t.users.cannotChangeSelf : ""}</span>;
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {roles.length > 1 ? (
        <select
          aria-label={t.users.role}
          value={role}
          disabled={pending}
          onChange={(e) => run(() => updateMembershipAction(id, { role: e.target.value as "center_admin" | "teacher" }), { success: t.users.roleChanged })}
          className="h-8 rounded-full border border-line bg-white px-2 text-xs"
        >
          {roles.map((r) => (
            <option key={r} value={r}>
              {t.roles[r]}
            </option>
          ))}
        </select>
      ) : null}
      {role === "teacher" ? (
        <label className="flex items-center gap-1.5 text-xs">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={canFinalize}
            disabled={pending}
            onChange={(e) => run(() => updateMembershipAction(id, { can_finalize: e.target.checked }))}
          />
          {t.users.canFinalize}
        </label>
      ) : null}
      {active ? (
        <ConfirmDialog
          danger
          title={t.users.deactivate}
          description={t.centers.deactivateText}
          confirmLabel={t.users.deactivate}
          cancelLabel={t.common.cancel}
          onConfirm={async () => {
            await run(() => updateMembershipAction(id, { is_active: false }));
          }}
          trigger={
            <Button variant="ghost" size="sm">
              {t.users.deactivate}
            </Button>
          }
        />
      ) : (
        <Button variant="ghost" size="sm" loading={pending} onClick={() => run(() => updateMembershipAction(id, { is_active: true }))}>
          {t.users.activate}
        </Button>
      )}
    </div>
  );
}
