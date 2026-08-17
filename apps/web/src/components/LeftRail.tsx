import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "../lib/store.js";
import { saveImageToLibrary } from "../lib/api.js";
import { downloadFromUrl } from "../lib/download.js";
import { AssetUploader } from "./AssetUploader.js";

const LOOKBOOK_MAX = 16;

export function LeftRail() {
  const character = useStore((s) => s.characterImageUrl);
  const setCharacter = useStore((s) => s.setCharacter);
  const lookbook = useStore((s) => s.lookbook);
  const addLookbook = useStore((s) => s.addLookbook);
  const removeLookbook = useStore((s) => s.removeLookbook);
  const replaceLookbookUrl = useStore((s) => s.replaceLookbookUrl);
  const analysis = useStore((s) => s.analysis);

  const [lookbookStatus, setLookbookStatus] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const onCharacterUploaded = useCallback((url: string) => {
    setCharacter(url);
  }, [setCharacter]);

  return (
    <aside className="left">
      <div className="section">
        <div className="section-header">
          <span className="label">Character</span>
          {character && (
            <button type="button" className="add" onClick={() => setCharacter(null)}>clear</button>
          )}
        </div>

        <AssetUploader className="cast-card" onUploaded={onCharacterUploaded}>
          <div className="thumb-wrap">
            {character ? (
              <img
                src={character}
                className="thumb"
                alt="Character reference"
                onClick={(e) => {
                  e.stopPropagation();
                  setPreviewUrl(character);
                }}
                style={{ cursor: "pointer" }}
              />
            ) : (
              <div className="thumb placeholder" />
            )}
          </div>
          <div className="cast-info">
            <div className="cast-name">{character ? "Reference ready" : "Drop or click"}</div>
            <div className="cast-role">
              {character
                ? "Used as an Agnes image/keyframe reference"
                : "image · performer / character reference"}
            </div>
          </div>
        </AssetUploader>
      </div>

      <div className="section">
        <div className="section-header">
          <span className="label">Lookbook</span>
          <span className="dim" style={{ fontSize: 11 }}>
            {lookbook.length}/{LOOKBOOK_MAX}
          </span>
        </div>
        <div className="lookbook">
          {lookbook.map((url) => (
            <div
              key={url}
              className="tile filled"
              style={{ backgroundImage: `url(${url})`, cursor: "pointer" }}
              onClick={() => setPreviewUrl(url)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === "Enter") setPreviewUrl(url); }}
            >
              <button
                type="button"
                className="tile-download"
                onClick={(e) => {
                  e.stopPropagation();
                  void downloadFromUrl(url, url.split("/").pop()?.split("?")[0] || "image.png");
                }}
                title="download"
                aria-label="download tile"
              >
                ↓
              </button>
              <button
                type="button"
                className="tile-remove"
                onClick={(e) => {
                  e.stopPropagation();
                  removeLookbook(url);
                }}
                title="remove"
                aria-label="remove tile"
              >
                ×
              </button>
            </div>
          ))}
          {lookbook.length < LOOKBOOK_MAX && (
            <AssetUploader
              className="tile add"
              onUploaded={(url) => {
                addLookbook(url);
                const fname = url.split("/").pop()?.split("?")[0] || "image";
                void saveImageToLibrary({
                  id: `img-${crypto.randomUUID().slice(0, 8)}`,
                  name: fname,
                  url,
                  source: "uploaded",
                  prompt: null,
                  model: null,
                })
                  .then((saved) => {
                    if (saved.url !== url) replaceLookbookUrl(url, saved.url);
                  })
                  .catch((err) => console.warn("save uploaded image to library failed", err));
              }}
              onStatus={setLookbookStatus}
            >
              <span className="tile-add-label">{lookbookStatus ?? "+"}</span>
            </AssetUploader>
          )}
          {Array.from({ length: Math.max(0, 3 - lookbook.length - 1) }).map((_, i) => (
            <div key={`ph-${i}`} className="tile placeholder" />
          ))}
        </div>
      </div>

      {analysis && (
        <div className="section">
          <div className="section-header">
            <span className="label">Audio analysis</span>
          </div>
          <div className="context-card">
            <div className="row"><span>Sections</span><span>{analysis.sections.length}</span></div>
            <div className="row"><span>BPM</span><span>{analysis.bpm.toFixed(1)}</span></div>
            <div className="row"><span>Key</span><span>{analysis.key}</span></div>
            <div className="row"><span>Beats</span><span>{analysis.beats.length}</span></div>
          </div>
        </div>
      )}

      {previewUrl && (
        <ImageLightbox url={previewUrl} onClose={() => setPreviewUrl(null)} />
      )}
    </aside>
  );
}

function ImageLightbox({ url, onClose }: { url: string; onClose: () => void }) {
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      ref={overlayRef}
      className="lightbox-overlay"
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
    >
      <img src={url} className="lightbox-img" alt="" />
      <button type="button" className="lightbox-close" onClick={onClose} aria-label="close">
        ×
      </button>
    </div>
  );
}
