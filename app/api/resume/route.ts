// POST /api/resume  multipart/form-data { file } -> { text, truncated }
import { fail, handleError, ok, readBodyCapped } from "@/lib/api";
import { requireUser, userKey } from "@/lib/auth";
import { LIMITS, limitOr429 } from "@/lib/rate-limit";
import { MAX_FILE_BYTES, ResumeFileError, resumeFileToText } from "@/lib/resume";

const FORM_OVERHEAD_BYTES = 64_000; // multipart boundaries and headers around the file

export async function POST(req: Request) {
  let userId: string;
  try {
    userId = await requireUser();
  } catch (err) {
    return handleError(err);
  }
  const limited = limitOr429(userKey(userId, "resume"), LIMITS.resume, "Too many uploads.");
  if (limited) return limited;

  // Counted while streaming, so a chunked upload without Content-Length can't bypass the cap.
  let form: FormData;
  try {
    const body = await readBodyCapped(req, MAX_FILE_BYTES + FORM_OVERHEAD_BYTES);
    if (body === "too_large") return fail(413, "file_too_large", "Files must be 5 MB or smaller.");
    form = await new Response(new Uint8Array(body), {
      headers: { "content-type": req.headers.get("content-type") ?? "" },
    }).formData();
  } catch {
    return fail(400, "invalid_form", "Send the resume as multipart/form-data with a 'file' field.");
  }
  const file = form.get("file");
  if (!(file instanceof File)) return fail(400, "validation_error", "A file is required.", { file: "Required" });

  try {
    return ok(await resumeFileToText(file));
  } catch (err) {
    if (err instanceof ResumeFileError) return fail(err.status, err.code, err.message);
    return handleError(err);
  }
}
