import { useEffect, useState } from "react";
import { PromoBrief, PromoBriefDraft, PromoDirectorPlan, getErrorMessage } from "@mvs/shared";
import { planPromo } from "../lib/api.js";

const DEFAULT: PromoBrief = { product: "", audience: "", facts: "", callToAction: "", style: "Confident, cinematic, artist-focused", duration: 30 };
const KEY = "ezav2-promo-director-v1";
function restore(): { brief: PromoBrief; plan: PromoDirectorPlan | null; assetSignature: string; plannedDuration: number } {
  try {
    const data = JSON.parse(localStorage.getItem(KEY) ?? "null");
    return { brief: PromoBriefDraft.safeParse(data?.brief).data ?? DEFAULT, plan: PromoDirectorPlan.safeParse(data?.plan).data ?? null, assetSignature: typeof data?.assetSignature === "string" ? data.assetSignature : "", plannedDuration: [15,30,60].includes(data?.plannedDuration) ? data.plannedDuration : 30 };
  } catch { return { brief: DEFAULT, plan: null, assetSignature: "", plannedDuration: 30 }; }
}

export function PromoDirectorPanel({ assets, disabled, onApply }: {
  assets: Array<{ id: string; url: string; name: string; kind: "image" | "video" }>;
  disabled: boolean;
  onApply: (plan: PromoDirectorPlan, duration: number) => void;
}) {
  const [initial] = useState(restore);
  const [brief, setBrief] = useState(initial.brief);
  const [plan, setPlan] = useState<PromoDirectorPlan | null>(initial.plan);
  const [assetSignature, setAssetSignature] = useState(initial.assetSignature);
  const [plannedDuration, setPlannedDuration] = useState(initial.plannedDuration);
  const [revision, setRevision] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify({ brief, plan, assetSignature, plannedDuration })); } catch { setError("Could not save the director draft in this browser."); } }, [brief, plan, assetSignature, plannedDuration]);
  async function direct() {
    setBusy(true); setError(null);
    try {
      const next = await planPromo({ brief, assets, ...(plan ? { previousPlan: plan, revision } : {}) });
      setPlan(next); setRevision(""); setAssetSignature(JSON.stringify(assets)); setPlannedDuration(brief.duration);
    } catch (e) { setError(getErrorMessage(e)); } finally { setBusy(false); }
  }
  return <details className="promo-director" open>
    <summary><strong>AI Promo Director</strong><span>Brief → plan → voice → review</span></summary>
    <fieldset disabled={busy || disabled}>
      <div className="promo-director-fields">
        <label className="promo-field"><span>Product / artist</span><input value={brief.product} maxLength={200} onChange={(e) => setBrief({ ...brief, product: e.target.value })} /></label>
        <label className="promo-field"><span>Audience</span><input value={brief.audience} maxLength={500} onChange={(e) => setBrief({ ...brief, audience: e.target.value })} /></label>
        <label className="promo-field"><span>Verified facts and benefits</span><textarea value={brief.facts} maxLength={6000} placeholder="What does it do? Include only claims you can support." onChange={(e) => setBrief({ ...brief, facts: e.target.value })} /></label>
        <label className="promo-field"><span>Call to action / website</span><input value={brief.callToAction} maxLength={500} onChange={(e) => setBrief({ ...brief, callToAction: e.target.value })} /></label>
        <label className="promo-field"><span>Genre, tone and creative direction</span><input value={brief.style} maxLength={300} onChange={(e) => setBrief({ ...brief, style: e.target.value })} /></label>
        <label className="promo-field"><span>Length</span><select value={brief.duration} onChange={(e) => setBrief({ ...brief, duration: Number(e.target.value) as 15 | 30 | 60 })}>{[15, 30, 60].map((n) => <option key={n} value={n}>{n} seconds</option>)}</select></label>
      </div>
      {plan && <label className="promo-field"><span>Tell the director what to change</span><input value={revision} maxLength={2000} placeholder="Stronger hook, less text, more product demonstration…" onChange={(e) => setRevision(e.target.value)} /></label>}
      <button className="btn primary" onClick={() => void direct()}>{busy ? "Directing promo…" : plan ? "Revise plan" : "Create promo plan"}</button>
      {plan && <div className="promo-director-plan">
        <p>{plan.concept}</p>
        <label className="promo-field"><span>Spoken script — edit before approving</span><textarea value={plan.narration} maxLength={4000} onChange={(e) => setPlan({ ...plan, narration: e.target.value })} /></label>
        <p className="promo-muted">Continuity: {plan.continuity}</p>
        {plan.shots.map((s, i) => <article key={i}><strong>{i + 1}. {s.title} · {s.duration}s</strong><p>{s.purpose}</p><p>{s.visualPrompt}</p><small>{s.realFootage ? "Real footage required" : "Upload or generate image"}{s.assetIndex >= 0 ? ` · suggested asset ${s.assetIndex + 1}` : " · visual needed"}</small></article>)}
        {plan.reviewNotes.map((note, i) => <p className="promo-muted" key={i}>{note}</p>)}
        <p className="promo-muted">Review facts and suggested asset matches. Approving replaces the current scene arrangement. Uploaded media remains stored.</p>
        <button className="btn primary" disabled={!plan.narration.trim()} onClick={() => { if (assetSignature !== JSON.stringify(assets)) { setError("The scene assets changed. Revise the plan to refresh its asset matches before applying."); return; } onApply(plan, plannedDuration); }}>Approve plan and arrange scenes</button>
      </div>}
    </fieldset>
    {error && <p className="promo-error" role="alert">{error}</p>}
  </details>;
}
