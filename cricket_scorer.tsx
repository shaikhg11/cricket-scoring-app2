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
  nextBatterIdx?: number | null;   // manually chosen incoming batter
  battersCrossed?: boolean | null; // for Caught: did batters cross before catch?
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
  battingFirst: "A" | "B";
  tossWinner: string;
  inn1BatterA: number; inn1BatterB: number;
  inn2BatterA: number; inn2BatterB: number;
}

// ── Innings engine ───────────────────────────────────────────────
function computeInnings(dels: Delivery[], inn: 1 | 2, initA = 0, initB = 1): InningsState {
  const s: InningsState = {
    runs:0, wickets:0, overs:0, balls:0,
    extras:0, wides:0, noBalls:0, byes:0, legByes:0,
    freeHitNext:false, batterA:initA, batterB:initB, onStrike:0, overDels:[],
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
      const next = d.nextBatterIdx != null ? d.nextBatterIdx : Math.max(s.batterA, s.batterB) + 1;
      if (d.batsmanOutIdx != null) {
        if (d.batsmanOutIdx === s.batterA) s.batterA = next;
        else if (d.batsmanOutIdx === s.batterB) s.batterB = next;
        else { if (s.onStrike === 0) s.batterA = next; else s.batterB = next; }
      } else {
        if (s.onStrike === 0) s.batterA = next; else s.batterB = next;
      }
      // Flip strike if batters crossed (odd runs, or explicitly crossed on 0)
      if (d.runs % 2 === 1 || d.battersCrossed) s.onStrike = s.onStrike === 0 ? 1 : 0;
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
const DEFAULT_WHITES = [
  "Faraz (C)", "Sajid Masroor", "Asad Shaikh (vc)", "Ahmad Umair", "Faizan",
  "Hammad", "Moiz Khan", "Ali Khan", "Zaid Nawaz", "Huzaifa", "Ibrahim",
];
const DEFAULT_GREENS = [
  "Zuhair (C)", "Umair Sheikh", "Ahsan Akhtar", "Faiz Faizan", "Aman Shaikh",
  "Irfan Choudhary", "Nabil Farooq (vc)", "Saeed", "Ayyan", "Ammad", "Deen",
];

const initMatch = (): Match => ({
  id: Date.now().toString(), teamA: "Whites", teamB: "Greens", overs: 20,
  playersA: [...DEFAULT_WHITES], playersB: [...DEFAULT_GREENS],
  apiUrl: "http://aushaikh.runasp.net/api/sync", synced: false,
  battingFirst: "A", tossWinner: "",
  inn1BatterA: 0, inn1BatterB: 1, inn2BatterA: 0, inn2BatterB: 1,
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
  Share:   () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>,
  Info:    () => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>,
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
  onConfirm: (runs: number, dismissalType: string, fielderIdx: number | null, outBatterIdx: number, battersCrossed: boolean) => void;
  onClose: () => void;
}) {
  const [dismissalType,  setDismissalType]  = useState("Bowled");
  const [fielderIdx,     setFielderIdx]     = useState<number | null>(null);
  const [outBatterIdx,   setOutBatterIdx]   = useState<number>(strikerIdx);
  const [runsScored,     setRunsScored]     = useState(0);
  const [battersCrossed, setBattersCrossed] = useState(false);

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

        {/* Runs (run-out or caught) */}
        {(dismissalType === "Run Out" || dismissalType === "Caught") && (
          <div style={{ marginBottom:14 }}>
            <div style={{ fontSize:11, color:"var(--txt-3)", fontWeight:700, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:8 }}>
              {dismissalType === "Caught" ? "Runs scored before catch" : "Runs completed before run-out"}
            </div>
            <div style={{ display:"flex", gap:8 }}>
              {[0,1,2,3].map(r => (
                <button key={r} onClick={() => { setRunsScored(r); if (r !== 0) setBattersCrossed(false); }} style={{
                  flex:1, aspectRatio:"1", borderRadius:"50%", fontSize:16, fontWeight:700, minHeight:44,
                  border: runsScored===r ? "2px solid var(--green)" : "1.5px solid var(--bdr)",
                  background: runsScored===r ? "var(--green)" : "var(--bg-input)",
                  color: runsScored===r ? "#fff" : "var(--txt)", cursor:"pointer",
                }}>{r}</button>
              ))}
            </div>
          </div>
        )}

        {/* Batters crossed? (Caught + 0 runs only) */}
        {dismissalType === "Caught" && runsScored === 0 && (
          <div style={{ marginBottom:14 }}>
            <button onClick={() => setBattersCrossed(v => !v)} style={{
              width:"100%", padding:"12px 14px", borderRadius:"var(--radius-sm)", cursor:"pointer",
              border: battersCrossed ? "2px solid var(--blue)" : "1.5px solid var(--bdr)",
              background: battersCrossed ? "var(--blue-lt)" : "var(--bg-input)",
              color: battersCrossed ? "var(--blue)" : "var(--txt-2)",
              fontSize:14, fontWeight:700, textAlign:"left",
              display:"flex", alignItems:"center", gap:10,
            }}>
              <span style={{ fontSize:20 }}>{battersCrossed ? "✅" : "⬜"}</span>
              Batters crossed before catch
            </button>
            <div style={{ fontSize:11, color:"var(--txt-3)", marginTop:6, paddingLeft:4 }}>
              If they crossed, non-striker takes strike; otherwise new batter faces
            </div>
          </div>
        )}

        {/* Actions */}
        <div style={{ display:"grid", gridTemplateColumns:"2fr 1fr", gap:8 }}>
          <button onClick={() => onConfirm(runsScored, dismissalType, fielderIdx, outBatterIdx, battersCrossed)} style={{
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
  { id:"About",   label:"About",   IconC: Icon.Info    },
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

// ── NextBatterModal ───────────────────────────────────────────────
function NextBatterModal({ batting, available, onConfirm, onClose }: {
  batting: string[];
  available: number[];
  onConfirm: (idx: number) => void;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<number | null>(available[0] ?? null);

  return (
    <div style={{ position:"fixed", inset:0, zIndex:1050, background:"rgba(0,0,0,0.72)",
      display:"flex", alignItems:"flex-end", justifyContent:"center" }} onClick={onClose}>
      <div className="slide-up" onClick={e => e.stopPropagation()} style={{
        background:"var(--bg-card)", borderRadius:"var(--radius-lg) var(--radius-lg) 0 0",
        padding:"20px 20px calc(20px + env(safe-area-inset-bottom,0px))",
        width:"100%", maxWidth:480, maxHeight:"80vh", overflowY:"auto",
        borderTop:"2px solid var(--green)",
      }}>
        <div style={{ width:36, height:4, background:"var(--bdr)", borderRadius:99, margin:"0 auto 14px" }} />
        <div style={{ fontSize:17, fontWeight:800, color:"var(--green)", marginBottom:4 }}>🏏 Next batter</div>
        <div style={{ fontSize:13, color:"var(--txt-3)", marginBottom:14 }}>Select the incoming batter</div>

        {available.length === 0 ? (
          <div style={{ textAlign:"center", color:"var(--txt-3)", padding:"20px 0", fontSize:15 }}>
            All out — no batters remaining
          </div>
        ) : (
          <div style={{ display:"flex", flexDirection:"column", gap:8, marginBottom:16 }}>
            {available.map(i => (
              <button key={i} onClick={() => setSelected(i)} style={{
                display:"flex", alignItems:"center", gap:12,
                padding:"12px 14px", borderRadius:"var(--radius-sm)", cursor:"pointer",
                border: selected === i ? "2px solid var(--green)" : "1.5px solid var(--bdr)",
                background: selected === i ? "var(--green-lt)" : "var(--bg-input)",
                color: selected === i ? "var(--green)" : "var(--txt-2)",
              }}>
                <span style={{
                  width:28, height:28, borderRadius:"50%", flexShrink:0, fontSize:12, fontWeight:700,
                  background: selected === i ? "var(--green)" : "var(--bdr)",
                  color: selected === i ? "#fff" : "var(--txt-3)",
                  display:"flex", alignItems:"center", justifyContent:"center",
                }}>{i+1}</span>
                <span style={{ fontSize:15, fontWeight:600 }}>{batting[i] ?? `Player ${i+1}`}</span>
                {selected === i && <span style={{ marginLeft:"auto", fontSize:18 }}>✓</span>}
              </button>
            ))}
          </div>
        )}

        <div style={{ display:"grid", gridTemplateColumns:"2fr 1fr", gap:8 }}>
          <button
            onClick={() => selected != null && onConfirm(selected)}
            disabled={selected == null || available.length === 0}
            style={{ ...btn("green"), justifyContent:"center", fontSize:15, padding:14, opacity: selected == null ? 0.4 : 1 }}
          >✓ Confirm</button>
          <button onClick={onClose} style={{ ...btn("ghost"), justifyContent:"center" }}>Skip</button>
        </div>
      </div>
    </div>
  );
}

// ── LiveView (read-only spectator) ───────────────────────────────
function LiveView({ matchId }: { matchId: string }) {
  const [lMatch,  setLMatch]  = useState<Match | null>(null);
  const [lDels,   setLDels]   = useState<Delivery[]>([]);
  const [lInn,    setLInn]    = useState<1|2>(1);
  const [loading, setLoading] = useState(true);
  const [lastAt,  setLastAt]  = useState("");
  const BASE = "http://aushaikh.runasp.net/api";

  const load = useCallback(async () => {
    try {
      const [mr, dr] = await Promise.all([
        fetch(`${BASE}/matches/${matchId}`),
        fetch(`${BASE}/matches/${matchId}/deliveries`),
      ]);
      if (!mr.ok) return;
      const md = await mr.json();
      const dd: any[] = await dr.json();
      const m: Match = {
        id: md.id, teamA: md.teamA, teamB: md.teamB, overs: md.overs,
        playersA: md.playersA, playersB: md.playersB,
        apiUrl: BASE + "/sync", synced: true,
        battingFirst: md.battingFirst ?? "A",
        tossWinner: md.tossWinner ?? "",
        inn1BatterA: md.inn1BatterA ?? 0, inn1BatterB: md.inn1BatterB ?? 1,
        inn2BatterA: md.inn2BatterA ?? 0, inn2BatterB: md.inn2BatterB ?? 1,
      };
      const dels: Delivery[] = dd.map((d: any) => ({ ...d, matchId: md.id }));
      setLMatch(m);
      setLDels(dels);
      setLInn(dels.some(d => d.innings === 2) ? 2 : 1);
      setLastAt(new Date().toLocaleTimeString());
    } catch {}
    finally { setLoading(false); }
  }, [matchId]);

  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, [load]);

  if (loading) return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", height:"100dvh", gap:16, color:"var(--txt)" }}>
      <div style={{ fontSize:48 }}>🏏</div>
      <div style={{ fontSize:18, fontWeight:700 }}>Loading match…</div>
    </div>
  );
  if (!lMatch) return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", height:"100dvh", gap:12, color:"var(--txt)" }}>
      <div style={{ fontSize:48 }}>❌</div>
      <div style={{ fontWeight:700 }}>Match not found</div>
      <div style={{ fontSize:13, color:"var(--txt-3)" }}>ID: {matchId}</div>
    </div>
  );

  const batting = lInn === 1
    ? (lMatch.battingFirst === "A" ? lMatch.playersA : lMatch.playersB)
    : (lMatch.battingFirst === "A" ? lMatch.playersB : lMatch.playersA);
  const bowling = lInn === 1
    ? (lMatch.battingFirst === "A" ? lMatch.playersB : lMatch.playersA)
    : (lMatch.battingFirst === "A" ? lMatch.playersA : lMatch.playersB);
  const initA = lInn === 1 ? lMatch.inn1BatterA : lMatch.inn2BatterA;
  const initB = lInn === 1 ? lMatch.inn1BatterB : lMatch.inn2BatterB;
  const inn = computeInnings(lDels, lInn, initA, initB);
  const striker = batting[inn.onStrike === 0 ? inn.batterA : inn.batterB] ?? "—";
  const nonStr  = batting[inn.onStrike === 0 ? inn.batterB : inn.batterA] ?? "—";
  const batTeam = lInn === 1
    ? (lMatch.battingFirst === "A" ? lMatch.teamA : lMatch.teamB)
    : (lMatch.battingFirst === "A" ? lMatch.teamB : lMatch.teamA);
  const curBowler = bowling[lDels.filter(d => d.innings === lInn).at(-1)?.bowlerIdx ?? 0] ?? "—";
  const played = inn.overs * 6 + inn.balls;
  const rr = played > 0 ? (inn.runs / (played / 6)).toFixed(2) : "—";

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100dvh", maxWidth:480, margin:"0 auto", background:"var(--bg)" }}>
      {/* Header */}
      <div style={{ background:"var(--bg-card)", borderBottom:"1px solid var(--bdr)", padding:"12px 16px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <span style={{ fontSize:20 }}>🏏</span>
          <span style={{ fontSize:15, fontWeight:700 }}>{lMatch.teamA} vs {lMatch.teamB}</span>
        </div>
        <button onClick={load} style={{ ...btn("ghost"), padding:"6px 12px", fontSize:12 }}>↻ Refresh</button>
      </div>

      <div style={{ flex:1, overflowY:"auto", padding:"12px" }}>
        {/* Innings tabs */}
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:10 }}>
          {([1,2] as const).map(n => {
            const s = computeInnings(lDels, n, n===1 ? lMatch.inn1BatterA : lMatch.inn2BatterA, n===1 ? lMatch.inn1BatterB : lMatch.inn2BatterB);
            const tName = n===1 ? (lMatch.battingFirst==="A" ? lMatch.teamA : lMatch.teamB) : (lMatch.battingFirst==="A" ? lMatch.teamB : lMatch.teamA);
            return (
              <button key={n} onClick={() => setLInn(n)} style={{
                padding:10, borderRadius:"var(--radius-sm)", cursor:"pointer",
                border: lInn===n ? "2px solid var(--green)" : "1.5px solid var(--bdr)",
                background: lInn===n ? "var(--green-lt)" : "var(--bg-input)",
                color: lInn===n ? "var(--green)" : "var(--txt-2)", textAlign:"left",
              }}>
                <div style={{ fontSize:11, fontWeight:600 }}>Inn {n} · {tName}</div>
                <div style={{ fontSize:17, fontWeight:700 }}>{s.runs}/{s.wickets}</div>
                <div style={{ fontSize:11 }}>{s.overs}.{s.balls} ov</div>
              </button>
            );
          })}
        </div>

        {/* Scoreboard */}
        <div style={{ background:"linear-gradient(135deg,#0f4019,#1a6b2a)", borderRadius:"var(--radius-lg)", padding:"20px", color:"#fff", marginBottom:10 }}>
          <div style={{ fontSize:12, opacity:0.7, marginBottom:4 }}>{batTeam} batting · Inn {lInn}</div>
          <div style={{ fontSize:52, fontWeight:900, lineHeight:1 }}>{inn.runs}<span style={{ fontSize:32, opacity:0.7 }}>/{inn.wickets}</span></div>
          <div style={{ fontSize:14, opacity:0.8, marginTop:4 }}>{inn.overs}.{inn.balls} / {lMatch.overs} ov · RR {rr}</div>
          <div style={{ fontSize:11, opacity:0.55, marginTop:2 }}>Extras {inn.extras} · Wd:{inn.wides} Nb:{inn.noBalls}</div>

          <div style={{ marginTop:12, background:"rgba(255,255,255,0.1)", borderRadius:"var(--radius-sm)", overflow:"hidden" }}>
            <div style={{ display:"flex", justifyContent:"space-between", padding:"10px 12px", borderBottom:"1px solid rgba(255,255,255,0.08)" }}>
              <div><div style={{ fontSize:10, opacity:0.6 }}>⚡ On strike</div><div style={{ fontWeight:700 }}>{striker}</div></div>
            </div>
            <div style={{ display:"flex", justifyContent:"space-between", padding:"10px 12px" }}>
              <div><div style={{ fontSize:10, opacity:0.6 }}>Non-striker</div><div style={{ fontWeight:600, fontSize:14 }}>{nonStr}</div></div>
            </div>
          </div>

          {inn.overDels.length > 0 && (
            <div style={{ marginTop:10 }}><OverDots dots={inn.overDels} /></div>
          )}
        </div>

        {/* Bowler */}
        <Card style={{ marginBottom:10 }}>
          <SLabel>Current bowler</SLabel>
          <div style={{ fontSize:15, fontWeight:700 }}>{curBowler}</div>
        </Card>

        <div style={{ textAlign:"center", fontSize:12, color:"var(--txt-3)", marginTop:4 }}>
          Live · Auto-refreshes every 30s · Last: {lastAt}
        </div>
      </div>
    </div>
  );
}

// ── PreMatchModal ────────────────────────────────────────────────
function PreMatchModal({ match, showToss, inn, onConfirm, onClose }: {
  match: Match;
  showToss: boolean;
  inn: 1 | 2;
  onConfirm: (p: { battingFirst: "A"|"B"; tossWinner: string; batterA: number; batterB: number; bowlerIdx: number }) => void;
  onClose: () => void;
}) {
  const [battingFirst, setBattingFirst] = useState<"A"|"B">(match.battingFirst);
  const [tossWinner,   setTossWinner]   = useState(match.tossWinner || match.teamA);
  const [batterA,      setBatterA]      = useState(inn === 1 ? match.inn1BatterA : match.inn2BatterA);
  const [batterB,      setBatterB]      = useState(inn === 1 ? match.inn1BatterB : match.inn2BatterB);
  const [bowlerIdx,    setBowlerIdx]    = useState(0);

  const batting = battingFirst === "A" ? match.playersA : match.playersB;
  const bowling = battingFirst === "A" ? match.playersB : match.playersA;

  const selA = (i: number) => { setBatterA(i); if (i === batterB) setBatterB(i === 0 ? 1 : 0); };
  const selB = (i: number) => { setBatterB(i); if (i === batterA) setBatterA(i === 0 ? 1 : 0); };

  const teamLabel = (k: "A"|"B") => k === "A" ? match.teamA : match.teamB;

  return (
    <div style={{ position:"fixed", inset:0, zIndex:1100, background:"rgba(0,0,0,0.75)", display:"flex", alignItems:"flex-end", justifyContent:"center" }}>
      <div className="slide-up" style={{
        background:"var(--bg-card)", borderRadius:"var(--radius-lg) var(--radius-lg) 0 0",
        padding:"20px 20px calc(20px + env(safe-area-inset-bottom,0px))",
        width:"100%", maxWidth:480, maxHeight:"90vh", overflowY:"auto",
        borderTop:"2px solid var(--green)",
      }}>
        <div style={{ width:36, height:4, background:"var(--bdr)", borderRadius:99, margin:"0 auto 14px" }} />
        <div style={{ fontSize:17, fontWeight:800, color:"var(--green)", marginBottom:16 }}>
          🏏 {showToss ? "Match Setup" : `Innings ${inn} Setup`}
        </div>

        {showToss && (
          <>
            <div style={{ marginBottom:14 }}>
              <SLabel>Toss won by</SLabel>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
                {(["A","B"] as const).map(k => (
                  <button key={k} onClick={() => setTossWinner(teamLabel(k))} style={{
                    padding:"11px 10px", borderRadius:"var(--radius-sm)", cursor:"pointer",
                    border: tossWinner === teamLabel(k) ? "2px solid var(--gold)" : "1.5px solid var(--bdr)",
                    background: tossWinner === teamLabel(k) ? "rgba(234,179,8,0.15)" : "var(--bg-input)",
                    color: tossWinner === teamLabel(k) ? "var(--gold)" : "var(--txt-2)",
                    fontSize:14, fontWeight:700,
                  }}>{tossWinner === teamLabel(k) ? "🪙 " : ""}{teamLabel(k)}</button>
                ))}
              </div>
            </div>
            <div style={{ marginBottom:14 }}>
              <SLabel>Batting first</SLabel>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
                {(["A","B"] as const).map(k => (
                  <button key={k} onClick={() => setBattingFirst(k)} style={{
                    padding:"11px 10px", borderRadius:"var(--radius-sm)", cursor:"pointer",
                    border: battingFirst === k ? "2px solid var(--green)" : "1.5px solid var(--bdr)",
                    background: battingFirst === k ? "var(--green-lt)" : "var(--bg-input)",
                    color: battingFirst === k ? "var(--green)" : "var(--txt-2)",
                    fontSize:14, fontWeight:700,
                  }}>🏏 {teamLabel(k)}</button>
                ))}
              </div>
            </div>
          </>
        )}

        <div style={{ marginBottom:14 }}>
          <SLabel>Opening batters — {battingFirst === "A" ? match.teamA : match.teamB}</SLabel>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
            <div>
              <div style={{ fontSize:11, color:"var(--txt-3)", marginBottom:4 }}>⚡ On strike</div>
              <select value={batterA} onChange={e => selA(+e.target.value)}>
                {batting.map((p, i) => <option key={i} value={i} disabled={i === batterB}>{p}</option>)}
              </select>
            </div>
            <div>
              <div style={{ fontSize:11, color:"var(--txt-3)", marginBottom:4 }}>Non-striker</div>
              <select value={batterB} onChange={e => selB(+e.target.value)}>
                {batting.map((p, i) => <option key={i} value={i} disabled={i === batterA}>{p}</option>)}
              </select>
            </div>
          </div>
        </div>

        <div style={{ marginBottom:20 }}>
          <SLabel>Opening bowler — {battingFirst === "A" ? match.teamB : match.teamA}</SLabel>
          <select value={bowlerIdx} onChange={e => setBowlerIdx(+e.target.value)}>
            {bowling.map((p, i) => <option key={i} value={i}>{p}</option>)}
          </select>
        </div>

        <div style={{ display:"grid", gridTemplateColumns:"2fr 1fr", gap:8 }}>
          <button onClick={() => onConfirm({ battingFirst, tossWinner, batterA, batterB, bowlerIdx })} style={{
            ...btn("green"), justifyContent:"center", fontSize:15, padding:14,
          }}>✓ Start Scoring</button>
          <button onClick={onClose} style={{ ...btn("ghost"), justifyContent:"center" }}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ── Main App ─────────────────────────────────────────────────────
export default function App() {
  const liveMatchId = new URLSearchParams(window.location.search).get("liveMatch");
  if (liveMatchId) return <LiveView matchId={liveMatchId} />;
  return <ScoreApp />;
}

function ScoreApp() {
  const [tab,           setTab]          = useState<TabId>("Setup");
  const [match,         setMatch]        = useState<Match>(initMatch);
  const [deliveries,    setDeliveries]   = useState<Delivery[]>([]);
  const [curInn,        setCurInn]       = useState<1|2>(1);
  const [selExtra,      setSelExtra]     = useState<string|null>(null);
  const [editTeam,      setEditTeam]     = useState<"A"|"B">("A");
  const [bowlerIdx,     setBowlerIdx]    = useState(0);
  const [bowlerManuallySet, setBowlerManuallySet] = useState(false);
  const [bowlerAutoMsg,     setBowlerAutoMsg]     = useState<string>("");
  const prevOversRef   = useRef<number>(-1);
  const prevCurInnRef  = useRef<1|2>(1);
  const [anim,          setAnim]         = useState<string|null>(null);
  const [editOpen,      setEditOpen]     = useState(false);
  const [snapshots,     setSnapshots]    = useState<Snapshot[]>([]);
  const [toast,         setToast]        = useState("");
  const [syncSt,        setSyncSt]       = useState<""|"syncing"|"ok"|"err">("");
  const [histInn,       setHistInn]      = useState<1|2>(1);
  const [histView,      setHistView]     = useState<"Scorecard"|"Overs">("Scorecard");
  const [resuming,        setResuming]       = useState(false);
  const [matchInProgress, setMatchInProgress] = useState(false);
  const [preMatchModal,   setPreMatchModal]   = useState<null | { inn: 1|2; showToss: boolean }>(null);
  const [pendingWicket,   setPendingWicket]   = useState<null | { runs:number; dismissalType:string; fielderIdx:number|null; batsmanOutIdx:number; battersCrossed:boolean }>(null);
  const [confirmNewMatch, setConfirmNewMatch] = useState(false);
  const cameraRef = useRef<HTMLInputElement>(null);

  const initA = curInn === 1 ? match.inn1BatterA : match.inn2BatterA;
  const initB = curInn === 1 ? match.inn1BatterB : match.inn2BatterB;
  const inn      = computeInnings(deliveries, curInn, initA, initB);
  const maxBalls = match.overs * 6;
  const played   = inn.overs * 6 + inn.balls;
  const [forceEnded, setForceEnded] = useState(false);
  const [confirmEnd,      setConfirmEnd]      = useState(false);
  const [wicketModalOpen, setWicketModalOpen] = useState(false);
  const isComplete = played >= maxBalls || inn.wickets >= 10 || forceEnded;
  const lastDel  = deliveries.filter(d => d.innings === curInn).at(-1) ?? null;
  // batting/bowling respects who bats first
  const batting  = curInn === 1
    ? (match.battingFirst === "A" ? match.playersA : match.playersB)
    : (match.battingFirst === "A" ? match.playersB : match.playersA);
  const bowling  = curInn === 1
    ? (match.battingFirst === "A" ? match.playersB : match.playersA)
    : (match.battingFirst === "A" ? match.playersA : match.playersB);
  const strikerIdx  = inn.onStrike === 0 ? inn.batterA : inn.batterB;
  const nonStrIdx   = inn.onStrike === 0 ? inn.batterB : inn.batterA;
  const striker     = batting[strikerIdx]  ?? "—";
  const nonStr      = batting[nonStrIdx]   ?? "—";
  const batTeam     = curInn === 1
    ? (match.battingFirst === "A" ? match.teamA : match.teamB)
    : (match.battingFirst === "A" ? match.teamB : match.teamA);
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

  // ── Restore in-progress match from server on page load ──────────
  useEffect(() => {
    const savedMatchId = localStorage.getItem("cricket_activeMatchId");
    const savedApiUrl  = localStorage.getItem("cricket_apiUrl");
    if (!savedMatchId || !savedApiUrl) return;

    const baseUrl = savedApiUrl.replace(/\/sync$/i, "");
    setResuming(true);

    (async () => {
      try {
        const [matchRes, delsRes] = await Promise.all([
          fetch(`${baseUrl}/matches/${savedMatchId}`),
          fetch(`${baseUrl}/matches/${savedMatchId}/deliveries`),
        ]);
        if (!matchRes.ok || !delsRes.ok) { setResuming(false); return; }

        const matchData   = await matchRes.json();
        const delsData: any[] = await delsRes.json();

        setMatch({
          id: matchData.id,
          teamA: matchData.teamA,
          teamB: matchData.teamB,
          overs: matchData.overs,
          playersA: matchData.playersA,
          playersB: matchData.playersB,
          apiUrl: savedApiUrl,
          synced: true,
          battingFirst: matchData.battingFirst ?? "A",
          tossWinner: matchData.tossWinner ?? "",
          inn1BatterA: matchData.inn1BatterA ?? 0,
          inn1BatterB: matchData.inn1BatterB ?? 1,
          inn2BatterA: matchData.inn2BatterA ?? 0,
          inn2BatterB: matchData.inn2BatterB ?? 1,
        });

        const loadedDels: Delivery[] = delsData.map(d => ({
          id:            d.id,
          matchId:       matchData.id,
          innings:       d.innings as 1 | 2,
          over:          d.over,
          ball:          d.ball,
          runs:          d.runs,
          extra:         d.extra,
          isWicket:      d.isWicket,
          freeHit:       d.freeHit,
          batterIdx:     d.batterIdx,
          bowlerIdx:     d.bowlerIdx,
          dismissalType: d.dismissalType,
          fielderIdx:    d.fielderIdx,
          batsmanOutIdx: d.batsmanOutIdx,
          nextBatterIdx: d.nextBatterIdx ?? null,
        }));

        setDeliveries(loadedDels);
        setCurInn(loadedDels.some(d => d.innings === 2) ? 2 : 1);
        setMatchInProgress(true);
        setTab("Score");
        showToast("Match resumed from server ✓");
      } catch {
        // silently fall through to fresh setup
      } finally {
        setResuming(false);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Auto-rotate bowler after every completed over ────────────────
  useEffect(() => {
    // Reset when innings changes
    if (curInn !== prevCurInnRef.current) {
      prevCurInnRef.current = curInn;
      prevOversRef.current  = -1;
      setBowlerIdx(0);
      setBowlerManuallySet(false);
      setBowlerAutoMsg("");
      return;
    }

    const currentOvers = inn.overs;

    // Guard: skip the very first render (prevOversRef is -1)
    if (prevOversRef.current === -1) {
      prevOversRef.current = currentOvers;
      return;
    }

    if (currentOvers > prevOversRef.current) {
      // An over just completed
      setBowlerManuallySet(prev => {
        if (!prev) {
          // Auto-advance to the next player in order
          setBowlerIdx(bi => {
            const bowling2 = curInn === 1 ? match.playersB : match.playersA;
            const next = (bi + 1) % bowling2.length;
            const msg = `🔄 Over ${currentOvers} done — auto: ${bowling2[next]}`;
            setBowlerAutoMsg(msg);
            showToast(msg);
            return next;
          });
        } else {
          // User already picked — keep their choice, just toast
          setBowlerIdx(bi => {
            const bowling2 = curInn === 1 ? match.playersB : match.playersA;
            const msg = `✅ Over ${currentOvers} done — ${bowling2[bi]}`;
            setBowlerAutoMsg(msg);
            showToast(msg);
            return bi;
          });
        }
        return false; // reset the manual flag for the upcoming over
      });
      prevOversRef.current = currentOvers;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inn.overs, curInn]);

  async function addDelivery(
    runs: number,
    isWicket = false,
    wicketInfo?: { dismissalType: string; fielderIdx: number | null; batsmanOutIdx: number | null; battersCrossed?: boolean } | null,
    nextBatterIdx?: number | null,
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
      nextBatterIdx: isWicket ? (nextBatterIdx ?? null) : null,
      battersCrossed: isWicket ? (wicketInfo?.battersCrossed ?? null) : null,
    };
    const newDeliveries = [...deliveries, d];
    setDeliveries(newDeliveries);
    setSelExtra(null);
    if (isWicket)        setAnim("out");
    else if (runs === 6) setAnim("six");
    else if (runs === 4 && !selExtra) setAnim("four");
    try { await dbPut("deliveries", d); } catch (e: any) { showToast("Save error"); }
    if (isWicket || runs === 6 || (runs === 4 && !selExtra)) syncNow(newDeliveries);
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
    const newDeliveries = deliveries.slice(0, -1);
    setDeliveries(newDeliveries);
    setEditOpen(false);
    showToast("Last ball undone");
    syncNow(newDeliveries);
  }

  async function syncNow(dels: Delivery[], m: Match = match) {
    if (!m.apiUrl) return;
    setSyncSt("syncing");
    try {
      const payload = {
        match: m, deliveries: dels,
        innings1: computeInnings(dels, 1, m.inn1BatterA, m.inn1BatterB),
        innings2: computeInnings(dels, 2, m.inn2BatterA, m.inn2BatterB),
        syncedAt: new Date().toISOString(),
      };
      const r = await fetch(m.apiUrl, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify(payload),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setSyncSt("ok");
      setMatch(m => ({ ...m, synced: true }));
      setTimeout(() => setSyncSt(""), 3000);
    } catch (e: any) {
      setSyncSt("err");
      setTimeout(() => setSyncSt(""), 3000);
    }
  }

  async function handleSync() {
    try {
      await syncNow(deliveries);
      showToast("Synced to API ✓");
    } catch (e: any) {
      showToast("Sync failed: " + e.message);
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

  async function handleFinaliseEnd() {
    setForceEnded(true);
    setConfirmEnd(false);
    localStorage.removeItem("cricket_activeMatchId");
    localStorage.removeItem("cricket_apiUrl");
    try {
      await syncNow(deliveries);
      showToast("Match ended & synced ✓");
    } catch {
      showToast("Match ended (sync failed)");
    }
  }

  async function handleNewMatch() {
    // Sync and clear the current match before resetting
    localStorage.removeItem("cricket_activeMatchId");
    localStorage.removeItem("cricket_apiUrl");
    if (deliveries.length > 0) {
      try { await syncNow(deliveries); } catch {}
    }
    setDeliveries([]);
    setCurInn(1);
    setMatch(initMatch());
    setSnapshots([]);
    setForceEnded(false);
    setMatchInProgress(false);
    setConfirmNewMatch(false);
    setBowlerIdx(0);
    setBowlerManuallySet(false);
    setBowlerAutoMsg("");
    setTab("Setup");
  }

  async function handleStartMatch() {
    await dbPut("matches", match);
    setPreMatchModal({ inn: 1, showToss: true });
  }

  async function handlePreMatchConfirm(p: { battingFirst:"A"|"B"; tossWinner:string; batterA:number; batterB:number; bowlerIdx:number }) {
    const isInn2 = preMatchModal?.inn === 2;
    const updated: Match = {
      ...match,
      battingFirst: isInn2 ? match.battingFirst : p.battingFirst,
      tossWinner:   isInn2 ? match.tossWinner   : p.tossWinner,
      inn1BatterA:  isInn2 ? match.inn1BatterA  : p.batterA,
      inn1BatterB:  isInn2 ? match.inn1BatterB  : p.batterB,
      inn2BatterA:  isInn2 ? p.batterA          : match.inn2BatterA,
      inn2BatterB:  isInn2 ? p.batterB          : match.inn2BatterB,
    };
    setMatch(updated);
    setBowlerIdx(p.bowlerIdx);
    setBowlerManuallySet(true);
    if (isInn2) {
      setCurInn(2);
      setBowlerAutoMsg("");
    }
    setMatchInProgress(true);
    setPreMatchModal(null);
    setTab("Score");
    await dbPut("matches", updated);
    if (updated.apiUrl) {
      localStorage.setItem("cricket_activeMatchId", updated.id);
      localStorage.setItem("cricket_apiUrl", updated.apiUrl);
      syncNow(deliveries, updated);
    }
  }

  async function handleShare() {
    const url = `${window.location.origin}${window.location.pathname}?liveMatch=${match.id}`;
    if (navigator.share) {
      navigator.share({ title: `${match.teamA} vs ${match.teamB}`, text: "Follow the match live!", url }).catch(() => {});
    } else {
      try { await navigator.clipboard.writeText(url); showToast("Link copied! ✓"); }
      catch { showToast(url); }
    }
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

      {/* Resuming overlay */}
      {resuming && (
        <div style={{
          position:"fixed", inset:0, zIndex:9998,
          background:"rgba(0,0,0,0.88)",
          display:"flex", flexDirection:"column",
          alignItems:"center", justifyContent:"center",
          gap:16, color:"#fff",
        }}>
          <div style={{ fontSize:52 }}>🏏</div>
          <div style={{ fontSize:20, fontWeight:800 }}>Resuming match…</div>
          <div style={{ fontSize:13, opacity:0.6 }}>Loading from server</div>
        </div>
      )}

      {preMatchModal && (
        <PreMatchModal
          match={match} showToss={preMatchModal.showToss} inn={preMatchModal.inn}
          onConfirm={handlePreMatchConfirm}
          onClose={() => setPreMatchModal(null)}
        />
      )}
      <EditBallModal delivery={editOpen ? lastDel : null} onSave={handleEditSave} onUndo={undoLast} onClose={() => setEditOpen(false)} />
      {wicketModalOpen && (
        <WicketModal
          striker={striker} nonStr={nonStr}
          strikerIdx={strikerIdx} nonStrIdx={nonStrIdx}
          bowling={bowling} freeHit={inn.freeHitNext}
          onConfirm={(runs, dismissalType, fielderIdx, outBatterIdx, battersCrossed) => {
            setWicketModalOpen(false);
            setPendingWicket({ runs, dismissalType, fielderIdx, batsmanOutIdx: outBatterIdx, battersCrossed });
          }}
          onClose={() => setWicketModalOpen(false)}
        />
      )}
      {pendingWicket && (() => {
        const dismissed = new Set(
          deliveries.filter(d => d.innings === curInn && d.isWicket)
            .map(d => d.batsmanOutIdx ?? d.batterIdx)
        );
        dismissed.add(pendingWicket.batsmanOutIdx);
        const remaining = new Set([strikerIdx, nonStrIdx]);
        remaining.delete(pendingWicket.batsmanOutIdx);
        const available = batting.map((_,i) => i).filter(i => !dismissed.has(i) && !remaining.has(i));
        return (
          <NextBatterModal
            batting={batting}
            available={available}
            onConfirm={nextIdx => {
              addDelivery(pendingWicket.runs, true, pendingWicket, nextIdx);
              setPendingWicket(null);
            }}
            onClose={() => {
              addDelivery(pendingWicket.runs, true, pendingWicket, null);
              setPendingWicket(null);
            }}
          />
        );
      })()}

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
          <div style={{ display:"flex", alignItems:"center", gap:6 }}>
            <button onClick={handleShare} style={{
              display:"flex", alignItems:"center", gap:4,
              padding:"7px 12px", borderRadius:99,
              border:"1.5px solid var(--bdr)", background:"var(--bg-input)",
              color:"var(--txt-2)", fontSize:13, fontWeight:600, cursor:"pointer",
            }}>
              <Icon.Share /> Share
            </button>
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
          </div>
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

            {/* Players */}
            <Card style={{ marginBottom:16 }}>
              <SLabel>Players</SLabel>
              {/* Team tabs + Add Player */}
              <div style={{ display:"flex", gap:6, marginBottom:12, alignItems:"stretch" }}>
                {(["A","B"] as const).map(t => {
                  const list = t==="A" ? match.playersA : match.playersB;
                  return (
                    <button key={t} onClick={() => setEditTeam(t)} style={{
                      flex:1, padding:"10px", borderRadius:"var(--radius-sm)", fontSize:14, fontWeight:600, cursor:"pointer",
                      border: editTeam===t ? "2px solid var(--green)" : "1.5px solid var(--bdr)",
                      background: editTeam===t ? "var(--green-lt)" : "var(--bg-input)",
                      color: editTeam===t ? "var(--green)" : "var(--txt-2)",
                      textAlign:"left" as const,
                    }}>
                      <div>{t==="A" ? match.teamA : match.teamB}</div>
                      <div style={{ fontSize:11, marginTop:2, opacity:0.7 }}>{list.length} players</div>
                    </button>
                  );
                })}
                {(() => {
                  const key = editTeam==="A" ? "playersA" : "playersB";
                  const list = editTeam==="A" ? match.playersA : match.playersB;
                  return list.length < 15 ? (
                    <button
                      onClick={() => setMatch(m => ({ ...m, [key]: [...list, `Player ${list.length+1}`] }))}
                      style={{ padding:"0 14px", borderRadius:"var(--radius-sm)", cursor:"pointer", border:"1.5px dashed var(--green)", background:"var(--green-lt)", color:"var(--green)", fontSize:20, fontWeight:700, flexShrink:0 }}
                    >+</button>
                  ) : null;
                })()}
              </div>
              <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                {(editTeam==="A" ? match.playersA : match.playersB).map((p, i) => {
                  const key     = editTeam==="A" ? "playersA" : "playersB";
                  const toKey   = editTeam==="A" ? "playersB" : "playersA";
                  const list    = editTeam==="A" ? match.playersA : match.playersB;
                  const isCap   = /\(c\)/i.test(p);
                  const canSwitch = !isCap && !matchInProgress;
                  return (
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
                          setMatch(m => { const a=[...m[key]]; a[i]=e.target.value; return {...m,[key]:a}; });
                        }}
                        style={{ fontSize:14, flex:1 }}
                      />
                      {canSwitch && (
                        <button
                          title={`Move to ${editTeam==="A" ? match.teamB : match.teamA}`}
                          onClick={() => setMatch(m => {
                            const from = [...m[key]];
                            const to   = [...m[toKey]];
                            const [player] = from.splice(i, 1);
                            to.push(player);
                            return { ...m, [key]: from, [toKey]: to };
                          })}
                          style={{ background:"var(--blue-lt)", color:"var(--blue)", border:"1px solid var(--blue)", borderRadius:"var(--radius-sm)", width:28, height:28, fontSize:15, cursor:"pointer", flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center" }}
                        >⇄</button>
                      )}
                      {list.length > 11 && (
                        <button
                          onClick={() => setMatch(m => { const a=[...m[key]]; a.splice(i,1); return {...m,[key]:a}; })}
                          style={{ background:"var(--red-lt)", color:"var(--red)", border:"none", borderRadius:"var(--radius-sm)", width:28, height:28, fontSize:16, cursor:"pointer", flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center" }}
                        >×</button>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>

            {!matchInProgress && (
              <button
                onClick={handleStartMatch}
                style={{
                  width:"100%", padding:16, borderRadius:"var(--radius)",
                  background:"var(--green)", color:"#fff", border:"none",
                  fontSize:17, fontWeight:700, cursor:"pointer",
                  display:"flex", alignItems:"center", justifyContent:"center", gap:8,
                  boxShadow:"0 4px 16px rgba(26,107,42,0.4)",
                }}>
                <Icon.Plus /> Start Match
              </button>
            )}
            {matchInProgress && (
              <div style={{
                padding:"14px 16px", borderRadius:"var(--radius)",
                background:"var(--green-lt)", border:"1.5px solid var(--green)",
                textAlign:"center", fontSize:14, fontWeight:600, color:"var(--green)",
              }}>
                ✓ Match in progress — go to Score tab to continue
              </div>
            )}

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
                  <button onClick={() => setPreMatchModal({ inn: 2, showToss: false })} style={{
                    ...btn("green"), width:"100%", marginTop:10, justifyContent:"center",
                  }}>Start Innings 2 →</button>
                )}
              </Card>
            )}

            {/* Bowler */}
            <Card style={{ marginBottom:10 }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
                <SLabel>Bowler</SLabel>
                {bowlerManuallySet && (
                  <span style={{
                    fontSize:11, fontWeight:700, color:"var(--green)",
                    background:"var(--green-lt)", padding:"2px 8px", borderRadius:99,
                  }}>✏️ Manually set</span>
                )}
                {!bowlerManuallySet && bowlerAutoMsg && (
                  <span style={{
                    fontSize:11, fontWeight:600, color:"var(--txt-3)",
                    padding:"2px 6px",
                  }}>🔄 Auto</span>
                )}
              </div>
              <select
                value={bowlerIdx}
                onChange={e => {
                  setBowlerIdx(+e.target.value);
                  setBowlerManuallySet(true);
                  setBowlerAutoMsg("");
                }}
              >
                {bowling.map((p, i) => <option key={i} value={i}>{p}</option>)}
              </select>
              {inn.balls === 0 && inn.overs > 0 && (
                <div style={{ fontSize:11, color:"var(--txt-3)", marginTop:5 }}>
                  {bowlerManuallySet
                    ? `Over ${inn.overs} · ${bowling[bowlerIdx]} to bowl`
                    : `Over ${inn.overs} · auto-selected ${bowling[bowlerIdx]} — change if needed`}
                </div>
              )}
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
              <button onClick={() => setConfirmNewMatch(true)}
                style={{ ...btn("ghost"), justifyContent:"center" }}>
                New match
              </button>
            </div>

            {/* Confirm new match dialog */}
            {confirmNewMatch && (
              <div style={{
                position:"fixed", inset:0, zIndex:800, background:"rgba(0,0,0,0.65)",
                display:"flex", alignItems:"flex-end", justifyContent:"center",
              }} onClick={() => setConfirmNewMatch(false)}>
                <div className="slide-up" onClick={e => e.stopPropagation()} style={{
                  background:"var(--bg-card)", borderRadius:"var(--radius-lg) var(--radius-lg) 0 0",
                  padding:"24px 20px calc(24px + env(safe-area-inset-bottom,0px))", width:"100%", maxWidth:480,
                  borderTop:"2px solid var(--green)",
                }}>
                  <div style={{ width:36, height:4, background:"var(--bdr)", borderRadius:99, margin:"0 auto 20px" }} />
                  <div style={{ fontSize:20, fontWeight:800, marginBottom:8, textAlign:"center" }}>Start a new match?</div>
                  <div style={{ fontSize:14, color:"var(--txt-2)", textAlign:"center", marginBottom:6 }}>
                    The current match (<strong>{match.teamA} vs {match.teamB}</strong>) will be ended and synced.
                  </div>
                  {deliveries.length > 0 && (
                    <div style={{ fontSize:13, color:"var(--txt-3)", textAlign:"center", marginBottom:20 }}>
                      Final score: {inn.runs}/{inn.wickets} in {inn.overs}.{inn.balls} ov
                    </div>
                  )}
                  {deliveries.length === 0 && <div style={{ marginBottom:20 }} />}
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                    <button onClick={handleNewMatch}
                      style={{ ...btn("green"), justifyContent:"center", padding:14, fontSize:15 }}>
                      ✓ Yes, new match
                    </button>
                    <button onClick={() => setConfirmNewMatch(false)}
                      style={{ ...btn("ghost"), justifyContent:"center", padding:14, fontSize:15 }}>
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}

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
                    Final score: <strong>{inn.runs}/{inn.wickets}</strong> in {inn.overs}.{inn.balls} overs.
                    Results will be synced and the match will be finalised.
                  </div>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                    <button onClick={handleFinaliseEnd}
                      style={{ ...btn("red"), justifyContent:"center", padding:14, fontSize:15 }}>
                      ✓ End &amp; Sync
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
                const teamName = n===1
                  ? (match.battingFirst==="A" ? match.teamA : match.teamB)
                  : (match.battingFirst==="A" ? match.teamB : match.teamA);
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

            {/* Sub-tab: Scorecard | Overs */}
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, marginBottom:12 }}>
              {(["Scorecard","Overs"] as const).map(v => (
                <button key={v} onClick={() => setHistView(v)} style={{
                  padding:"8px 0", borderRadius:"var(--radius-sm)", cursor:"pointer",
                  fontSize:13, fontWeight:600, border:"none",
                  background: histView===v ? "var(--green)" : "var(--bg-input)",
                  color: histView===v ? "#fff" : "var(--txt-2)",
                }}>{v}</button>
              ))}
            </div>

            {(() => {
              const s = computeInnings(deliveries, histInn);
              const innDels = deliveries.filter(d => d.innings === histInn);
              if (!innDels.length) return (
                <div style={{ textAlign:"center", color:"var(--txt-3)", padding:"40px 0" }}>
                  <div style={{ fontSize:36 }}>📋</div>
                  <div style={{ marginTop:8 }}>No deliveries recorded</div>
                </div>
              );

              const bTeam    = histInn===1
                ? (match.battingFirst==="A" ? match.playersA : match.playersB)
                : (match.battingFirst==="A" ? match.playersB : match.playersA);
              const bowlTeam = histInn===1
                ? (match.battingFirst==="A" ? match.playersB : match.playersA)
                : (match.battingFirst==="A" ? match.playersA : match.playersB);

              if (histView === "Scorecard") {
                // ── Batting stats ─────────────────────────────────
                const batterIndices = [...new Set(innDels.map(d => d.batterIdx))];
                const batStats = batterIndices.map(idx => {
                  const myDels = innDels.filter(d => d.batterIdx === idx);
                  const runs  = myDels.filter(d => d.extra !== "Bye" && d.extra !== "Leg Bye" && d.extra !== "Wide").reduce((a,d) => a + d.runs, 0);
                  const balls = myDels.filter(d => d.extra !== "Wide").length;
                  const fours = myDels.filter(d => d.runs === 4 && !d.extra).length;
                  const sixes = myDels.filter(d => d.runs === 6).length;
                  const sr    = balls > 0 ? ((runs / balls) * 100).toFixed(1) : "—";
                  const wicketDel = innDels.find(d => d.isWicket && (d.batsmanOutIdx === idx || (d.batsmanOutIdx == null && d.batterIdx === idx)));
                  const fldName   = wicketDel?.fielderIdx != null ? (bowlTeam[wicketDel.fielderIdx] ?? `P${wicketDel.fielderIdx+1}`) : null;
                  const dismissal = wicketDel
                    ? (wicketDel.dismissalType ?? "Out") + (fldName ? ` (${fldName})` : "")
                    : "not out";
                  return { idx, runs, balls, fours, sixes, sr, dismissal };
                });

                // ── Bowling stats ─────────────────────────────────
                const bowlerIndices = [...new Set(innDels.map(d => d.bowlerIdx))];
                const bowlStats = bowlerIndices.map(idx => {
                  const myDels    = innDels.filter(d => d.bowlerIdx === idx);
                  const legalDels = myDels.filter(d => d.extra !== "Wide" && d.extra !== "No Ball");
                  const totalBalls = legalDels.length;
                  const overs     = Math.floor(totalBalls / 6);
                  const remBalls  = totalBalls % 6;
                  const runs      = myDels.reduce((a,d) => a + d.runs + ((d.extra==="Wide"||d.extra==="No Ball")?1:0), 0);
                  const wickets   = myDels.filter(d => d.isWicket && d.dismissalType !== "Run Out").length;
                  let maidens = 0;
                  for (const ov of [...new Set(myDels.map(d => d.over))]) {
                    const ovDels  = myDels.filter(d => d.over === ov);
                    const ovLegal = ovDels.filter(d => d.extra !== "Wide" && d.extra !== "No Ball");
                    if (ovLegal.length < 6) continue;
                    if (ovDels.reduce((a,d) => a + d.runs + ((d.extra==="Wide"||d.extra==="No Ball")?1:0), 0) === 0) maidens++;
                  }
                  const eco = totalBalls > 0 ? ((runs / totalBalls) * 6).toFixed(2) : "—";
                  return { idx, overs, remBalls, runs, wickets, maidens, eco };
                });

                const colHdr: React.CSSProperties = { fontSize:10, color:"var(--txt-3)", fontWeight:700, textAlign:"right" as const };
                const colVal: React.CSSProperties = { fontSize:13, fontWeight:600, textAlign:"right" as const };

                return (
                  <>
                    {/* Batting */}
                    <SLabel>Batting</SLabel>
                    <Card style={{ marginBottom:12, padding:"12px 12px 4px" }}>
                      <div style={{ display:"grid", gridTemplateColumns:"1fr 44px 36px 28px 28px 44px", gap:4, marginBottom:8, paddingBottom:6, borderBottom:"1px solid var(--bdr)" }}>
                        <span style={{ fontSize:10, color:"var(--txt-3)", fontWeight:700 }}>BATTER</span>
                        <span style={colHdr}>R</span>
                        <span style={colHdr}>B</span>
                        <span style={colHdr}>4s</span>
                        <span style={colHdr}>6s</span>
                        <span style={colHdr}>SR</span>
                      </div>
                      {batStats.map((b, i) => (
                        <div key={b.idx} style={{ display:"grid", gridTemplateColumns:"1fr 44px 36px 28px 28px 44px", gap:4, paddingBottom:8, marginBottom: i < batStats.length-1 ? 8 : 0, borderBottom: i < batStats.length-1 ? "1px solid var(--bdr-2)" : "none" }}>
                          <div>
                            <div style={{ fontSize:13, fontWeight:600 }}>{bTeam[b.idx] ?? `P${b.idx+1}`}</div>
                            <div style={{ fontSize:10, color:"var(--txt-3)", marginTop:1 }}>{b.dismissal}</div>
                          </div>
                          <span style={{ ...colVal, color: b.runs >= 50 ? "var(--green)" : "var(--txt)" }}>{b.runs}</span>
                          <span style={colVal}>{b.balls}</span>
                          <span style={colVal}>{b.fours}</span>
                          <span style={colVal}>{b.sixes}</span>
                          <span style={{ ...colVal, fontSize:11 }}>{b.sr}</span>
                        </div>
                      ))}
                    </Card>

                    {/* Bowling */}
                    <SLabel>Bowling</SLabel>
                    <Card style={{ marginBottom:12, padding:"12px 12px 4px" }}>
                      <div style={{ display:"grid", gridTemplateColumns:"1fr 36px 28px 36px 28px 44px", gap:4, marginBottom:8, paddingBottom:6, borderBottom:"1px solid var(--bdr)" }}>
                        <span style={{ fontSize:10, color:"var(--txt-3)", fontWeight:700 }}>BOWLER</span>
                        <span style={colHdr}>O</span>
                        <span style={colHdr}>M</span>
                        <span style={colHdr}>R</span>
                        <span style={colHdr}>W</span>
                        <span style={colHdr}>ECO</span>
                      </div>
                      {bowlStats.map((b, i) => (
                        <div key={b.idx} style={{ display:"grid", gridTemplateColumns:"1fr 36px 28px 36px 28px 44px", gap:4, paddingBottom:8, marginBottom: i < bowlStats.length-1 ? 8 : 0, borderBottom: i < bowlStats.length-1 ? "1px solid var(--bdr-2)" : "none" }}>
                          <span style={{ fontSize:13, fontWeight:600 }}>{bowlTeam[b.idx] ?? `P${b.idx+1}`}</span>
                          <span style={colVal}>{b.overs}{b.remBalls > 0 ? `.${b.remBalls}` : ""}</span>
                          <span style={colVal}>{b.maidens}</span>
                          <span style={colVal}>{b.runs}</span>
                          <span style={{ ...colVal, color: b.wickets > 0 ? "var(--red)" : "var(--txt)" }}>{b.wickets}</span>
                          <span style={{ ...colVal, fontSize:11 }}>{b.eco}</span>
                        </div>
                      ))}
                    </Card>

                    {/* Extras */}
                    <SLabel>Extras</SLabel>
                    <Card style={{ marginBottom:12 }}>
                      <div style={{ display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:4 }}>
                        {([["Total",s.extras],["Wd",s.wides],["Nb",s.noBalls],["B",s.byes],["Lb",s.legByes]] as [string,number][]).map(([k,v]) => (
                          <div key={k} style={{ textAlign:"center" }}>
                            <div style={{ fontSize:10, color:"var(--txt-3)", fontWeight:700 }}>{k}</div>
                            <div style={{ fontSize:20, fontWeight:800, marginTop:2 }}>{v}</div>
                          </div>
                        ))}
                      </div>
                    </Card>
                  </>
                );
              }

              // ── Overs view ──────────────────────────────────────
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

                  {Array.from({ length: s.overs + (s.balls > 0 ? 1 : 0) }).map((_, ov) => {
                    const ovDels = innDels.filter(d => d.over===ov);
                    if (!ovDels.length) return null;
                    const ovRuns = ovDels.reduce((a,d) => a + d.runs + ((d.extra==="Wide"||d.extra==="No Ball")?1:0), 0);
                    const ovWkts = ovDels.filter(d=>d.isWicket).length;
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
                            const bName     = bTeam[d.batterIdx] ?? `P${d.batterIdx+1}`;
                            const outName   = d.batsmanOutIdx != null ? (bTeam[d.batsmanOutIdx] ?? `P${d.batsmanOutIdx+1}`) : bName;
                            const fldName   = d.fielderIdx != null ? (bPlayers2[d.fielderIdx] ?? `P${d.fielderIdx+1}`) : null;
                            const wicketDesc = d.dismissalType
                              ? `${outName} — ${d.dismissalType}${fldName ? ` (${fldName})` : ""}${d.runs ? ` +${d.runs}` : ""}`
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

        {/* ══ ABOUT ═══════════════════════════════════════════════ */}
        {tab === "About" && (
          <div style={{ padding:"16px 16px 0" }}>
            <div style={{ background:"var(--bg-card)", borderRadius:"var(--radius)", border:"1px solid var(--bdr-2)", overflow:"hidden" }}>
              <div style={{
                background:"linear-gradient(135deg,#0f4019,#1a6b2a)",
                padding:"28px 20px 22px",
                display:"flex", alignItems:"center", gap:16,
              }}>
                <div style={{ width:56, height:56, borderRadius:"50%", background:"rgba(255,255,255,0.15)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:30, flexShrink:0 }}>🏏</div>
                <div>
                  <div style={{ color:"#fff", fontSize:22, fontWeight:800, letterSpacing:"-0.3px" }}>Howzat</div>
                  <div style={{ color:"rgba(255,255,255,0.65)", fontSize:13, marginTop:3 }}>Cricket Scoring App · v1.0</div>
                </div>
              </div>
              <div style={{ padding:"16px 20px 20px", display:"flex", flexDirection:"column", gap:14 }}>
                {[
                  { icon:"👤", label:"Developer", value:"Aman Ullah Shaikh" },
                  { icon:"✉️", label:"Email",     value:"shaikhg11@hotmail.com" },
                  { icon:"📱", label:"Platform",  value:"Android · Web (PWA)" },
                  { icon:"🗄️", label:"Storage",   value:"IndexedDB (offline-first)" },
                  { icon:"☁️", label:"Sync",      value:"REST API (configurable)" },
                ].map(row => (
                  <div key={row.label} style={{ display:"flex", alignItems:"center", gap:14 }}>
                    <span style={{ fontSize:20, width:26, textAlign:"center", flexShrink:0 }}>{row.icon}</span>
                    <div style={{ flex:1 }}>
                      <div style={{ fontSize:10, color:"var(--txt-3)", fontWeight:700, textTransform:"uppercase", letterSpacing:"0.06em" }}>{row.label}</div>
                      <div style={{ fontSize:14, color:"var(--txt)", fontWeight:500, marginTop:2 }}>{row.value}</div>
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ borderTop:"1px solid var(--bdr-2)", padding:"12px 20px", fontSize:11, color:"var(--txt-3)", textAlign:"center" }}>
                Built with React · Vite · Capacitor
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Bottom Nav */}
      <BottomNav active={tab} onChange={setTab} />
    </div>
  );
}
