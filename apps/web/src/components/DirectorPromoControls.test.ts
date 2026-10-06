import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DirectorPromoControls } from "./DirectorPromoControls.js";
import { importPromoWebsite } from "../lib/api.js";
vi.mock("../lib/api.js", () => ({ importPromoWebsite: vi.fn() }));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
afterEach(async () => { if (root) await act(async () => root.unmount()); host?.remove(); vi.clearAllMocks(); });
const saved = { sourceUrl: "https://example.com/product", productName: "Studio", facts: "Create music videos with generated footage edited to your own uploaded track.", audience: "Artists", casting: "One musician", callToAction: "Visit Studio", duration: 30, aspectRatio: "9:16" as const, reviewed: true as const };
async function mount(songDuration = 90) {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  const onGenerate = vi.fn();
  await act(async () => root.render(createElement(DirectorPromoControls, { songDuration, saved, busy: false, onGenerate })));
  return onGenerate;
}
function button(text: string) { return Array.from(host.querySelectorAll("button")).find((el) => el.textContent === text)!; }
async function click(el: HTMLElement) { await act(async () => el.click()); }
describe("Music Video Maker product promo controls", () => {
  it("passes the reviewed website brief and chosen duration into the director, and invalidates review on edits", async () => {
    vi.mocked(importPromoWebsite).mockResolvedValue({ sourceUrl: saved.sourceUrl, title: saved.productName, content: saved.facts, description: "", fetchedAt: new Date().toISOString(), truncated: false });
    const generate = await mount();
    await click(button("Import product website"));
    await click(button("15s"));
    expect(button("Rebuild Promo Music Video Plan").disabled).toBe(true);
    await click(host.querySelector('input[type="checkbox"]')!);
    await click(button("Rebuild Promo Music Video Plan"));
    expect(generate).toHaveBeenCalledWith({ ...saved, duration: 15 });
    await click(button("60s"));
    expect(button("Rebuild Promo Music Video Plan").disabled).toBe(true);
  });
  it("prevents a promo longer than the uploaded music", async () => {
    await mount(20);
    expect(button("30s").disabled).toBe(true);
    expect(button("60s").disabled).toBe(true);
    await click(host.querySelector('input[type="checkbox"]')!);
    expect(button("Rebuild Promo Music Video Plan").disabled).toBe(true);
    await click(button("15s"));
    await click(host.querySelector('input[type="checkbox"]')!);
    expect(button("Rebuild Promo Music Video Plan").disabled).toBe(false);
  });
});