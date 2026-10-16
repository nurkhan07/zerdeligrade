"use client";
import { Copy } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { useI18n } from "@/lib/i18n/client";
import { useAction } from "@/lib/use-action";
import { duplicateTestAction } from "@/server/actions/tests";

export function UseTemplateButton({ testId, disabled }: { testId: string; disabled?: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const { run } = useAction();
  return (
    <ConfirmDialog
      title={t.templates.useTitle}
      description={t.templates.useText}
      confirmLabel={t.templates.use}
      cancelLabel={t.common.cancel}
      onConfirm={async () => {
        const res = await run(() => duplicateTestAction(testId), { refresh: false, success: t.templates.created });
        if (res.ok && res.data) router.push(`/tests/${res.data.id}`);
      }}
      trigger={
        <Button variant="secondary" size="sm" disabled={disabled}>
          <Copy /> {t.templates.use}
        </Button>
      }
    />
  );
}
