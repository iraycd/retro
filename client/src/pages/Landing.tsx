import { useState } from "react";
import { useRouter } from "../routing";
import { isValidCode } from "../utils";

export function Landing() {
  const { navigate } = useRouter();
  const [joinCode, setJoinCode] = useState("");
  const [joinError, setJoinError] = useState("");
  const [creating, setCreating] = useState(false);

  async function handleCreate() {
    setCreating(true);
    try {
      const res = await fetch("/api/boards", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
      if (!res.ok) throw new Error("Server error");
      const { code, adminToken } = await res.json();
      navigate(`/b/${code}?adminToken=${adminToken}`);
    } catch (e) {
      setCreating(false);
      alert("Could not create board. Is the server running?");
    }
  }

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    const raw = joinCode.trim();
    const code = raw.startsWith("r-") || raw.startsWith("R-")
      ? "r-" + raw.slice(2).toUpperCase()
      : raw.toUpperCase();
    if (!isValidCode(code)) { setJoinError("Invalid code format (e.g. r-7H3K9)"); return; }
    // Verify the board exists before navigating
    const res = await fetch(`/api/boards/${code}`);
    if (!res.ok) { setJoinError("Board not found"); return; }
    navigate(`/b/${code}`);
  }

  return (
    <div className="landing">
      <div className="landing-card">
        <h1 className="landing-title">Retro Board</h1>
        <p className="landing-subtitle">Real-time retrospectives for your team — no accounts, no cloud.</p>

        <button
          className="btn primary landing-create-btn"
          onClick={handleCreate}
          disabled={creating}
        >
          {creating ? "Creating…" : "Create new board"}
        </button>

        <div className="landing-divider"><span>or join existing</span></div>

        <form onSubmit={handleJoin} className="landing-join-form">
          <input
            className="landing-code-input"
            type="text"
            placeholder="r-7H3K9"
            value={joinCode}
            onChange={e => { setJoinCode(e.target.value); setJoinError(""); }}
            aria-label="Board code"
            autoCapitalize="characters"
            spellCheck={false}
          />
          {joinError && <p className="landing-error" role="alert">{joinError}</p>}
          <button type="submit" className="btn landing-join-btn" disabled={!joinCode.trim()}>
            Join board
          </button>
        </form>
      </div>
    </div>
  );
}
