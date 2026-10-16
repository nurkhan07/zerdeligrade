import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import { NextResponse, type NextRequest } from "next/server";
import { audit } from "@/lib/audit";
import { getAppContext } from "@/lib/auth/context";
import { canAccess } from "@/lib/auth/permissions";
import { logError } from "@/lib/errors";
import { getI18n } from "@/lib/i18n/server";
import { loadGrayImage, MAX_UPLOAD_BYTES, sniffImageType } from "@/lib/omr/image";
import { isSheetFormat } from "@/lib/omr/layout";
import { locateSheet, readAnswers, type LocatedSheet, type ReadResult, type SheetQuality } from "@/lib/omr/recognize";
import { getServerEnv } from "@/lib/server-env";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/utils";
import { getOptionCounts } from "@/server/sheets";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Size of the photo copy kept for teachers (recognition uses the full image). */
const STORED_PHOTO_MAX_SIDE = 1600;
const STORED_PHOTO_QUALITY = 72;

type ErrorCode =
  | "unsupported_type"
  | "too_large"
  | "decode_failed"
  | "sheet_unidentified"
  | "sheet_not_found"
  | "wrong_test"
  | "test_not_published"
  | "already_processed"
  | "storage_failed"
  | "not_configured"
  | "image_too_small"
  | "too_dark"
  | "low_contrast"
  | "markers_not_found"
  | "orientation_unknown"
  | "misaligned";

export interface ScanResponse {
  ok: boolean;
  error?: ErrorCode | "unauthorized" | "forbidden" | "bad_request" | "internal";
  message?: string;
  resultId?: string;
  scanJobId?: string;
  blockingWarnings?: number;
  sheetCode?: string | null;
}

/**
 * POST multipart/form-data: file (image), testId? (uuid), batchId? (uuid), studentId? (uuid)
 *
 * Authorization: the caller's session decides which sheets/tests/students are
 * visible (RLS). Only after that check does the server use the service role
 * to store the photo and record the recognition, which clients cannot write.
 */
export async function POST(request: NextRequest): Promise<NextResponse<ScanResponse>> {
  const { t } = await getI18n();
  const ctx = await getAppContext();
  if (!ctx) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!canAccess("scan", ctx.role) || (!ctx.isHq && ctx.memberships.length === 0)) {
    return NextResponse.json({ ok: false, error: "forbidden", message: t.common.forbidden }, { status: 403 });
  }

  const fail = (error: ErrorCode, status = 422) =>
    NextResponse.json<ScanResponse>({ ok: false, error, message: t.recognition[error] }, { status });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }
  const file = form.get("file");
  const testIdParam = form.get("testId");
  const batchIdParam = form.get("batchId");
  const studentIdParam = form.get("studentId");
  if (!(file instanceof File)) return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  if (file.size > MAX_UPLOAD_BYTES) return fail("too_large", 413);
  const requestedTest = isUuid(testIdParam) ? testIdParam : null;
  const batchId = isUuid(batchIdParam) ? batchIdParam : null;
  const requestedStudent = isUuid(studentIdParam) ? studentIdParam : null;

  const buf = Buffer.from(await file.arrayBuffer());
  const mime = sniffImageType(buf);
  if (!mime) return fail("unsupported_type", 415);

  let admin: ReturnType<typeof createAdminClient>;
  let env: ReturnType<typeof getServerEnv>;
  try {
    env = getServerEnv();
    admin = createAdminClient();
  } catch {
    return fail("not_configured", 503);
  }
  const supabase = await createClient();

  // Records a failed attempt (only when we know which test it was for).
  async function recordFailure(testId: string, centerId: string, code: ErrorCode, quality: Partial<SheetQuality> = {}) {
    const { data } = await admin
      .from("scan_jobs")
      .insert({ center_id: centerId, test_id: testId, status: "failed", error_code: code, quality, uploaded_by: ctx!.userId, batch_id: batchId })
      .select("id")
      .single();
    await audit({ actorId: ctx!.userId, centerId, action: "scan.failed", entityType: "scan_job", entityId: data?.id ?? null, details: { code } });
    return data?.id as string | undefined;
  }

  try {
    // 1. Decode + locate the sheet.
    let gray;
    try {
      gray = await loadGrayImage(buf);
    } catch {
      return fail("decode_failed");
    }
    let located = locateSheet(gray);

    // 2. Identify the sheet / test through the user's RLS-scoped client.
    const sheetCode = located.ok ? located.sheet.sheetCode : null;
    let sheet: { id: string; test_id: string; center_id: string; student_id: string | null; paper_size: string } | null = null;
    if (sheetCode) {
      const { data } = await supabase.from("answer_sheets").select("id, test_id, center_id, student_id, paper_size").eq("sheet_code", sheetCode).maybeSingle();
      if (!data) return fail("sheet_not_found", 404);
      sheet = data;
      if (requestedTest && sheet.test_id !== requestedTest) return fail("wrong_test");
    }
    const testId = sheet?.test_id ?? requestedTest;
    if (!testId) return fail(located.ok ? "sheet_unidentified" : located.error);

    const { data: test } = await supabase.from("tests").select("id, center_id, status").eq("id", testId).maybeSingle();
    if (!test || !test.center_id) return fail("sheet_not_found", 404);
    if (test.status !== "published") return fail("test_not_published");
    const centerId: string = test.center_id;

    if (!located.ok) {
      const jobId = await recordFailure(testId, centerId, located.error, located.quality);
      return NextResponse.json({ ok: false, error: located.error, message: t.recognition[located.error], scanJobId: jobId }, { status: 422 });
    }

    if (sheet) {
      const { data: existing } = await admin.from("assessment_results").select("id").eq("answer_sheet_id", sheet.id).limit(1);
      if (existing?.length) return fail("already_processed", 409);
    }

    let studentId: string | null = sheet?.student_id ?? null;
    if (!studentId && requestedStudent) {
      const { data: st } = await supabase.from("students").select("id, center_id").eq("id", requestedStudent).maybeSingle();
      if (st && st.center_id === centerId) studentId = st.id;
    }

    // 3. Read the answers with the test's exact layout. The paper format comes
    // from the sheet record (QR); without a QR every plausible format is tried.
    const counts = await getOptionCounts(supabase, testId);
    if (!counts) return fail("sheet_not_found", 404);
    if (sheet && isSheetFormat(sheet.paper_size) && located.sheet.format !== sheet.paper_size) {
      const again = locateSheet(gray, [sheet.paper_size]);
      if (again.ok) located = again;
    }
    const candidates: LocatedSheet[] = sheet ? [located.sheet] : [located.sheet, ...(located.sheet.alternatives ?? [])];
    let read: ReadResult = readAnswers(candidates[0]!, counts);
    for (const c of candidates.slice(1)) {
      if (read.ok) break;
      const r = readAnswers(c, counts);
      if (r.ok) read = r;
    }
    if (!read.ok) {
      const jobId = await recordFailure(testId, centerId, read.error, read.quality);
      return NextResponse.json({ ok: false, error: read.error, message: t.recognition[read.error], scanJobId: jobId }, { status: 422 });
    }

    // 4. Store a re-encoded copy in private storage. Recognition already ran on
    // the full-size image above; the stored copy only needs to be readable by a
    // teacher, so it is downsized (~150-250 KB instead of ~0.5-1 MB) and
    // re-encoding strips EXIF/GPS metadata.
    const stored = await sharp(buf)
      .rotate()
      .resize({ width: STORED_PHOTO_MAX_SIDE, height: STORED_PHOTO_MAX_SIDE, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: STORED_PHOTO_QUALITY, mozjpeg: true })
      .toBuffer();
    const now = new Date();
    const objectPath = `${centerId}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${randomUUID()}.jpg`;
    const { error: upErr } = await admin.storage.from(env.storageBucket).upload(objectPath, stored, { contentType: "image/jpeg", upsert: false });
    if (upErr) {
      logError("scan.upload", upErr);
      return fail("storage_failed", 502);
    }
    const originalName = (file.name || "photo").replace(/[^\p{L}\p{N}._ -]/gu, "_").slice(0, 120);
    const { data: fileRow, error: fileErr } = await admin
      .from("file_metadata")
      .insert({
        center_id: centerId,
        bucket: env.storageBucket,
        object_path: objectPath,
        original_name: originalName,
        mime_type: "image/jpeg",
        size_bytes: stored.length,
        sha256: createHash("sha256").update(stored).digest("hex"),
        uploaded_by: ctx.userId,
        delete_after: new Date(now.getTime() + env.fileRetentionDays * 86_400_000).toISOString(),
      })
      .select("id")
      .single();
    if (fileErr) {
      await admin.storage.from(env.storageBucket).remove([objectPath]);
      throw fileErr;
    }

    // 5. Scan job + result. Scores are computed inside PostgreSQL.
    const { data: job, error: jobErr } = await admin
      .from("scan_jobs")
      .insert({
        center_id: centerId,
        test_id: testId,
        answer_sheet_id: sheet?.id ?? null,
        file_id: fileRow.id,
        batch_id: batchId,
        status: "processing",
        quality: read.quality,
        uploaded_by: ctx.userId,
      })
      .select("id")
      .single();
    if (jobErr) throw jobErr;

    const { data: resultId, error: resErr } = await admin.rpc("create_scan_result", {
      p_scan_job: job.id,
      p_recognized: read.answers,
      p_sheet_warnings: read.warnings,
      p_student: studentId,
    });
    if (resErr) {
      await admin.from("scan_jobs").update({ status: "failed", error_code: "internal", error_detail: resErr.message.slice(0, 500) }).eq("id", job.id);
      if (/ZG_TEST_NOT_PUBLISHED/.test(resErr.message)) return fail("test_not_published");
      throw resErr;
    }
    await audit({ actorId: ctx.userId, centerId, action: "scan.uploaded", entityType: "scan_job", entityId: job.id, details: { result_id: resultId } });

    const blocking =
      read.answers.filter((a) => a.status === "multiple" || a.status === "uncertain").length +
      read.warnings.filter((w) => w.blocking).length +
      (studentId ? 0 : 1);
    return NextResponse.json({ ok: true, resultId: resultId as string, scanJobId: job.id, blockingWarnings: blocking, sheetCode });
  } catch (error) {
    logError("scan", error);
    return NextResponse.json({ ok: false, error: "internal", message: t.common.errorGeneric }, { status: 500 });
  }
}
