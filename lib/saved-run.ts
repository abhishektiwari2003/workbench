// Browser-only: remembers the last result id (URL hash + localStorage) and, in this tab only
// (sessionStorage: gone when the tab closes, so a shared device never keeps a resume), the resume
// text that produced it, so "Check for new jobs" can re-run without re-uploading.
const STORAGE_KEY = "cocareer:lastMatch";
const RESUME_KEY = "cocareer:lastResume";

export function readSavedId(): string | null {
  const fromHash = new URLSearchParams(window.location.hash.slice(1)).get("m");
  if (fromHash) return fromHash;
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function readSavedResume(id: string): string | null {
  try {
    const saved = JSON.parse(sessionStorage.getItem(RESUME_KEY) ?? "null") as { id?: string; text?: string } | null;
    return saved?.id === id && typeof saved.text === "string" ? saved.text : null;
  } catch {
    return null;
  }
}

export function remember(id: string | null, resumeText?: string) {
  try {
    if (id) localStorage.setItem(STORAGE_KEY, id);
    else localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(RESUME_KEY); // resume text kept by older builds
    if (id && resumeText) sessionStorage.setItem(RESUME_KEY, JSON.stringify({ id, text: resumeText }));
    else if (!id) sessionStorage.removeItem(RESUME_KEY);
  } catch {
    // storage blocked (private mode): the URL hash still works
  }
  history.replaceState(null, "", id ? `${window.location.pathname}#m=${id}` : window.location.pathname);
}
