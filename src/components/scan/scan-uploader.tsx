"use client";
import { AlertTriangle, Camera, CheckCircle2, Loader2, UploadCloud, X, XCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/form";
import { fmt } from "@/lib/i18n/config";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

const ACCEPT = ["image/jpeg", "image/png", "image/webp"];
const MAX_BYTES = 15 * 1024 * 1024;

interface Item {
  key: string;
  file: File;
  state: "queued" | "processing" | "done" | "failed";
  message?: string;
  resultId?: string;
  blocking?: number;
}

/**
 * Downscales large photos in the browser before upload (keeps uploads under
 * serverless body limits and speeds up mobile networks). EXIF orientation is
 * applied by createImageBitmap. Falls back to the original file.
 */
async function prepare(file: File): Promise<Blob> {
  try {
    if (typeof createImageBitmap !== "function") return file;
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, 2400 / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.size < 3_500_000) {
      bmp.close();
      return file;
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.9));
    return blob ?? file;
  } catch {
    return file;
  }
}

export function ScanUploader({ tests }: { tests: Array<{ id: string; title: string }> }) {
  const { t } = useI18n();
  const router = useRouter();
  const [testId, setTestId] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [running, setRunning] = useState(false);
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  function add(files: FileList | null) {
    if (!files) return;
    const next: Item[] = [];
    for (const f of Array.from(files)) {
      const key = `${f.name}-${f.size}-${f.lastModified}-${Math.random()}`;
      if (!ACCEPT.includes(f.type)) next.push({ key, file: f, state: "failed", message: t.recognition.unsupported_type });
      else if (f.size > MAX_BYTES) next.push({ key, file: f, state: "failed", message: t.recognition.too_large });
      else next.push({ key, file: f, state: "queued" });
    }
    setItems((p) => [...p, ...next]);
  }

  async function start() {
    setRunning(true);
    const batchId = crypto.randomUUID();
    for (const item of items) {
      if (item.state !== "queued") continue;
      setItems((p) => p.map((x) => (x.key === item.key ? { ...x, state: "processing" } : x)));
      try {
        const body = new FormData();
        body.append("file", await prepare(item.file), item.file.name.replace(/\.\w+$/, "") + ".jpg");
        if (testId) body.append("testId", testId);
        body.append("batchId", batchId);
        const res = await fetch("/api/scan", { method: "POST", body });
        const json = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string; resultId?: string; blockingWarnings?: number };
        setItems((p) =>
          p.map((x) =>
            x.key === item.key
              ? json.ok
                ? { ...x, state: "done", resultId: json.resultId, blocking: json.blockingWarnings ?? 0 }
                : { ...x, state: "failed", message: json.message ?? t.common.errorGeneric }
              : x,
          ),
        );
      } catch {
        setItems((p) => p.map((x) => (x.key === item.key ? { ...x, state: "failed", message: t.common.errorGeneric } : x)));
      }
    }
    setRunning(false);
    router.refresh();
  }

  const done = items.filter((i) => i.state === "done").length;
  const failed = items.filter((i) => i.state === "failed").length;
  const review = items.filter((i) => i.state === "done" && (i.blocking ?? 0) > 0).length;
  const queued = items.filter((i) => i.state === "queued").length;

  return (
    <div className="flex flex-col gap-5">
      <Field id="scan-test" label={t.scan.chooseTest} hint={testId ? undefined : t.scan.autoDetectHelp}>
        <Select id="scan-test" value={testId} onChange={(e) => setTestId(e.target.value)} disabled={running}>
          <option value="">{t.scan.autoDetect}</option>
          {tests.map((x) => (
            <option key={x.id} value={x.id}>
              {x.title}
            </option>
          ))}
        </Select>
      </Field>

      <div
        role="button"
        tabIndex={0}
        aria-label={t.scan.dropzone}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          add(e.dataTransfer.files);
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-[var(--radius-card)] border-2 border-dashed px-6 py-10 text-center transition-colors",
          drag ? "border-primary bg-primary-soft" : "border-line bg-surface hover:border-primary/60",
        )}
      >
        <UploadCloud className="size-8 text-primary" aria-hidden />
        <p className="font-medium">{t.scan.dropzone}</p>
        <p className="text-sm text-muted">{t.scan.dropzoneHint}</p>
        <input ref={inputRef} type="file" accept={ACCEPT.join(",")} multiple className="sr-only" onChange={(e) => add(e.target.files)} tabIndex={-1} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => cameraRef.current?.click()} disabled={running}>
          <Camera /> {t.scan.takePhoto}
        </Button>
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => add(e.target.files)} tabIndex={-1} />
        <Button onClick={start} disabled={running || queued === 0} loading={running}>
          {running ? t.scan.processing : t.scan.start}
        </Button>
        {items.length && !running ? (
          <Button variant="ghost" onClick={() => setItems([])}>
            {t.scan.clear}
          </Button>
        ) : null}
      </div>

      {items.length ? (
        <div className="rounded-[var(--radius-control)] border border-line">
          <p className="border-b border-line bg-surface px-4 py-2 text-sm" aria-live="polite">
            {fmt(t.scan.summary, { done, total: items.length, failed, review })}
          </p>
          <ul className="divide-y divide-line">
            {items.map((i) => (
              <li key={i.key} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                {i.state === "processing" ? (
                  <Loader2 className="size-4 animate-spin text-primary" aria-hidden />
                ) : i.state === "done" ? (
                  (i.blocking ?? 0) > 0 ? (
                    <AlertTriangle className="size-4 text-warning" aria-hidden />
                  ) : (
                    <CheckCircle2 className="size-4 text-success" aria-hidden />
                  )
                ) : i.state === "failed" ? (
                  <XCircle className="size-4 text-danger" aria-hidden />
                ) : (
                  <span className="size-4 rounded-full border border-line" aria-hidden />
                )}
                <span className="min-w-0 flex-1 truncate">{i.file.name}</span>
                <span className={cn("text-right", i.state === "failed" ? "text-danger" : "text-muted")}>
                  {i.state === "queued"
                    ? t.scan.queued
                    : i.state === "processing"
                      ? t.scan.processing
                      : i.state === "failed"
                        ? i.message
                        : (i.blocking ?? 0) > 0
                          ? fmt(t.scan.warnings, { count: i.blocking ?? 0 })
                          : t.scan.done}
                </span>
                {i.resultId ? (
                  <Button asChild size="sm" variant={(i.blocking ?? 0) > 0 ? "accent" : "secondary"}>
                    <Link href={`/results/${i.resultId}`}>{t.scan.openReview}</Link>
                  </Button>
                ) : null}
                {i.state === "queued" ? (
                  <Button variant="ghost" size="icon" aria-label={t.scan.removeFile} onClick={() => setItems((p) => p.filter((x) => x.key !== i.key))}>
                    <X />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
