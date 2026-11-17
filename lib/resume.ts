// Turns an uploaded resume file into plain text. No LLM: PDF text extraction is deterministic.
import { extractText, getDocumentProxy } from "unpdf";
import { MAX_FILE_BYTES, RESUME_MAX, RESUME_MIN } from "./schemas";
import { collapse } from "./text";

export { MAX_FILE_BYTES };
const MAX_PDF_PAGES = 20; // a resume is 1-3 pages; caps CPU spent on hostile PDFs
const TEXT_TYPES = new Set(["text/plain", "text/markdown"]);

export class ResumeFileError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
  ) {
    super(message);
  }
}

function isPdf(bytes: Uint8Array): boolean {
  // Trust the magic bytes, not the extension or browser-supplied type.
  return bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
}

export async function resumeFileToText(file: File): Promise<{ text: string; truncated: boolean }> {
  if (file.size === 0) throw new ResumeFileError("That file is empty.", 400, "empty_file");
  if (file.size > MAX_FILE_BYTES) throw new ResumeFileError("Files must be 5 MB or smaller.", 413, "file_too_large");

  const bytes = new Uint8Array(await file.arrayBuffer());
  let raw: string;
  if (isPdf(bytes)) {
    const unreadable = () =>
      new ResumeFileError("We couldn't open that PDF. Try another file or paste the text.", 422, "unreadable_pdf");
    let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
    try {
      pdf = await getDocumentProxy(bytes);
    } catch {
      throw unreadable();
    }
    if (pdf.numPages > MAX_PDF_PAGES) {
      throw new ResumeFileError(`That PDF has over ${MAX_PDF_PAGES} pages. Upload your resume only, or paste the text.`, 422, "too_many_pages");
    }
    try {
      raw = (await extractText(pdf, { mergePages: true })).text;
    } catch {
      throw unreadable();
    }
  } else if (TEXT_TYPES.has(file.type) || /\.(txt|md)$/i.test(file.name)) {
    raw = new TextDecoder("utf-8").decode(bytes);
  } else {
    throw new ResumeFileError("Upload a PDF or a .txt file, or paste your resume.", 415, "unsupported_type");
  }

  const text = collapse(raw);
  if (text.length < RESUME_MIN) {
    throw new ResumeFileError(
      "We couldn't find enough text in that file. If it's a scanned PDF, paste the text instead.",
      422,
      "no_text",
    );
  }
  return { text: text.slice(0, RESUME_MAX), truncated: text.length > RESUME_MAX };
}
