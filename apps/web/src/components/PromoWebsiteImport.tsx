import { useEffect, useState } from "react";
import { getErrorMessage, PromoAdDraft, PromoWebsiteSource, type PromoAdBrief } from "@mvs/shared";
import { generateWebsiteAd, importPromoWebsite } from "../lib/api.js";

const STORAGE_KEY = "ezav2-website-promo-brief-v1";
type Fields = { url: string; productName: string; facts: string; audience: string; callToAction: string; duration: 15 | 30 | 60 };
const initial: Fields = { url: "", productName: "", facts: "", audience: "", callToAction: "Visit our website to learn more.", duration: 30 };
function savedFields(): Fields {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (!data || ![15, 30, 60].includes(data.duration)) return initial;
    if (["url", "productName", "facts", "audience", "callToAction"].some((key) => typeof data[key] !== "string")) return initial;
    return { url: data.url.slice(0, 2048), productName: data.productName.slice(0, 300), facts: data.facts.slice(0, 20000), audience: data.audience.slice(0, 500), callToAction: data.callToAction.slice(0, 500), duration: data.duration };
  } catch { return initial; }
}

export function PromoWebsiteImport({ disabled, onUseDraft }: {
  disabled: boolean;
  onUseDraft: (draft: PromoAdDraft, duration: number) => void;
}) {
  const [fields, setFields] = useState<Fields>(savedFields);
  const [source, setSource] = useState<PromoWebsiteSource | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [draft, setDraft] = useState<PromoAdDraft | null>(null);
  const [busy, setBusy] = useState<"import" | "draft" | null>(null);
  const [error, setError] = useState("");
  const [applied, setApplied] = useState(false);
  const locked = disabled || busy !== null;
  useEffect(() => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(fields)); } catch { /* Brief remains editable when browser storage is unavailable. */ } }, [fields]);
  const edit = <K extends keyof Fields>(key: K, value: Fields[K]) => {
    setFields((current) => ({ ...current, [key]: value })); setReviewed(false); setDraft(null); setApplied(false);
    if (key === "url") setSource(null);
  };
  async function importPage() {
    setBusy("import"); setSource(null); setError(""); setReviewed(false); setDraft(null); setApplied(false);
    try {
      const page = PromoWebsiteSource.parse(await importPromoWebsite(fields.url));
      setSource(page);
      setFields((current) => ({ ...current, url: page.sourceUrl, productName: page.title,
        facts: [page.description, page.content].filter(Boolean).join("\n\n").slice(0, 20000) }));
    } catch (err) { setError(getErrorMessage(err)); } finally { setBusy(null); }
  }
  async function createDraft() {
    setBusy("draft"); setError(""); setDraft(null); setApplied(false);
    try {
      const brief: PromoAdBrief = { productName: fields.productName, facts: fields.facts, audience: fields.audience,
        callToAction: fields.callToAction, duration: fields.duration, reviewed: true,
        ...(source ? { sourceUrl: source.sourceUrl } : {}) };
      setDraft(PromoAdDraft.parse(await generateWebsiteAd(brief)));
    } catch (err) { setError(getErrorMessage(err)); } finally { setBusy(null); }
  }
  return <section className="promo-website-panel" aria-label="Create promo from a website">
    <h2>Create a promo from a website</h2>
    <p>Import a public product page, review the details, then create an ad script and visual plan.</p>
    <div className="promo-website-url">
      <label className="promo-field"><span>Product-page URL</span><input type="url" maxLength={2048} value={fields.url} placeholder="https://your-product.com" disabled={locked} onChange={(event) => edit("url", event.target.value)} /></label>
      <button type="button" className="btn" disabled={locked || !fields.url.trim()} onClick={() => void importPage()}>{busy === "import" ? "Reading website…" : "Import product page"}</button>
    </div>
    {source && <p>Source: <a href={source.sourceUrl} target="_blank" rel="noreferrer">{source.sourceUrl}</a> · {new Date(source.fetchedAt).toLocaleString()}{source.truncated ? " · Page shortened; check for missing details." : ""}</p>}
    {error && <p className="promo-website-error" role="alert">{error}</p>}
    <div className="promo-website-fields">
      <label className="promo-field"><span>Product name</span><input maxLength={300} value={fields.productName} disabled={locked} onChange={(event) => edit("productName", event.target.value)} /></label>
      <label className="promo-field"><span>Audience</span><input maxLength={500} value={fields.audience} disabled={locked} placeholder="Who is this product for?" onChange={(event) => edit("audience", event.target.value)} /></label>
      <label className="promo-field promo-website-wide"><span>Product details — review or paste your own</span><textarea maxLength={20000} value={fields.facts} disabled={locked} placeholder="Features, benefits, price, limitations and what the product actually does. You can paste these if the site cannot be read." onChange={(event) => edit("facts", event.target.value)} /></label>
      <label className="promo-field"><span>Call to action</span><input maxLength={500} value={fields.callToAction} disabled={locked} onChange={(event) => edit("callToAction", event.target.value)} /></label>
      <label className="promo-field"><span>Ad length</span><select value={fields.duration} disabled={locked} onChange={(event) => edit("duration", Number(event.target.value) as Fields["duration"])}><option value={15}>15 seconds</option><option value={30}>30 seconds</option><option value={60}>60 seconds</option></select></label>
    </div>
    <label className="promo-website-review"><input type="checkbox" checked={reviewed} disabled={locked} onChange={(event) => setReviewed(event.target.checked)} /> I reviewed the product details, price and claims.</label>
    <button type="button" className="btn primary" disabled={locked || !reviewed || !fields.productName.trim() || fields.facts.trim().length < 30 || !fields.callToAction.trim()} onClick={() => void createDraft()}>{busy === "draft" ? "Writing ad draft…" : "Create ad draft"}</button>
    {draft && <div className="promo-website-draft">
      <h3>{draft.headline}</h3>
      <label className="promo-field"><span>Ad narration — review before use</span><textarea maxLength={4096} disabled={locked} value={draft.voiceover} onChange={(event) => { setDraft({ ...draft, voiceover: event.target.value }); setApplied(false); }} /></label>
      <ol>{draft.scenes.map((scene, index) => <li key={index}><strong>{(fields.duration / draft.scenes.length).toFixed(1)} seconds:</strong> {scene.visual}{scene.onScreenText && <p>Suggested text: {scene.onScreenText}</p>}</li>)}</ol>
      {draft.reviewNotes.length > 0 && <div><strong>Check before publishing</strong><ul>{draft.reviewNotes.map((note, index) => <li key={index}>{note}</li>)}</ul></div>}
      <button type="button" className="btn primary" disabled={locked || !reviewed || !draft.voiceover.trim()} onClick={() => { onUseDraft(draft, fields.duration); setApplied(true); }}>Use draft in Promo Mode</button>
      {applied && <p role="status">Narration is loaded below. Add your product images or clips, arrange the visual plan, generate voiceover, then export.</p>}
    </div>}
  </section>;
}
