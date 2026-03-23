import { useState, useEffect, useRef, useCallback } from "react";

// ── IndexedDB helpers ────────────────────────────────────────────
const DB_NAME = "CricketScorerDB";
const DB_VER  = 4;

function openDB(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = (e: any) => {
      const db: IDBDatabase = e.target.result;
      if (!db.objectStoreNames.contains("matches"))
        db.createObjectStore("matches", { keyPath: "id" });
      if (!db.objectStoreNames.contains("deliveries")) {
        const s = db.createObjectStore("deliveries", { keyPath: "id" });
        s.createIndex("matchId", "matchId");
      }
      if (!db.objectStoreNames.contains("snapshots")) {
        const s = db.createObjectStore("snapshots", { keyPath: "id" });
        s.createIndex("matchId", "matchId");
      }
    };
    req.onsuccess = (e: any) => res(e.target.result);
    req.onerror   = (e: any) => rej(e.target.error);
  });
}
async function dbPut(store: string, data: any) {
  const db = await openDB();
  return new Promise<void>((res, rej) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(data);
    tx.oncomplete = () => res();
    tx.onerror    = (e: any) => rej(e.target.error);
  });
}
async function dbDelete(store: string, key: any) {
  const db = await openDB();
  return new Promise<void>((res, rej) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => res();
    tx.onerror    = (e: any) => rej(e.target.error);
  });
}
async function dbGetAll(store: string): Promise<any[]> {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).getAll();
    req.onsuccess = (e: any) => res(e.target.result);
    req.onerror   = (e: any) => rej(e.target.error);
  });
}

// ── Types ────────────────────────────────────────────────────────
interface Delivery {
  id: number; matchId: string; innings: 1 | 2;
  over: number; ball: number;
  runs: number; extra: string | null;
  isWicket: boolean; freeHit: boolean;
  batterIdx: number; bowlerIdx: number;
  dismissalType?: string | null;   // Bowled / Caught / Stumped / Run Out / Hit Wicket / Retired
  fielderIdx?: number | null;      // fielder who took catch / run-out
  batsmanOutIdx?: number | null;   // actual batter out (may differ for run-outs)
}
interface InningsState {
  runs: number; wickets: number;
  overs: number; balls: number;
  extras: number; wides: number; noBalls: number; byes: number; legByes: number;
  freeHitNext: boolean;
  batterA: number; batterB: number; onStrike: 0 | 1;
  overDels: OD[];
}
interface OD { display: string; bg: string; fg: string; }
interface Snapshot { id: number; matchId: string; dataUrl: string; caption: string; ts: string; }
interface Match {
  id: string; teamA: string; teamB: string; overs: number;
  playersA: string[]; playersB: string[];
  apiUrl: string; synced: boolean;
}

// ── Innings engine ───────────────────────────────────────────────
function computeInnings(dels: Delivery[], inn: 1 | 2): InningsState {
  const s: InningsState = {
    runs:0, wickets:0, overs:0, balls:0,
    extras:0, wides:0, noBalls:0, byes:0, legByes:0,
    freeHitNext:false, batterA:0, batterB:1, onStrike:0, overDels:[],
  };
  for (const d of dels.filter(d => d.innings === inn)) {
    const wide   = d.extra === "Wide";
    const noBall = d.extra === "No Ball";
    const bye    = d.extra === "Bye";
    const legBye = d.extra === "Leg Bye";
    const legal  = !wide && !noBall;
    const pen    = wide || noBall ? 1 : 0;

    s.runs += d.runs + pen;
    if (wide)   { s.wides++;  s.extras += 1 + d.runs; }
    if (noBall) { s.noBalls++;s.extras += 1 + d.runs; }
    if (bye)    { s.byes   += d.runs; s.extras += d.runs; }
    if (legBye) { s.legByes += d.runs; s.extras += d.runs; }

    if (d.isWicket) {
      s.wickets++;
      const next = Math.max(s.batterA, s.batterB) + 1;
      if (d.batsmanOutIdx != null) {
        if (d.batsmanOutIdx === s.batterA) s.batterA = next;
        else if (d.batsmanOutIdx === s.batterB) s.batterB = next;
        else { if (s.onStrike === 0) s.batterA = next; else s.batterB = next; }
      } else {
        if (s.onStrike === 0) s.batterA = next; else s.batterB = next;
      }
    }

    const label = d.isWicket ? "W"
      : wide   ? `Wd${d.runs > 0 ? "+"+d.runs : ""}`
      : noBall ? `Nb${d.runs > 0 ? "+"+d.runs : ""}`
      : bye    ? (d.runs ? `B${d.runs}` : "B")
      : legBye ? (d.runs ? `Lb${d.runs}`: "Lb")
      : String(d.runs);
    const bg = d.isWicket ? "var(--red)"
      : (wide || noBall)  ? "var(--gold)"
      : d.runs === 6      ? "var(--green)"
      : d.runs === 4      ? "var(--blue)"
      : "var(--bg-input)";
    const fg = (d.isWicket || wide || noBall || d.runs >= 4) ? "#fff" : "var(--txt)";
    s.overDels.push({ display: label, bg, fg });

    if (legal) {
      s.balls++;
      if (s.balls >= 6) {
        s.overs++; s.balls = 0; s.overDels = [];
        s.onStrike = s.onStrike === 0 ? 1 : 0;
      }
      if (!d.isWicket && d.runs % 2 === 1)
        s.onStrike = s.onStrike === 0 ? 1 : 0;
    }
    s.freeHitNext = noBall;
  }
  return s;
}

// ── Helpers ──────────────────────────────────────────────────────
const mkPlayers = (n: number) => Array.from({ length: n }, (_, i) => `Player ${i+1}`);
const initMatch = (): Match => ({
  id: Date.now().toString(), teamA: "Team A", teamB: "Team B", overs: 20,
  playersA: mkPlayers(11), playersB: mkPlayers(11), apiUrl: "", synced: false,
});

// ── SVG Icons ────────────────────────────────────────────────────
const Icon = {
  Setup:   () => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>,
  Score:   () => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/><path d="M8 12c0-2.21 1.79-4 4-4s4 1.79 4 4-1.79 4-4 4"/><line x1="12" y1="8" x2="12" y2="8.01"/></svg>,
  History: () => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>,
  Camera:  () => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>,
  Edit:    () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>,
  Undo:    () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 102.13-9.36L1 10"/></svg>,
  Sync:    () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>,
  Check:   () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>,
  Plus:    () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>,
};

// ── AnimOverlay ──────────────────────────────────────────────────
function AnimOverlay({ type, onDone }: { type: string | null; onDone: () => void }) {
  useEffect(() => {
    if (!type) return;
    const t = setTimeout(onDone, 2600);
    return () => clearTimeout(t);
  }, [type, onDone]);
  if (!type) return null;

  const cfg: Record<string, { label: string; sub: string; bg: string; glow: string }> = {
    four: { label: "FOUR!",   sub: "Boundary",  bg: "linear-gradient(135deg,#0a5494,#1a7fd4)", glow: "#1a7fd4" },
    six:  { label: "SIX!",    sub: "Maximum!",  bg: "linear-gradient(135deg,#1a6b2a,#2ea84a)", glow: "#2ea84a" },
    out:  { label: "OUT!",    sub: "Wicket",    bg: "linear-gradient(135deg,#7f1d1d,#c0392b)", glow: "#c0392b" },
  };
  const c = cfg[type] ?? { label: type.toUpperCase()+"!", sub:"", bg:"#111", glow:"#555" };

  return (
    <div
      className="anim-overlay"
      onClick={onDone}
      style={{
        position:"fixed", inset:0, zIndex:9999, background:c.bg,
        display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
        cursor:"pointer",
        boxShadow:`inset 0 0 120px ${c.glow}55`,
      }}
    >
      <div className="anim-text" style={{ fontSize: 96, lineHeight:1, marginBottom:8 }}>
        {type==="four" ? "🏏" : type==="six" ? "🚀" : "🔴"}
      </div>
      <div className="anim-text" style={{
        fontSize:72, fontWeight:900, color:"#fff", letterSpacing:"0.03em",
        textShadow:`0 0 40px ${c.glow}, 0 4px 24px rgba(0,0,0,0.4)`,
      }}>{c.label}</div>
      <div style={{ color:"rgba(255,255,255,0.65)", fontSize:18, marginTop:12, fontWeight:500 }}>{c.sub}</div>
      <div style={{ color:"rgba(255,255,255,0.35)", fontSize:12, marginTop:32 }}>tap to dismiss</div>
    </div>
  );
}

// ── Dismissal types ──────────────────────────────────────────────
const DISMISSAL_TYPES = [
  { id: "Bowled",     icon: "🎯", needFielder: false },
  { id: "Caught",     icon: "🙌", needFielder: true  },
  { id: "Stumped",    icon: "🧤", needFielder: true  },
  { id: "Run Out",    icon: "🏃", needFielder: true  },
  { id: "Hit Wicket", icon: "💥", needFielder: false },
  { id: "Retired",    icon: "🚶", needFielder: false },
];

// ── WicketModal ──────────────────────────────────────────────────
function WicketModal({ striker, nonStr, strikerIdx, nonStrIdx, bowling, freeHit, onConfirm, onClose }: {
  striker: string; nonStr: string; strikerIdx: number; nonStrIdx: number;
  bowling: string[]; freeHit: boolean;
  onConfirm: (runs: number, dismissalType: string, fielderIdx: number | null, outBatterIdx: number) => void;
  onClose: () => void;
}) {
  const [dismissalType, setDismissalType] = useState("Bowled");
  const [fielderIdx,    setFielderIdx]    = useState<number | null>(null);
  const [outBatterIdx,  setOutBatterIdx]  = useState<number>(strikerIdx);
  const [runsScored,    setRunsScored]    = useState(0);

  const dt = DISMISSAL_TYPES.find(d => d.id === dismissalType)!;

  return (
    <div style={{
      position:"fixed", inset:0, zIndex:1000, background:"rgba(0,0,0,0.72)",
      display:"flex", alignItems:"flex-end", justifyContent:"center",
    }} onClick={onClose}>
      <div className="slide-up" onClick={e => e.stopPropagation()} style={{
        background:"var(--bg-card)", borderRadius:"var(--radius-lg) var(--radius-lg) 0 0",
        padding:"20px 20px calc(20px + env(safe-area-inset-bottom,0px))",
        width:"100%", maxWidth:480, borderTop:"2px solid var(--red)",
        maxHeight:"88vh", overflowY:"auto",
      }}>
        <div style={{ width:36, height:4, background:"var(--bdr)", borderRadius:99, margin:"0 auto 14px" }} />
        <div style={{ fontSize:17, fontWeight:800, color:"var(--red)", marginBottom:14, display:"flex", alignItems:"center", gap:8 }}>
          🔴 Wicket details
        </div>

        {freeHit && (
          <div style={{ background:"rgba(234,179,8,0.15)", border:"1px solid var(--gold)", borderRadius:"var(--radius-sm)", padding:"8px 12px", fontSize:13, color:"var(--gold)", fontWeight:600, marginBottom:12 }}>
            ⭐ Free Hit — only Run Out is valid
          </div>
        )}

        {/* Who is out */}
        <div style={{ marginBottom:14 }}>
          <div style={{ fontSize:11, color:"var(--txt-3)", fontWeight:700, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:8 }}>Who is out?</div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
            {[
              { label:"⚡ On strike", name: striker, idx: strikerIdx },
              { label:"Non-striker",  name: nonStr,  idx: nonStrIdx  },
            ].map(b => (
              <button key={b.idx} onClick={() => setOutBatterIdx(b.idx)} style={{
                padding:"11px 10px", borderRadius:"var(--radius-sm)", cursor:"pointer", textAlign:"left",
                border: outBatterIdx===b.idx ? "2px solid var(--red)" : "1.5px solid var(--bdr)",
                background: outBatterIdx===b.idx ? "var(--red-lt)" : "var(--bg-input)",
                color: outBatterIdx===b.idx ? "var(--red)" : "var(--txt-2)",
                fontSize:13, fontWeight:700,
              }}>
                <div style={{ fontSize:10, opacity:0.65, marginBottom:3 }}>{b.label}</div>
                <div style={{ overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{b.name}</div>
              </button>
            ))}
          </div>
        </div>

        {/* How out */}
        <div style={{ marginBottom:14 }}>
          <div style={{ fontSize:11, color:"var(--txt-3)", fontWeight:700, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:8 }}>How out?</div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:6 }}>
            {DISMISSAL_TYPES.map(d => (
              <button key={d.id} onClick={() => { if (!(freeHit && d.id !== "Run Out")) setDismissalType(d.id); }} style={{
                padding:"10px 4px", borderRadius:"var(--radius-sm)", cursor:"pointer",
                border: dismissalType===d.id ? "2px solid var(--red)" : "1.5px solid var(--bdr)",
                background: dismissalType===d.id ? "var(--red-lt)" : "var(--bg-input)",
                color: dismissalType===d.id ? "var(--red)" : "var(--txt-2)",
                fontSize:11, fontWeight:700, textAlign:"center",
                display:"flex", flexDirection:"column", alignItems:"center", gap:4,
                opacity: freeHit && d.id !== "Run Out" ? 0.3 : 1,
                minHeight:52,
              }}>
                <span style={{ fontSize:20 }}>{d.icon}</span>
                <span>{d.id}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Fielder */}
        {dt.needFielder && (
          <div style={{ marginBottom:14 }}>
            <div style={{ fontSize:11, color:"var(--txt-3)", fontWeight:700, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:8 }}>
              {dismissalType==="Caught" ? "Caught by" : dismissalType==="Stumped" ? "Stumped by (WK)" : "Run out by"}
            </div>
            <select value={fielderIdx ?? ""} onChange={e => setFielderIdx(e.target.value==="" ? null : +e.target.value)}>
              <option value="">— Select fielder —</option>
              {bowling.map((p, i) => <option key={i} value={i}>{p}</option>)}
            </select>
          </div>
        )}

        {/* Runs (run-out only) */}
        {dismissalType === "Run Out" && (
          <div style={{ marginBottom:14 }}>
            <div style={{ fontSize:11, color:"var(--txt-3)", fontWeight:700, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:8 }}>Runs completed before run-out</div>
            <div style={{ display:"flex", gap:8 }}>
              {[0,1,2,3].map(r => (
                <button key={r} onClick={() => setRunsScored(r)} style={{
                  flex:1, aspectRatio:"1", borderRadius:"50%", fontSize:16, fontWeight:700, minHeight:44,
                  border: runsScored===r ? "2px solid var(--green)" : "1.5px solid var(--bdr)",
                  background: runsScored===r ? "var(--green)" : "var(--bg-input)",
                  color: runsScored===r ? "#fff" : "var(--txt)", cursor:"pointer",
                }}>{r}</button>
              ))}
            </div>
          </div>
        )}

        {/* Actions */}
        <div style={{ display:"grid", gridTemplateColumns:"2fr 1fr", gap:8 }}>
          <button onClick={() => onConfirm(runsScored, dismissalType, fielderIdx, outBatterIdx)} style={{
            padding:"13px 10px", fontSize:15, fontWeight:700,
            borderRadius:"var(--radius-sm)", cursor:"pointer",
            background:"var(--red)", color:"#fff", border:"none",
            display:"flex", alignItems:"center", justifyContent:"center", gap:6,
            minHeight:44,
          }}>
            ✓ Confirm Wicket
          </button>
          <button onClick={onClose} style={{
            padding:"13px 10px", fontSize:14, fontWeight:600,
            borderRadius:"var(--radius-sm)", cursor:"pointer",
            background:"var(--bg-input)", color:"var(--txt-2)", border:"1.5px solid var(--bdr)",
            display:"flex", alignItems:"center", justifyContent:"center",
            minHeight:44,
          }}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ── EditBallModal ────────────────────────────────────────────────
function EditBallModal({ delivery, onSave, onUndo, onClose }: {
  delivery: Delivery | null; onSave: (p: Partial<Delivery>) => void;
  onUndo: () => void; onClose: () => void;
}) {
  const [runs,     setRuns]     = useState(0);
  const [extra,    setExtra]    = useState<string|null>(null);
  const [isWicket, setIsWicket] = useState(false);

  useEffect(() => {
    if (delivery) { setRuns(delivery.runs); setExtra(delivery.extra); setIsWicket(delivery.isWicket); }
  }, [delivery]);

  if (!delivery) return null;

  return (
    <div style={{
      position:"fixed", inset:0, zIndex:1000, background:"rgba(0,0,0,0.7)",
      display:"flex", alignItems:"flex-end", justifyContent:"center",
      padding:"0 0 var(--safe-b)",
    }} onClick={onClose}>
      <div className="slide-up" onClick={e => e.stopPropagation()} style={{
        background:"var(--bg-card)", borderRadius:"var(--radius-lg) var(--radius-lg) 0 0",
        padding:"20px 20px calc(20px + var(--safe-b))", width:"100%", maxWidth:480,
        borderTop:"1px solid var(--bdr)",
      }}>
        {/* Handle */}
        <div style={{ width:36, height:4, background:"var(--bdr)", borderRadius:99, margin:"0 auto 20px" }} />
        <div style={{ fontSize:17, fontWeight:700, marginBottom:20 }}>Edit last ball</div>

        {/* Runs */}
        <div style={{ marginBottom:18 }}>
          <div style={{ fontSize:12, color:"var(--txt-2)", fontWeight:600, marginBottom:8, textTransform:"uppercase", letterSpacing:"0.06em" }}>Runs</div>
          <div style={{ display:"flex", gap:8 }}>
            {[0,1,2,3,4,5,6].map(r => (
              <button key={r} onClick={() => setRuns(r)} style={{
                flex:1, aspectRatio:"1", borderRadius:"50%", fontSize:18, fontWeight:700,
                border: runs===r ? "2px solid var(--green)" : "1.5px solid var(--bdr)",
                background: runs===r ? "var(--green)" : "var(--bg-input)",
                color: runs===r ? "#fff" : "var(--txt)", cursor:"pointer",
                minHeight:44,
              }}>{r}</button>
            ))}
          </div>
        </div>

        {/* Extra */}
        <div style={{ marginBottom:18 }}>
          <div style={{ fontSize:12, color:"var(--txt-2)", fontWeight:600, marginBottom:8, textTransform:"uppercase", letterSpacing:"0.06em" }}>Extra</div>
          <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
            {[null,"Wide","No Ball","Bye","Leg Bye","Free Hit"].map(ex => (
              <button key={String(ex)} onClick={() => setExtra(ex)} style={{
                padding:"8px 14px", fontSize:13, fontWeight:600,
                borderRadius:99, cursor:"pointer",
                border: extra===ex ? "2px solid var(--green)" : "1.5px solid var(--bdr)",
                background: extra===ex ? "var(--green)" : "var(--bg-input)",
                color: extra===ex ? "#fff" : "var(--txt)",
              }}>{ex ?? "None"}</button>
            ))}
          </div>
        </div>

        {/* Wicket */}
        <button onClick={() => setIsWicket(!isWicket)} style={{
          width:"100%", padding:14, borderRadius:"var(--radius)",
          border: isWicket ? "2px solid var(--red)" : "1.5px solid var(--bdr)",
          background: isWicket ? "var(--red-lt)" : "var(--bg-input)",
          color: isWicket ? "var(--red)" : "var(--txt-2)",
          fontSize:15, fontWeight:700, cursor:"pointer", marginBottom:16,
          display:"flex", alignItems:"center", justifyContent:"center", gap:8,
        }}>
          <span style={{ fontSize:20 }}>🔴</span> {isWicket ? "Wicket (ON)" : "Wicket (OFF)"}
        </button>

        {/* Actions */}
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8 }}>
          <button onClick={() => onSave({ runs, extra, isWicket })} style={btn("green")}>Save</button>
          <button onClick={onUndo} style={btn("red")}>Undo ball</button>
          <button onClick={onClose} style={btn("ghost")}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ── Small button factory ─────────────────────────────────────────
function btn(variant: "green"|"red"|"blue"|"ghost"): React.CSSProperties {
  const map = {
    green: { bg:"var(--green)",    color:"#fff",         border:"none" },
    red:   { bg:"var(--red)",      color:"#fff",         border:"none" },
    blue:  { bg:"var(--blue)",     color:"#fff",         border:"none" },
    ghost: { bg:"var(--bg-input)", color:"var(--txt-2)", border:"1.5px solid var(--bdr)" },
  };
  const v = map[variant];
  return {
    padding:"12px 10px", fontSize:14, fontWeight:600,
    borderRadius:"var(--radius-sm)", cursor:"pointer",
    background:v.bg, color:v.color, border:v.border,
    display:"flex", alignItems:"center", justifyContent:"center", gap:6,
    minHeight:44,
  };
}

// ── Section label ────────────────────────────────────────────────
function SLabel({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize:11, fontWeight:700, color:"var(--txt-3)", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:8 }}>{children}</div>;
}

// ── Card ─────────────────────────────────────────────────────────
function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background:"var(--bg-card)", borderRadius:"var(--radius)", padding:"16px", border:"1px solid var(--bdr-2)", ...style }}>
      {children}
    </div>
  );
}

// ── BottomNav ────────────────────────────────────────────────────
const NAV_ITEMS = [
  { id:"Setup",   label:"Setup",   IconC: Icon.Setup   },
  { id:"Score",   label:"Score",   IconC: Icon.Score   },
  { id:"History", label:"History", IconC: Icon.History },
  { id:"Photos",  label:"Photos",  IconC: Icon.Camera  },
] as const;
type TabId = typeof NAV_ITEMS[number]["id"];

function BottomNav({ active, onChange }: { active: TabId; onChange: (t: TabId) => void }) {
  return (
    <div style={{
      position:"fixed", bottom:0, left:0, right:0,
      height:`calc(var(--nav-h) + var(--safe-b))`,
      background:"var(--bg-card)", borderTop:"1px solid var(--bdr)",
      display:"flex", alignItems:"stretch", zIndex:100,
      backdropFilter:"blur(12px)", WebkitBackdropFilter:"blur(12px)",
    }}>
      {NAV_ITEMS.map(({ id, label, IconC }) => {
        const isActive = active === id;
        return (
          <button key={id} onClick={() => onChange(id)} style={{
            flex:1, display:"flex", flexDirection:"column", alignItems:"center",
            justifyContent:"center", gap:3, border:"none", cursor:"pointer",
            background:"transparent", paddingBottom:"var(--safe-b)",
            color: isActive ? "var(--green)" : "var(--txt-3)",
            transition:"color .15s",
          }}>
            <IconC />
            <span style={{ fontSize:10, fontWeight: isActive ? 700 : 500 }}>{label}</span>
          </button>
        );
      })}
    </div>
  );
}

// ── Over-ball dot strip ──────────────────────────────────────────
function OverDots({ dots }: { dots: OD[] }) {
  if (!dots.length) return null;
  return (
    <div style={{ display:"flex", gap:5, flexWrap:"wrap", alignItems:"center" }}>
      <span style={{ fontSize:11, color:"var(--txt-3)", minWidth:60 }}>This over</span>
      {dots.map((d, i) => (
        <span key={i} style={{
          minWidth:30, height:30, borderRadius:"50%", fontSize:11, fontWeight:700,
          background:d.bg, color:d.fg, border:"1.5px solid var(--bdr)",
          display:"flex", alignItems:"center", justifyContent:"center", padding:"0 3px",
        }}>{d.display}</span>
      ))}
    </div>
  );
}

// ── Main App ─────────────────────────────────────────────────────
export default function App() {
  const [tab,           setTab]          = useState<TabId>("Setup");
  const [match,         setMatch]        = useState<Match>(initMatch);
  const [deliveries,    setDeliveries]   = useState<Delivery[]>([]);
  const [curInn,        setCurInn]       = useState<1|2>(1);
  const [selExtra,      setSelExtra]     = useState<string|null>(null);
  const [editTeam,      setEditTeam]     = useState<"A"|"B">("A");
  const [bowlerIdx,     setBowlerIdx]    = useState(0);
  const [anim,          setAnim]         = useState<string|null>(null);
  const [editOpen,      setEditOpen]     = useState(false);
  const [snapshots,     setSnapshots]    = useState<Snapshot[]>([]);
  const [toast,         setToast]        = useState("");
  const [syncSt,        setSyncSt]       = useState<""|"syncing"|"ok"|"err">("");
  const [histInn,       setHistInn]      = useState<1|2>(1);
  const cameraRef = useRef<HTMLInputElement>(null);

  const inn      = computeInnings(deliveries, curInn);
  const maxBalls = match.overs * 6;
  const played   = inn.overs * 6 + inn.balls;
  const [forceEnded, setForceEnded] = useState(false);
  const [confirmEnd,      setConfirmEnd]      = useState(false);
  const [wicketModalOpen, setWicketModalOpen] = useState(false);
  const isComplete = played >= maxBalls || inn.wickets >= 10 || forceEnded;
  const lastDel  = deliveries.filter(d => d.innings === curInn).at(-1) ?? null;
  const batting  = curInn === 1 ? match.playersA : match.playersB;
  const bowling  = curInn === 1 ? match.playersB : match.playersA;
  const strikerIdx  = inn.onStrike === 0 ? inn.batterA : inn.batterB;
  const nonStrIdx   = inn.onStrike === 0 ? inn.batterB : inn.batterA;
  const striker     = batting[strikerIdx]  ?? "—";
  const nonStr      = batting[nonStrIdx]   ?? "—";
  const batTeam     = curInn === 1 ? match.teamA : match.teamB;
  const runRate     = played > 0 ? (inn.runs / (played / 6)).toFixed(2) : "—";

  function getBatterStats(idx: number) {
    const dels = deliveries.filter(d => d.innings === curInn && d.batterIdx === idx);
    const runs  = dels.filter(d => d.extra !== "Bye" && d.extra !== "Leg Bye" && d.extra !== "Wide")
                      .reduce((s, d) => s + d.runs, 0);
    const balls = dels.filter(d => d.extra !== "Wide").length;
    const sr    = balls > 0 ? ((runs / balls) * 100).toFixed(0) : "—";
    return { runs, balls, sr };
  }

  const strikerStats  = getBatterStats(strikerIdx);
  const nonStrStats   = getBatterStats(nonStrIdx);

  const showToast = useCallback((msg: string) => {
    setToast(msg); setTimeout(() => setToast(""), 2600);
  }, []);

  async function addDelivery(
    runs: number,
    isWicket = false,
    wicketInfo?: { dismissalType: string; fielderIdx: number | null; batsmanOutIdx: number | null } | null,
  ) {
    if (isComplete) return;
    const fh = inn.freeHitNext;
    if (isWicket && fh && wicketInfo?.dismissalType !== "Run Out") { showToast("Can't get out on a Free Hit!"); return; }
    const d: Delivery = {
      id: Date.now(), matchId: match.id, innings: curInn,
      over: inn.overs, ball: inn.balls,
      runs, extra: selExtra, isWicket, freeHit: fh,
      batterIdx: inn.onStrike === 0 ? inn.batterA : inn.batterB,
      bowlerIdx,
      dismissalType: isWicket ? (wicketInfo?.dismissalType ?? null) : null,
      fielderIdx:    isWicket ? (wicketInfo?.fielderIdx  ?? null) : null,
      batsmanOutIdx: isWicket ? (wicketInfo?.batsmanOutIdx ?? null) : null,
    };
    setDeliveries(prev => [...prev, d]);
    setSelExtra(null);
    if (isWicket)        setAnim("out");
    else if (runs === 6) setAnim("six");
    else if (runs === 4 && !selExtra) setAnim("four");
    try { await dbPut("deliveries", d); } catch (e: any) { showToast("Save error"); }
  }

  function handleEditSave(patch: Partial<Delivery>) {
    if (!lastDel) return;
    const updated = { ...lastDel, ...patch };
    setDeliveries(prev => [...prev.slice(0, -1), updated]);
    dbPut("deliveries", updated);
    setEditOpen(false);
    showToast("Ball updated");
  }

  function undoLast() {
    if (!lastDel) return;
    dbDelete("deliveries", lastDel.id);
    setDeliveries(prev => prev.slice(0, -1));
    setEditOpen(false);
    showToast("Last ball undone");
  }

  async function handleSync() {
    setSyncSt("syncing");
    try {
      const allDels = await dbGetAll("deliveries");
      const payload = {
        match, deliveries: allDels,
        innings1: computeInnings(allDels, 1),
        innings2: computeInnings(allDels, 2),
        syncedAt: new Date().toISOString(),
      };
      if (match.apiUrl) {
        const r = await fetch(match.apiUrl, {
          method:"POST", headers:{"Content-Type":"application/json"},
          body: JSON.stringify(payload),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
      } else {
        await new Promise(r => setTimeout(r, 900));
        console.log("[CricketScorer] Sync payload:", payload);
      }
      setSyncSt("ok");
      setMatch(m => ({ ...m, synced: true }));
      showToast(match.apiUrl ? "Synced to API ✓" : "Simulated sync ✓ (add API URL in Setup)");
      setTimeout(() => setSyncSt(""), 3000);
    } catch (e: any) {
      setSyncSt("err");
      showToast("Sync failed: " + e.message);
      setTimeout(() => setSyncSt(""), 3000);
    }
  }

  async function handleCapture(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async ev => {
      const snap: Snapshot = {
        id: Date.now(), matchId: match.id,
        dataUrl: ev.target?.result as string,
        caption: `${inn.overs}.${inn.balls} ov — ${inn.runs}/${inn.wickets}`,
        ts: new Date().toLocaleTimeString(),
      };
      setSnapshots(prev => [...prev, snap]);
      try { await dbPut("snapshots", snap); showToast("Photo saved!"); }
      catch { showToast("Photo save failed"); }
    };
    reader.readAsDataURL(file);
    if (cameraRef.current) cameraRef.current.value = "";
  }

  // ── Layout shell ───────────────────────────────────────────────
  return (
    <div style={{
      display:"flex", flexDirection:"column",
      height:"100dvh", maxWidth:480,
      margin:"0 auto", position:"relative",
      background:"var(--bg)",
    }}>
      <AnimOverlay type={anim} onDone={() => setAnim(null)} />
      <EditBallModal delivery={editOpen ? lastDel : null} onSave={handleEditSave} onUndo={undoLast} onClose={() => setEditOpen(false)} />
      {wicketModalOpen && (
        <WicketModal
          striker={striker} nonStr={nonStr}
          strikerIdx={strikerIdx} nonStrIdx={nonStrIdx}
          bowling={bowling} freeHit={inn.freeHitNext}
          onConfirm={(runs, dismissalType, fielderIdx, outBatterIdx) => {
            setWicketModalOpen(false);
            addDelivery(runs, true, { dismissalType, fielderIdx, batsmanOutIdx: outBatterIdx });
          }}
          onClose={() => setWicketModalOpen(false)}
        />
      )}

      {/* Toast */}
      {toast && (
        <div className="slide-up" style={{
          position:"fixed", top:"calc(12px + var(--safe-t))", left:"50%",
          transform:"translateX(-50%)", zIndex:500,
          background:"rgba(20,20,20,0.92)", color:"#fff",
          padding:"10px 20px", borderRadius:99, fontSize:13, fontWeight:600,
          whiteSpace:"nowrap", backdropFilter:"blur(8px)",
          boxShadow:"0 4px 20px rgba(0,0,0,0.3)",
        }}>{toast}</div>
      )}

      {/* Header */}
      <div style={{
        height:"calc(var(--hdr-h) + var(--safe-t))",
        paddingTop:"var(--safe-t)",
        background:"var(--bg-card)", borderBottom:"1px solid var(--bdr)",
        display:"flex", alignItems:"center", justifyContent:"space-between",
        padding:"var(--safe-t) 16px 0", flexShrink:0,
        position:"sticky", top:0, zIndex:50,
      }}>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <span style={{ fontSize:22 }}>🏏</span>
          <span style={{ fontSize:16, fontWeight:700, color:"var(--txt)" }}>
            {tab === "Score" ? `${batTeam} · Inn ${curInn}` : "Howzat 🏏"}
          </span>
        </div>
        {tab === "Score" && (
          <button onClick={handleSync} style={{
            display:"flex", alignItems:"center", gap:6,
            padding:"7px 14px", borderRadius:99,
            border:`1.5px solid ${syncSt==="ok" ? "var(--green)" : syncSt==="err" ? "var(--red)" : "var(--bdr)"}`,
            background: syncSt==="ok" ? "var(--green-lt)" : syncSt==="err" ? "var(--red-lt)" : "var(--bg-input)",
            color: syncSt==="ok" ? "var(--green)" : syncSt==="err" ? "var(--red)" : "var(--txt-2)",
            fontSize:13, fontWeight:600, cursor:"pointer",
            opacity: syncSt==="syncing" ? 0.6 : 1,
          }}>
            {syncSt==="ok" ? <Icon.Check /> : <Icon.Sync />}
            {syncSt==="syncing" ? "Syncing…" : syncSt==="ok" ? "Synced" : syncSt==="err" ? "Retry" : "Sync"}
          </button>
        )}
      </div>

      {/* Scrollable content */}
      <div style={{
        flex:1, overflowY:"auto", overflowX:"hidden",
        paddingBottom:`calc(var(--nav-h) + var(--safe-b) + 12px)`,
      }}>
        {/* ══ SETUP ══════════════════════════════════════════════ */}
        {tab === "Setup" && (
          <div style={{ padding:"16px 16px 0" }}>
            {/* Match settings */}
            <Card style={{ marginBottom:12 }}>
              <SLabel>Match settings</SLabel>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:12 }}>
                <div>
                  <div style={{ fontSize:12, color:"var(--txt-2)", marginBottom:4 }}>Team A</div>
                  <input value={match.teamA} onChange={e => setMatch(m=>({...m,teamA:e.target.value}))} />
                </div>
                <div>
                  <div style={{ fontSize:12, color:"var(--txt-2)", marginBottom:4 }}>Team B</div>
                  <input value={match.teamB} onChange={e => setMatch(m=>({...m,teamB:e.target.value}))} />
                </div>
              </div>
              <div style={{ marginBottom:4 }}>
                <div style={{ fontSize:12, color:"var(--txt-2)", marginBottom:4 }}>
                  Overs: <strong>{match.overs}</strong>
                  <span style={{ color:"var(--txt-3)", marginLeft:8 }}>
                    {match.overs <= 10 ? "T10" : match.overs === 20 ? "T20" : match.overs === 50 ? "ODI" : "Custom"}
                  </span>
                </div>
                <input type="range" min={1} max={50} value={match.overs}
                  onChange={e => setMatch(m=>({...m,overs:+e.target.value}))}
                  style={{ padding:0, background:"transparent", border:"none", height:20, accentColor:"var(--green)" }}
                />
                <div style={{ display:"flex", justifyContent:"space-between", fontSize:11, color:"var(--txt-3)" }}>
                  <span>1</span><span>T10</span><span>T20</span><span>ODI (50)</span>
                </div>
              </div>
            </Card>

            {/* API URL */}
            <Card style={{ marginBottom:12 }}>
              <SLabel>Sync API</SLabel>
              <input
                value={match.apiUrl}
                placeholder="https://your-api.com/cricket/sync  (optional)"
                onChange={e => setMatch(m=>({...m,apiUrl:e.target.value}))}
              />
              <div style={{ fontSize:11, color:"var(--txt-3)", marginTop:6 }}>Leave blank to simulate sync (logs to console)</div>
            </Card>

            {/* Players */}
            <Card style={{ marginBottom:16 }}>
              <SLabel>Players</SLabel>
              <div style={{ display:"flex", gap:6, marginBottom:12 }}>
                {(["A","B"] as const).map(t => (
                  <button key={t} onClick={() => setEditTeam(t)} style={{
                    flex:1, padding:"10px", borderRadius:"var(--radius-sm)", fontSize:14, fontWeight:600, cursor:"pointer",
                    border: editTeam===t ? "2px solid var(--green)" : "1.5px solid var(--bdr)",
                    background: editTeam===t ? "var(--green-lt)" : "var(--bg-input)",
                    color: editTeam===t ? "var(--green)" : "var(--txt-2)",
                  }}>{t==="A" ? match.teamA : match.teamB}</button>
                ))}
              </div>
              <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                {(editTeam==="A" ? match.playersA : match.playersB).map((p, i) => (
                  <div key={i} style={{ display:"flex", alignItems:"center", gap:8 }}>
                    <span style={{
                      width:28, height:28, borderRadius:"50%",
                      background:"var(--green)", color:"#fff",
                      display:"flex", alignItems:"center", justifyContent:"center",
                      fontSize:12, fontWeight:700, flexShrink:0,
                    }}>{i+1}</span>
                    <input
                      value={p}
                      onChange={e => {
                        const key = editTeam==="A" ? "playersA" : "playersB";
                        setMatch(m => { const a=[...m[key]]; a[i]=e.target.value; return {...m,[key]:a}; });
                      }}
                      style={{ fontSize:14 }}
                    />
                  </div>
                ))}
              </div>
            </Card>

            <button
              onClick={() => { setTab("Score"); dbPut("matches", match); }}
              style={{
                width:"100%", padding:16, borderRadius:"var(--radius)",
                background:"var(--green)", color:"#fff", border:"none",
                fontSize:17, fontWeight:700, cursor:"pointer",
                display:"flex", alignItems:"center", justifyContent:"center", gap:8,
                boxShadow:"0 4px 16px rgba(26,107,42,0.4)",
              }}>
              <Icon.Plus /> Start Match
            </button>

            {/* About card */}
            <div style={{
              marginTop:20, marginBottom:4,
              background:"var(--bg-card)", borderRadius:"var(--radius)",
              border:"1px solid var(--bdr-2)", overflow:"hidden",
            }}>
              {/* Banner */}
              <div style={{
                background:"linear-gradient(135deg,#0f4019,#1a6b2a)",
                padding:"20px 20px 16px",
                display:"flex", alignItems:"center", gap:14,
              }}>
                <div style={{
                  width:52, height:52, borderRadius:"50%",
                  background:"rgba(255,255,255,0.15)",
                  display:"flex", alignItems:"center", justifyContent:"center",
                  fontSize:28, flexShrink:0,
                }}>🏏</div>
                <div>
                  <div style={{ color:"#fff", fontSize:20, fontWeight:800, letterSpacing:"-0.3px" }}>Howzat</div>
                  <div style={{ color:"rgba(255,255,255,0.65)", fontSize:12, marginTop:2 }}>Cricket Scoring App · v1.0</div>
                </div>
              </div>

              {/* Info rows */}
              <div style={{ padding:"14px 20px 18px", display:"flex", flexDirection:"column", gap:12 }}>
                {[
                  { icon:"👤", label:"Developer", value:"Aman Ullah Shaikh" },
                  { icon:"✉️", label:"Email",     value:"shaikhg11@hotmail.com" },
                  { icon:"📱", label:"Platform",  value:"Android · Web (PWA)" },
                  { icon:"🗄️", label:"Storage",   value:"IndexedDB (offline-first)" },
                  { icon:"☁️", label:"Sync",      value:"REST API (configurable)" },
                ].map(row => (
                  <div key={row.label} style={{ display:"flex", alignItems:"center", gap:12 }}>
                    <span style={{ fontSize:18, width:24, textAlign:"center", flexShrink:0 }}>{row.icon}</span>
                    <div style={{ flex:1 }}>
                      <div style={{ fontSize:10, color:"var(--txt-3)", fontWeight:600, textTransform:"uppercase", letterSpacing:"0.06em" }}>{row.label}</div>
                      <div style={{ fontSize:14, color:"var(--txt)", fontWeight:500, marginTop:1 }}>{row.value}</div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Footer */}
              <div style={{
                borderTop:"1px solid var(--bdr-2)", padding:"10px 20px",
                fontSize:11, color:"var(--txt-3)", textAlign:"center",
              }}>
                Built with React · Vite · Capacitor
              </div>
            </div>
          </div>
        )}

        {/* ══ SCORE ═══════════════════════════════════════════════ */}
        {tab === "Score" && (
          <div style={{ padding:"12px 12px 0" }}>
            {/* Scoreboard */}
            <div style={{
              background:`linear-gradient(135deg, var(--green-dk, #0f4019), var(--green))`,
              borderRadius:"var(--radius-lg)", padding:"20px", marginBottom:10, color:"#fff",
            }}>
              <div style={{ fontSize:13, opacity:0.75, marginBottom:4 }}>
                {match.teamA} vs {match.teamB}
              </div>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
                <div>
                  <div style={{ fontSize:52, fontWeight:900, lineHeight:1, letterSpacing:"-1px" }}>
                    {inn.runs}<span style={{ fontSize:32, opacity:0.7 }}>/{inn.wickets}</span>
                  </div>
                  <div style={{ fontSize:14, opacity:0.8, marginTop:4 }}>
                    {inn.overs}.{inn.balls} / {match.overs} ov &nbsp;·&nbsp; RR {runRate}
                  </div>
                </div>
                <div style={{ textAlign:"right" }}>
                  <div style={{ fontSize:12, opacity:0.65 }}>Extras {inn.extras}</div>
                  <div style={{ fontSize:11, opacity:0.55, marginTop:2 }}>
                    Wd:{inn.wides} Nb:{inn.noBalls} B:{inn.byes} Lb:{inn.legByes}
                  </div>
                  {inn.freeHitNext && (
                    <div className="pulse" style={{
                      marginTop:8, background:"#facc15", color:"#78350f",
                      padding:"4px 10px", borderRadius:99, fontSize:12, fontWeight:800,
                    }}>⭐ FREE HIT</div>
                  )}
                </div>
              </div>

              {/* Batters */}
              <div style={{
                marginTop:14, background:"rgba(255,255,255,0.10)",
                borderRadius:"var(--radius-sm)", overflow:"hidden",
              }}>
                {/* Striker */}
                <div style={{
                  display:"flex", justifyContent:"space-between", alignItems:"center",
                  padding:"10px 12px", borderBottom:"1px solid rgba(255,255,255,0.08)",
                }}>
                  <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                    <span style={{ fontSize:14 }}>⚡</span>
                    <div>
                      <div style={{ fontSize:11, opacity:0.6, marginBottom:1 }}>On strike</div>
                      <div style={{ fontWeight:700, fontSize:15 }}>{striker}</div>
                    </div>
                  </div>
                  <div style={{ textAlign:"right" }}>
                    <div style={{ fontWeight:800, fontSize:20, lineHeight:1 }}>{strikerStats.runs}</div>
                    <div style={{ fontSize:11, opacity:0.65 }}>{strikerStats.balls}b · SR {strikerStats.sr}</div>
                  </div>
                </div>
                {/* Non-striker */}
                <div style={{
                  display:"flex", justifyContent:"space-between", alignItems:"center",
                  padding:"10px 12px",
                }}>
                  <div>
                    <div style={{ fontSize:11, opacity:0.6, marginBottom:1 }}>Non-striker</div>
                    <div style={{ fontWeight:500, fontSize:14 }}>{nonStr}</div>
                  </div>
                  <div style={{ textAlign:"right" }}>
                    <div style={{ fontWeight:700, fontSize:18, lineHeight:1, opacity:0.9 }}>{nonStrStats.runs}</div>
                    <div style={{ fontSize:11, opacity:0.6 }}>{nonStrStats.balls}b · SR {nonStrStats.sr}</div>
                  </div>
                </div>
              </div>

              {/* This over */}
              {inn.overDels.length > 0 && (
                <div style={{ marginTop:10 }}>
                  <OverDots dots={inn.overDels} />
                </div>
              )}
            </div>

            {/* Complete banner */}
            {isComplete && (
              <Card style={{ marginBottom:10, border:"2px solid var(--green)", background:"var(--green-lt)" }}>
                <div style={{ fontSize:15, fontWeight:700, color:"var(--green)", textAlign:"center" }}>
                  ✓ {forceEnded ? "Match ended" : "Innings complete"} — {inn.runs}/{inn.wickets}
                  {forceEnded ? ` (${inn.overs}.${inn.balls} overs)` : inn.wickets >= 10 ? " (All out)" : ` (${match.overs} overs)`}
                </div>
                {curInn === 1 && (
                  <button onClick={() => setCurInn(2)} style={{
                    ...btn("green"), width:"100%", marginTop:10, justifyContent:"center",
                  }}>Start Innings 2 →</button>
                )}
              </Card>
            )}

            {/* Bowler */}
            <Card style={{ marginBottom:10 }}>
              <SLabel>Bowler</SLabel>
              <select value={bowlerIdx} onChange={e => setBowlerIdx(+e.target.value)}>
                {bowling.map((p, i) => <option key={i} value={i}>{p}</option>)}
              </select>
            </Card>

            {/* Extras */}
            <Card style={{ marginBottom:10 }}>
              <SLabel>Extras (optional — tap to select)</SLabel>
              <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                {["Wide","No Ball","Bye","Leg Bye","Free Hit"].map(ex => (
                  <button key={ex} onClick={() => setSelExtra(selExtra===ex ? null : ex)} style={{
                    padding:"9px 14px", fontSize:13, fontWeight:700, borderRadius:99,
                    cursor:"pointer", minHeight:40,
                    border: selExtra===ex ? "2px solid var(--green)" : "1.5px solid var(--bdr)",
                    background: selExtra===ex ? "var(--green)" : "var(--bg-input)",
                    color: selExtra===ex ? "#fff" : "var(--txt-2)",
                  }}>{ex}</button>
                ))}
              </div>
              {selExtra && (
                <div style={{ fontSize:12, color:"var(--green)", marginTop:6, fontWeight:600 }}>
                  ✓ {selExtra} selected — now tap a run value below
                </div>
              )}
            </Card>

            {/* Run buttons */}
            <Card style={{ marginBottom:10 }}>
              <SLabel>Runs scored</SLabel>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:8, marginBottom:8 }}>
                {[1,2,3,4,5,6].map(r => (
                  <button key={r} onClick={() => addDelivery(r)} disabled={isComplete} style={{
                    aspectRatio:"1", borderRadius:"var(--radius-sm)", fontSize:22, fontWeight:800,
                    border: r===4 ? "2px solid var(--blue)" : r===6 ? "2px solid var(--green)" : "1.5px solid var(--bdr)",
                    background: r===6 ? "var(--green-lt)" : r===4 ? "var(--blue-lt)" : "var(--bg-input)",
                    color: r===6 ? "var(--green)" : r===4 ? "var(--blue)" : "var(--txt)",
                    cursor:"pointer", opacity: isComplete ? 0.35 : 1,
                    minHeight:58, display:"flex", alignItems:"center", justifyContent:"center",
                  }}>{r}</button>
                ))}
                <button onClick={() => addDelivery(0)} disabled={isComplete} style={{
                  aspectRatio:"1", borderRadius:"var(--radius-sm)", fontSize:18, fontWeight:700,
                  border:"1.5px solid var(--bdr)", background:"var(--bg-input)", color:"var(--txt-3)",
                  cursor:"pointer", opacity: isComplete ? 0.35 : 1,
                  minHeight:58, display:"flex", alignItems:"center", justifyContent:"center",
                }}>•</button>
                <button
                  onClick={() => { if (!isComplete && inn.wickets < 10) setWicketModalOpen(true); }}
                  disabled={isComplete || inn.wickets >= 10}
                  style={{
                    aspectRatio:"1", borderRadius:"var(--radius-sm)", fontSize:15, fontWeight:800,
                    border:"2px solid var(--red)", background:"var(--red-lt)", color:"var(--red)",
                    cursor:"pointer",
                    opacity: (isComplete || inn.wickets>=10) ? 0.35 : 1,
                    minHeight:58, display:"flex", alignItems:"center", justifyContent:"center",
                  }}>W</button>
              </div>
              {inn.freeHitNext && (
                <div style={{ fontSize:12, color:"var(--gold)", fontWeight:600, textAlign:"center" }}>
                  ⭐ Free Hit active — batsman cannot be dismissed (except run-out)
                </div>
              )}
            </Card>

            {/* Action row */}
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8, marginBottom:10 }}>
              <button
                onClick={() => setEditOpen(true)}
                disabled={!lastDel}
                style={{ ...btn("ghost"), opacity: lastDel ? 1 : 0.35, flexDirection:"column", gap:4, padding:"10px 6px" }}>
                <Icon.Edit /><span style={{ fontSize:11 }}>Edit ball</span>
              </button>
              <button onClick={() => cameraRef.current?.click()} style={{ ...btn("ghost"), flexDirection:"column", gap:4, padding:"10px 6px" }}>
                <Icon.Camera /><span style={{ fontSize:11 }}>Snap</span>
              </button>
              <button onClick={undoLast} disabled={!lastDel} style={{ ...btn("ghost"), opacity: lastDel ? 1 : 0.35, flexDirection:"column", gap:4, padding:"10px 6px" }}>
                <Icon.Undo /><span style={{ fontSize:11 }}>Undo</span>
              </button>
            </div>
            <input ref={cameraRef} type="file" accept="image/*" capture="environment" style={{ display:"none" }} onChange={handleCapture} />

            {/* End / New match row */}
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:4 }}>
              {!forceEnded ? (
                <button onClick={() => setConfirmEnd(true)} style={{
                  ...btn("red"), justifyContent:"center",
                }}>
                  🛑 End Match
                </button>
              ) : (
                <button onClick={() => setForceEnded(false)} style={{
                  ...btn("ghost"), justifyContent:"center", color:"var(--green)",
                }}>
                  ▶ Resume
                </button>
              )}
              <button onClick={() => { setDeliveries([]); setCurInn(1); setMatch(initMatch()); setSnapshots([]); setForceEnded(false); setTab("Setup"); }}
                style={{ ...btn("ghost"), justifyContent:"center" }}>
                New match
              </button>
            </div>

            {/* Confirm end dialog */}
            {confirmEnd && (
              <div style={{
                position:"fixed", inset:0, zIndex:800, background:"rgba(0,0,0,0.65)",
                display:"flex", alignItems:"flex-end", justifyContent:"center",
                padding:"0 0 var(--safe-b)",
              }} onClick={() => setConfirmEnd(false)}>
                <div className="slide-up" onClick={e => e.stopPropagation()} style={{
                  background:"var(--bg-card)", borderRadius:"var(--radius-lg) var(--radius-lg) 0 0",
                  padding:"24px 20px calc(24px + var(--safe-b))", width:"100%", maxWidth:480,
                  borderTop:"1px solid var(--bdr)",
                }}>
                  <div style={{ width:36, height:4, background:"var(--bdr)", borderRadius:99, margin:"0 auto 20px" }} />
                  <div style={{ fontSize:20, fontWeight:800, marginBottom:8, textAlign:"center" }}>End match?</div>
                  <div style={{ fontSize:14, color:"var(--txt-2)", textAlign:"center", marginBottom:24 }}>
                    This will stop scoring at <strong>{inn.runs}/{inn.wickets}</strong> in {inn.overs}.{inn.balls} overs.
                    You can resume later if needed.
                  </div>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                    <button onClick={() => { setForceEnded(true); setConfirmEnd(false); showToast("Match ended"); }}
                      style={{ ...btn("red"), justifyContent:"center", padding:14, fontSize:15 }}>
                      Yes, end it
                    </button>
                    <button onClick={() => setConfirmEnd(false)}
                      style={{ ...btn("ghost"), justifyContent:"center", padding:14, fontSize:15 }}>
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ══ HISTORY ═════════════════════════════════════════════ */}
        {tab === "History" && (
          <div style={{ padding:"12px 12px 0" }}>
            {/* Innings switcher */}
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:12 }}>
              {([1,2] as const).map(n => {
                const s = computeInnings(deliveries, n);
                const teamName = n===1 ? match.teamA : match.teamB;
                return (
                  <button key={n} onClick={() => setHistInn(n)} style={{
                    padding:12, borderRadius:"var(--radius-sm)", cursor:"pointer",
                    border: histInn===n ? "2px solid var(--green)" : "1.5px solid var(--bdr)",
                    background: histInn===n ? "var(--green-lt)" : "var(--bg-input)",
                    color: histInn===n ? "var(--green)" : "var(--txt-2)",
                    textAlign:"left",
                  }}>
                    <div style={{ fontSize:11, fontWeight:600, marginBottom:2 }}>Inn {n} · {teamName}</div>
                    <div style={{ fontSize:17, fontWeight:700 }}>{s.runs}/{s.wickets}</div>
                    <div style={{ fontSize:11 }}>{s.overs}.{s.balls} ov</div>
                  </button>
                );
              })}
            </div>

            {/* Stats row */}
            {(() => {
              const s = computeInnings(deliveries, histInn);
              const cnt = deliveries.filter(d=>d.innings===histInn).length;
              if (!cnt) return (
                <div style={{ textAlign:"center", color:"var(--txt-3)", padding:"40px 0" }}>
                  <div style={{ fontSize:36 }}>📋</div>
                  <div style={{ marginTop:8 }}>No deliveries recorded</div>
                </div>
              );
              return (
                <>
                  <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:8, marginBottom:12 }}>
                    {[
                      ["Runs",  s.runs],
                      ["Wkts",  s.wickets],
                      ["Overs", `${s.overs}.${s.balls}`],
                      ["Extras",s.extras],
                    ].map(([k,v]) => (
                      <Card key={k as string} style={{ textAlign:"center", padding:10 }}>
                        <div style={{ fontSize:10, color:"var(--txt-3)", fontWeight:600 }}>{k}</div>
                        <div style={{ fontSize:20, fontWeight:800, marginTop:2 }}>{v}</div>
                      </Card>
                    ))}
                  </div>

                  {/* Over-by-over */}
                  {Array.from({ length: s.overs + (s.balls > 0 ? 1 : 0) }).map((_, ov) => {
                    const ovDels = deliveries.filter(d=>d.innings===histInn && d.over===ov);
                    if (!ovDels.length) return null;
                    const ovRuns = ovDels.reduce((a,d) => a + d.runs + ((d.extra==="Wide"||d.extra==="No Ball")?1:0), 0);
                    const ovWkts = ovDels.filter(d=>d.isWicket).length;
                    const bPlayers = histInn===1 ? match.playersA : match.playersB;
                    return (
                      <Card key={ov} style={{ marginBottom:8 }}>
                        <div style={{ display:"flex", justifyContent:"space-between", marginBottom:8 }}>
                          <span style={{ fontWeight:700, fontSize:14 }}>Over {ov+1}</span>
                          <span style={{ fontSize:13, color:"var(--txt-2)", fontWeight:600 }}>
                            {ovRuns} runs{ovWkts ? ` · ${ovWkts}W` : ""}
                          </span>
                        </div>
                        <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
                          {ovDels.map((d, i) => {
                            const bPlayers2 = histInn===1 ? match.playersB : match.playersA;
                            const bName = bPlayers[d.batterIdx] ?? `P${d.batterIdx+1}`;
                            const outName = d.batsmanOutIdx != null ? (bPlayers[d.batsmanOutIdx] ?? `P${d.batsmanOutIdx+1}`) : bName;
                            const fielderName = d.fielderIdx != null ? (bPlayers2[d.fielderIdx] ?? `P${d.fielderIdx+1}`) : null;
                            const wicketDesc = d.dismissalType
                              ? `${outName} — ${d.dismissalType}${fielderName ? ` (${fielderName})` : ""}${d.runs ? ` +${d.runs}` : ""}`
                              : "WICKET";
                            const desc = d.isWicket ? wicketDesc
                              : d.extra ? `${d.extra}${d.runs ? " +"+d.runs : ""}` : `${d.runs} run${d.runs!==1?"s":""}`;
                            return (
                              <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                                <span style={{ fontSize:13, color:"var(--txt-2)" }}>
                                  Ball {i+1}: <strong style={{ color:"var(--txt)" }}>{bName}</strong> — {desc}
                                </span>
                                <div style={{ display:"flex", gap:4 }}>
                                  {d.freeHit && <span style={{ background:"var(--amber-lt)", color:"var(--amber)", padding:"2px 6px", borderRadius:99, fontSize:10, fontWeight:700 }}>FH</span>}
                                  {d.isWicket && <span style={{ background:"var(--red-lt)", color:"var(--red)", padding:"2px 6px", borderRadius:99, fontSize:10, fontWeight:700 }}>W</span>}
                                  {d.runs===4 && !d.isWicket && !d.extra && <span style={{ background:"var(--blue-lt)", color:"var(--blue)", padding:"2px 6px", borderRadius:99, fontSize:10, fontWeight:700 }}>4</span>}
                                  {d.runs===6 && <span style={{ background:"var(--green-lt)", color:"var(--green)", padding:"2px 6px", borderRadius:99, fontSize:10, fontWeight:700 }}>6</span>}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </Card>
                    );
                  })}
                </>
              );
            })()}
          </div>
        )}

        {/* ══ PHOTOS ══════════════════════════════════════════════ */}
        {tab === "Photos" && (
          <div style={{ padding:"12px 12px 0" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
              <div style={{ fontSize:15, fontWeight:700 }}>Match snapshots</div>
              <button onClick={() => cameraRef.current?.click()} style={{ ...btn("green"), padding:"9px 16px", fontSize:13 }}>
                <Icon.Camera /> Take photo
              </button>
              <input ref={cameraRef} type="file" accept="image/*" capture="environment" style={{ display:"none" }} onChange={handleCapture} />
            </div>

            {snapshots.length === 0 ? (
              <div style={{ textAlign:"center", color:"var(--txt-3)", padding:"60px 20px" }}>
                <div style={{ fontSize:48 }}>📷</div>
                <div style={{ marginTop:12, fontSize:15, fontWeight:500 }}>No photos yet</div>
                <div style={{ marginTop:6, fontSize:13 }}>Tap "Take photo" to capture a match moment</div>
              </div>
            ) : (
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                {[...snapshots].reverse().map(s => (
                  <div key={s.id} style={{ background:"var(--bg-card)", borderRadius:"var(--radius)", overflow:"hidden", border:"1px solid var(--bdr-2)" }}>
                    <img src={s.dataUrl} alt={s.caption} style={{ width:"100%", aspectRatio:"4/3", objectFit:"cover", display:"block" }} />
                    <div style={{ padding:"8px 10px" }}>
                      <div style={{ fontSize:12, fontWeight:600, color:"var(--txt)" }}>{s.caption}</div>
                      <div style={{ fontSize:11, color:"var(--txt-3)", marginTop:2 }}>{s.ts}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Bottom Nav */}
      <BottomNav active={tab} onChange={setTab} />
    </div>
  );
}
