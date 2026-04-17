export function isValidCode(s: string): boolean {
  return /^r-[23456789ABCDEFGHJKMNPQRSTVWXYZ]{5,6}$/.test(s);
}

export function getAdminTokenKey(code: string) { return `retro.adminToken.${code}`; }
export function getAdminToken(code: string): string | null { return localStorage.getItem(getAdminTokenKey(code)); }
export function saveAdminToken(code: string, tok: string | null) {
  tok ? localStorage.setItem(getAdminTokenKey(code), tok) : localStorage.removeItem(getAdminTokenKey(code));
}

export function getOrCreateSessionId(): string {
  let sid = localStorage.getItem("retro.sessionId");
  if (!sid) {
    sid = "s_" + Math.random().toString(36).slice(2, 10);
    localStorage.setItem("retro.sessionId", sid);
  }
  return sid;
}

export function getSavedName(): string { return localStorage.getItem("retro.name") || ""; }
export function saveName(n: string) { localStorage.setItem("retro.name", n); }

export function fmtTime(secs: number): string {
  const m = Math.floor(secs / 60).toString().padStart(2, "0");
  const s = (secs % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

export function escHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export const DURATIONS = [
  { label: "1 min",  secs: 60   },
  { label: "2 min",  secs: 120  },
  { label: "3 min",  secs: 180  },
  { label: "5 min",  secs: 300  },
  { label: "8 min",  secs: 480  },
  { label: "10 min", secs: 600  },
  { label: "15 min", secs: 900  },
];

export const PHASE_LABELS: Record<string, string> = {
  write: "Write", reveal: "Reveal", vote: "Vote", discuss: "Discuss",
};
