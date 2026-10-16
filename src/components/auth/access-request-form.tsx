"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input, Select, Textarea } from "@/components/ui/form";
import { useI18n } from "@/lib/i18n/client";
import { requestAccessAction } from "@/server/actions/access";

export function AccessRequestForm({ centers, fullName }: { centers: Array<{ id: string; name: string; city: string }>; fullName: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [center, setCenter] = useState(centers[0]?.id ?? "");
  const [name, setName] = useState(fullName);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const res = await requestAccessAction(center, name, message);
          if (res.ok) router.refresh();
          else setError(res.error);
        });
      }}
    >
      <h2 className="text-lg font-semibold">{t.access.title}</h2>
      <Field id="ar-name" label={t.auth.fullName}>
        <Input id="ar-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} required />
      </Field>
      <Field id="ar-center" label={t.access.center}>
        <Select id="ar-center" value={center} onChange={(e) => setCenter(e.target.value)}>
          {centers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {c.city ? ` · ${c.city}` : ""}
            </option>
          ))}
        </Select>
      </Field>
      <Field id="ar-msg" label={t.access.message} hint={t.access.messageHint} optional optionalText={t.common.optional}>
        <Textarea id="ar-msg" rows={2} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={500} />
      </Field>
      <FormError message={error} />
      <Button type="submit" size="lg" loading={pending} disabled={!center || name.trim().length < 2}>
        {t.access.send}
      </Button>
    </form>
  );
}
