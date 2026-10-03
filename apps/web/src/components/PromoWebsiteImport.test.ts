import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PromoWebsiteImport } from "./PromoWebsiteImport.js";
import { generateWebsiteAd, importPromoWebsite } from "../lib/api.js";

vi.mock("../lib/api.js", () => ({ generateWebsiteAd: vi.fn(), importPromoWebsite: vi.fn() }));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
afterEach(async () => { if (root) await act(async () => root.unmount()); host?.remove(); localStorage.clear(); vi.clearAllMocks(); });
const page = { sourceUrl: "https://example.com/product", title: "Studio", description: "Tools for creators.", content: "Edit and export your own product videos using uploaded photos and footage.", fetchedAt: new Date().toISOString(), truncated: false };
const draft = { headline: "Your next promo", voiceover: "Create your next promo with Studio.", scenes: [1, 2, 3].map(() => ({ visual: "Show an actual product screenshot.", onScreenText: "Studio" })), reviewNotes: [] };
async function mount() {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  const onUseDraft = vi.fn();
  await act(async () => root.render(createElement(PromoWebsiteImport, { disabled: false, onUseDraft })));
  return onUseDraft;
}
function button(text: string) { return Array.from(host.querySelectorAll("button")).find((el) => el.textContent === text)!; }
async function click(el: HTMLElement) { await act(async () => el.click()); }

describe("website promo workflow", () => {
  it("requires review, transfers the selected duration and invalidates a draft when facts change", async () => {
    localStorage.setItem("ezav2-website-promo-brief-v1", JSON.stringify({ url: page.sourceUrl, productName: "", facts: "", audience: "Creators", callToAction: "Visit our website", duration: 15 }));
    vi.mocked(importPromoWebsite).mockResolvedValue(page);
    vi.mocked(generateWebsiteAd).mockResolvedValue(draft);
    const onUseDraft = await mount();
    await click(button("Import product page"));
    expect(host.querySelector("a")?.href).toBe(page.sourceUrl);
    expect(button("Create ad draft").disabled).toBe(true);
    await click(host.querySelector('input[type="checkbox"]')!);
    await click(button("Create ad draft"));
    expect(generateWebsiteAd).toHaveBeenCalledWith(expect.objectContaining({ sourceUrl: page.sourceUrl, duration: 15, reviewed: true, facts: expect.stringContaining(page.content) }));
    await click(button("Use draft in Promo Mode"));
    expect(onUseDraft).toHaveBeenCalledWith(draft, 15);
    const select = host.querySelector("select")!;
    await act(async () => { select.value = "60"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(button("Create ad draft").disabled).toBe(true);
    expect(button("Use draft in Promo Mode")).toBeUndefined();
    expect(JSON.parse(localStorage.getItem("ezav2-website-promo-brief-v1")!).duration).toBe(60);
  });
  it("preserves editable manual details when a website cannot be read", async () => {
    localStorage.setItem("ezav2-website-promo-brief-v1", JSON.stringify({ url: page.sourceUrl, productName: page.title, facts: page.content, audience: "", callToAction: "Learn more", duration: 30 }));
    vi.mocked(importPromoWebsite).mockRejectedValue(new Error("Website blocked the request. Paste product details instead."));
    await mount();
    await click(button("Import product page"));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Paste product details");
    expect(host.querySelector("textarea")?.value).toBe(page.content);
    expect(button("Create ad draft").disabled).toBe(true);
    await click(host.querySelector('input[type="checkbox"]')!);
    expect(button("Create ad draft").disabled).toBe(false);
  });
});
