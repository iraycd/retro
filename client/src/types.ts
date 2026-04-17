export interface CardView {
  id: string;
  columnId: string;
  text: string;
  mine: boolean;
  authorId?: string;
  votes: number;
  createdAt: number;
}

export interface Column {
  id: string;
  label: string;
  color: string;
}

export interface Config {
  maxVotesPerPerson: number;
  allowMultiVotePerCard: boolean;
  writingAllowedInReveal: boolean;
}

export interface TimerView {
  durationSecs: number;
  remainingSecs: number;
  running: boolean;
}

export interface Participant {
  sessionId: string;
  name: string;
  muted: boolean;
}

export interface BoardStateView {
  boardId: string;
  boardCode: string;
  title: string;
  phase: "write" | "reveal" | "vote" | "discuss";
  columns: Column[];
  config: Config;
  cards: CardView[];
  myVotes: string[];
  myVotesRemaining: number;
  isAdmin: boolean;
  isMuted: boolean;
  participants?: Participant[];
  timer: TimerView;
}

// ── Server → Client messages ──────────────────────────────────────────────────

export type ServerMsg =
  | { type: "welcome"; sessionId: string; adminToken?: string; boardId: string; boardCode: string }
  | { type: "state"; state: BoardStateView }
  | { type: "kicked" }
  | { type: "exportResult"; markdown: string }
  | { type: "error"; code: string; message?: string };

// ── Client → Server messages ──────────────────────────────────────────────────

export type ClientMsg =
  | { type: "hello"; sessionId: string; boardId: string; adminToken?: string; name?: string }
  | { type: "setName"; name: string }
  | { type: "addCard"; columnId: string; text: string }
  | { type: "editCard"; cardId: string; text: string }
  | { type: "deleteCard"; cardId: string }
  | { type: "castVote"; cardId: string }
  | { type: "retractVote"; cardId: string }
  | { type: "admin:setPhase"; phase: string }
  | { type: "admin:setConfig"; maxVotesPerPerson?: number; allowMultiVotePerCard?: boolean; writingAllowedInReveal?: boolean }
  | { type: "admin:setTitle"; title: string }
  | { type: "admin:setColumnLabel"; columnId: string; label: string }
  | { type: "admin:mute"; sessionId: string; muted: boolean }
  | { type: "admin:kick"; sessionId: string }
  | { type: "admin:clearAll" }
  | { type: "admin:export" }
  | { type: "admin:timer"; action: "start" | "pause" | "reset" | "setDuration"; durationSecs?: number }
  | { type: "admin:transfer"; newSessionId: string };
