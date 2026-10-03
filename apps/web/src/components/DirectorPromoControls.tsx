import { useState } from "react";
import { DirectorPromoBrief, PromoWebsiteSource, getErrorMessage } from "@mvs/shared";
import { importPromoWebsite } from "../lib/api.js";

export function DirectorPromoControls({ songDuration, saved, busy, onGenerate }: {
  songDuration: number;
  saved?: DirectorPromoBrief;
  busy: boolean;
  onGenerate: (brief: DirectorPromoBrief) => void;
}) {
  const [url, setUrl] = useState(saved?.sourceUrl ?? "");
  const [sourceUrl, setSourceUrl] = useState(saved?.sourceUrl);
  const [productName, setProductName] = useState(saved?.productName ?? "");
  const [facts, setFacts] = useState(saved?.facts ?? "");
  const [audience, setAudience] = useState(saved?.audience ?? "");
  const [casting, setCasting] = useState(saved?.casting ?? "");
  const [callToAction, setCallToAction] = useState(saved?.callToAction ?? "Visit our website to learn more.");
  const [duration, setDuration] = useState(saved?.duration ?? Math.min(30, songDuration));
  const [reviewed, setReviewed] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState("");
  const locked = busy || reading;
  const brief = DirectorPromoBrief.safeParse({ sourceUrl, productName, facts, audience, casting, callToAction, duration, reviewed });
  const changed = () => { setReviewed(false); setError(""); };
  async function readWebsite() {
    setReading(true); setReviewed(false); setError(""); setSourceUrl(undefined);
    try {
      const source = PromoWebsiteSource.parse(await importPromoWebsite(url));
      setSourceUrl(source.sourceUrl); setUrl(source.sourceUrl); setProductName(source.title);
      setFacts([source.description, source.content].filter(Boolean).join("\n\n").slice(0, 20000));
      if (source.truncated) setError("Page shortened. Check that prices and qualifications are included below.");
    } catch (error) { setError(getErrorMessage(error)); }
    finally { setReading(false); }
  }
  return <details className="director-panel director-product-promo" open={saved ? true : undefined}>
    <summary><strong>Create a product promo music video</strong></summary>
    <p>Use website details to direct generated moving footage, edited to your music. Review the shot plan, storyboard images and video takes before the final export.</p>
    <fieldset disabled={locked}>
      <label>Product website<input type="url" value={url} maxLength={2048} placeholder="https://your-product.com" onChange={(event) => { setUrl(event.target.value); setSourceUrl(undefined); changed(); }} /></label>
      <button type="button" className="btn" disabled={locked || !url.trim()} onClick={() => void readWebsite()}>{reading ? "Reading website…" : "Import product website"}</button>
      {sourceUrl && <p>Imported from <a href={sourceUrl} target="_blank" rel="noreferrer">{sourceUrl}</a></p>}
      <label>Product name<input value={productName} maxLength={300} onChange={(event) => { setProductName(event.target.value); changed(); }} /></label>
      <label>Product facts and qualifications<textarea value={facts} maxLength={20000} rows={7} placeholder="Review imported details, or paste product information here." onChange={(event) => { setFacts(event.target.value); changed(); }} /></label>
      <label>Audience<input value={audience} maxLength={500} onChange={(event) => { setAudience(event.target.value); changed(); }} /></label>
      <label>Casting and character direction<textarea value={casting} maxLength={1000} rows={2} placeholder="Describe the people you want, or request product-only footage. Use character references for identity consistency." onChange={(event) => { setCasting(event.target.value); changed(); }} /></label>
      <label>Call to action<input value={callToAction} maxLength={500} onChange={(event) => { setCallToAction(event.target.value); changed(); }} /></label>
      <label>Promo length in seconds<input type="number" min={5} max={Math.min(120, songDuration)} step={1} value={duration} onChange={(event) => { setDuration(Number(event.target.value)); changed(); }} /></label>
      <div className="director-action-row">{[15, 30, 60].map((seconds) => <button key={seconds} type="button" className="btn" disabled={locked || seconds > songDuration} onClick={() => { setDuration(seconds); changed(); }}>{seconds}s</button>)}</div>
      <p>Uses the first {duration || 0} seconds of your uploaded music. Custom length: 5–{Math.min(120, Math.floor(songDuration))} seconds. The final player will show this version after rendering.</p>
      <label className="director-product-review"><input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} /> I reviewed the product claims, casting and promo length.</label>
      <button type="button" className="director-primary" disabled={locked || !brief.success || duration > songDuration} onClick={() => { if (brief.success) onGenerate(brief.data); }}>{busy ? "Building Treatment…" : saved ? "Rebuild Promo Music Video Plan" : "Build Promo Music Video Plan"}</button>
      <p>Building a new plan replaces the current plan and takes. Your original music remains loaded. This creates a music-led promo; no voiceover is added.</p>
    </fieldset>
    {error && <p role="alert">{error}</p>}
  </details>;
}
