import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PromoWorkspace } from "./PromoWorkspace.js";
import { speakPromo, submitPromoRender } from "../lib/api.js";

vi.mock("../lib/api.js", () => ({
  planPromo: vi.fn(), generateTextToImage: vi.fn(), uploadAudioAsset: vi.fn(), uploadImage: vi.fn(), uploadVideo: vi.fn(),
  getPromoRenderJob: vi.fn(), submitPromoRender: vi.fn(),
  speakPromo: vi.fn(async () => ({ url: "https://test.test/voice.mp3", duration: 20 })),
}));
afterEach(() => { localStorage.clear(); vi.clearAllMocks(); });

describe("Promo Director editor integration", () => {
  it("applies an approved plan, isolates spoken copy and blocks an incomplete export", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.setItem("ezav2-promo-director-v1", JSON.stringify({
      brief: { product: "EZ", audience: "Artists", facts: "Evidence records", callToAction: "Visit the site", style: "Bold", duration: 15 },
      plan: { concept: "Show the product", narration: "Keep a record of your work.", voiceDirection: "Confident", continuity: "Copper studio", reviewNotes: [],
        shots: [{ title: "Product demo", duration: 15, purpose: "Show the app", visualPrompt: "Never speak these camera notes", realFootage: true, assetIndex: -1, onScreenText: "Keep your record" }] },
      assetSignature: "[]", plannedDuration: 15,
    }));
    const container = document.createElement("div"); document.body.append(container);
    const root = createRoot(container);
    const click = async (label: string) => {
      const button = [...container.querySelectorAll("button")].find((b) => b.textContent === label);
      expect(button).toBeTruthy();
      await act(async () => { button!.click(); });
    };
    try {
      await act(async () => root.render(createElement(PromoWorkspace)));
      await click("Approve plan and arrange scenes");
      expect(container.textContent).toContain("Visual needed");
      expect(container.querySelector<HTMLButtonElement>(".promo-inspector button.btn:not(.primary)" )).toBeTruthy();
      const imageButton = [...container.querySelectorAll("button")].find((b) => b.textContent === "Generate image");
      expect(imageButton?.disabled).toBe(true);
      await click("Generate voiceover");
      expect(speakPromo).toHaveBeenCalledWith({ script: "Keep a record of your work.", voice: "marin", speed: 1, direction: "Confident" });
      expect(container.textContent).toContain("Voiceover is 20.0s");
      await click("Export Promo MP4");
      expect(submitPromoRender).not.toHaveBeenCalled();
      const saved = JSON.parse(localStorage.getItem("ezav2-promo-edit-v1")!);
      expect(saved.scenes[0].uiSafe).toBe(true);
      expect(saved.scenes[0].motion).toBe("static");
      expect(saved.voice.duration).toBe(20);
    } finally {
      await act(async () => root.unmount()); container.remove();
      (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
    }
  });
});
