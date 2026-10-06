import { useState } from "react";
import {
  DirectorMusicPromoBrief,
  DirectorProductPromoBrief,
  PromoWebsiteSource,
  getErrorMessage,
  type DirectorPromoBrief,
} from "@mvs/shared";
import { importPromoWebsite } from "../lib/api.js";

type AspectRatio = DirectorPromoBrief["aspectRatio"];

function PlatformAndLength({
  aspectRatio,
  duration,
  songDuration,
  locked,
  onAspectRatio,
  onDuration,
}: {
  aspectRatio: AspectRatio;
  duration: number;
  songDuration: number;
  locked: boolean;
  onAspectRatio: (value: AspectRatio) => void;
  onDuration: (value: number) => void;
}) {
  return <>
    <label>Platform / video size
      <select value={aspectRatio} disabled={locked} onChange={(event) => onAspectRatio(event.target.value as AspectRatio)}>
        <option value="9:16">Vertical 9:16 · TikTok / Reels / Shorts · 720×1280</option>
        <option value="4:5">Portrait 4:5 · Instagram / Facebook feed · 720×900</option>
        <option value="1:1">Square 1:1 · Instagram / Facebook feed · 720×720</option>
        <option value="16:9">Landscape 16:9 · YouTube / web · 1280×720</option>
      </select>
    </label>
    <label>Promo length in seconds
      <input type="number" min={5} max={Math.min(120, songDuration)} step={1} value={duration} disabled={locked} onChange={(event) => onDuration(Number(event.target.value))} />
    </label>
    <div className="director-action-row">
      {[15, 30, 60].map((seconds) => (
        <button key={seconds} type="button" className="btn" disabled={locked || seconds > songDuration} onClick={() => onDuration(seconds)}>{seconds}s</button>
      ))}
    </div>
    <p>Uses the first {duration || 0} seconds of your uploaded music. Custom length: 5–{Math.min(120, Math.floor(songDuration))} seconds.</p>
  </>;
}

export function DirectorPromoControls({ songDuration, saved, busy, onGenerate }: {
  songDuration: number;
  saved?: DirectorPromoBrief;
  busy: boolean;
  onGenerate: (brief: DirectorPromoBrief) => void;
}) {
  const savedMusic = saved?.kind === "music" ? saved : undefined;
  const savedProduct = saved?.kind === "product" ? saved : undefined;

  const [musicDuration, setMusicDuration] = useState(savedMusic?.duration ?? Math.min(30, songDuration));
  const [musicAspectRatio, setMusicAspectRatio] = useState<AspectRatio>(savedMusic?.aspectRatio ?? "9:16");

  const [url, setUrl] = useState(savedProduct?.sourceUrl ?? "");
  const [sourceUrl, setSourceUrl] = useState(savedProduct?.sourceUrl);
  const [productName, setProductName] = useState(savedProduct?.productName ?? "");
  const [facts, setFacts] = useState(savedProduct?.facts ?? "");
  const [audience, setAudience] = useState(savedProduct?.audience ?? "");
  const [casting, setCasting] = useState(savedProduct?.casting ?? "");
  const [callToAction, setCallToAction] = useState(savedProduct?.callToAction ?? "Visit our website to learn more.");
  const [productDuration, setProductDuration] = useState(savedProduct?.duration ?? Math.min(30, songDuration));
  const [productAspectRatio, setProductAspectRatio] = useState<AspectRatio>(savedProduct?.aspectRatio ?? "9:16");
  const [productReviewed, setProductReviewed] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState("");

  const locked = busy || reading;
  const musicBrief = DirectorMusicPromoBrief.safeParse({
    kind: "music",
    duration: musicDuration,
    aspectRatio: musicAspectRatio,
    reviewed: true,
  });
  const productBrief = DirectorProductPromoBrief.safeParse({
    kind: "product",
    sourceUrl,
    productName,
    facts,
    audience,
    casting,
    callToAction,
    duration: productDuration,
    aspectRatio: productAspectRatio,
    reviewed: productReviewed,
  });

  const productChanged = () => {
    setProductReviewed(false);
    setError("");
  };

  async function readWebsite() {
    setReading(true);
    setProductReviewed(false);
    setError("");
    setSourceUrl(undefined);
    try {
      const source = PromoWebsiteSource.parse(await importPromoWebsite(url));
      setSourceUrl(source.sourceUrl);
      setUrl(source.sourceUrl);
      setProductName(source.title);
      setFacts([source.description, source.content].filter(Boolean).join("\n\n").slice(0, 20000));
      if (source.truncated) setError("Page shortened. Check that prices and qualifications are included below.");
    } catch (error) {
      setError(getErrorMessage(error));
    } finally {
      setReading(false);
    }
  }

  return <div className="director-promo-options">
    <details className="director-panel director-music-promo" open={savedMusic ? true : undefined}>
      <summary><strong>Create a Music Video Promo</strong></summary>
      <p>No product information is needed. The Director uses the approved song understanding, your Director vision, selected style, Character/Asset Locks, and the music to build a shorter promotional music video.</p>
      <fieldset disabled={busy}>
        <PlatformAndLength
          aspectRatio={musicAspectRatio}
          duration={musicDuration}
          songDuration={songDuration}
          locked={busy}
          onAspectRatio={setMusicAspectRatio}
          onDuration={setMusicDuration}
        />
        <button
          type="button"
          className="director-primary"
          disabled={busy || !musicBrief.success || musicDuration > songDuration}
          onClick={() => { if (musicBrief.success) onGenerate(musicBrief.data); }}
        >
          {busy ? "Building Treatment…" : savedMusic ? "Rebuild Music Video Promo Plan" : "Build Music Video Promo Plan"}
        </button>
        <p>This creates generated moving footage cut to your song. It does not require a website, product description, audience field, or call to action.</p>
      </fieldset>
    </details>

    <details className="director-panel director-product-promo" open={savedProduct ? true : undefined}>
      <summary><strong>Create a Product Promo Video</strong></summary>
      <p>Use this only when the video is promoting a product, service, app, website, or business and the Director needs factual marketing information.</p>
      <fieldset disabled={locked}>
        <label>Product website<input type="url" value={url} maxLength={2048} placeholder="https://your-product.com" onChange={(event) => { setUrl(event.target.value); setSourceUrl(undefined); productChanged(); }} /></label>
        <button type="button" className="btn" disabled={locked || !url.trim()} onClick={() => void readWebsite()}>{reading ? "Reading website…" : "Import product website"}</button>
        {sourceUrl && <p>Imported from <a href={sourceUrl} target="_blank" rel="noreferrer">{sourceUrl}</a></p>}
        <label>Product name<input value={productName} maxLength={300} onChange={(event) => { setProductName(event.target.value); productChanged(); }} /></label>
        <label>Product facts and qualifications<textarea value={facts} maxLength={20000} rows={7} placeholder="Review imported details, or paste product information here." onChange={(event) => { setFacts(event.target.value); productChanged(); }} /></label>
        <label>Audience<input value={audience} maxLength={500} onChange={(event) => { setAudience(event.target.value); productChanged(); }} /></label>
        <label>Casting and character direction<textarea value={casting} maxLength={1000} rows={2} placeholder="Describe the people you want, or request product-only footage. Use character references for identity consistency." onChange={(event) => { setCasting(event.target.value); productChanged(); }} /></label>
        <label>Call to action<input value={callToAction} maxLength={500} onChange={(event) => { setCallToAction(event.target.value); productChanged(); }} /></label>
        <PlatformAndLength
          aspectRatio={productAspectRatio}
          duration={productDuration}
          songDuration={songDuration}
          locked={locked}
          onAspectRatio={(value) => { setProductAspectRatio(value); productChanged(); }}
          onDuration={(value) => { setProductDuration(value); productChanged(); }}
        />
        <label className="director-product-review"><input type="checkbox" checked={productReviewed} onChange={(event) => setProductReviewed(event.target.checked)} /> I reviewed the product claims, casting, promo length, and platform size.</label>
        <button
          type="button"
          className="director-primary"
          disabled={locked || !productBrief.success || productDuration > songDuration}
          onClick={() => { if (productBrief.success) onGenerate(productBrief.data); }}
        >
          {busy ? "Building Treatment…" : savedProduct ? "Rebuild Product Promo Plan" : "Build Product Promo Plan"}
        </button>
      </fieldset>
      {error && <p role="alert">{error}</p>}
    </details>
  </div>;
}
