import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DirectorPromoControls } from "./DirectorPromoControls.js";
import { importPromoWebsite } from "../lib/api.js";

vi.mock("../lib/api.js", () => ({ importPromoWebsite: vi.fn() }));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  host?.remove();
  vi.clearAllMocks();
});

async function mount(songDuration = 90) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const onGenerate = vi.fn();
  await act(async () => root.render(createElement(DirectorPromoControls, { songDuration, busy: false, onGenerate })));
  return onGenerate;
}

function button(text: string) {
  return Array.from(host.querySelectorAll("button")).find((el) => el.textContent === text)!;
}
async function click(el: HTMLElement) {
  await act(async () => el.click());
}

describe("Director promo controls", () => {
  it("builds a music video promo with only duration and platform data", async () => {
    const generate = await mount();
    expect(host.textContent).toContain("No product information is needed");
    await click(button("15s"));
    await click(button("Build Music Video Promo Plan"));
    expect(generate).toHaveBeenCalledWith({
      kind: "music",
      duration: 15,
      aspectRatio: "9:16",
      reviewed: true,
    });
  });

  it("keeps product marketing fields in the separate product promo flow", async () => {
    vi.mocked(importPromoWebsite).mockResolvedValue({
      sourceUrl: "https://example.com/product",
      title: "Studio",
      content: "Create music videos with generated footage edited to your own uploaded track.",
      description: "",
      fetchedAt: new Date().toISOString(),
      truncated: false,
    });
    const generate = await mount();
    const url = host.querySelector('input[type="url"]') as HTMLInputElement;
    await act(async () => {
      url.value = "https://example.com/product";
      url.dispatchEvent(new Event("input", { bubbles: true }));
      url.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await click(button("Import product website"));
    const productDetails = Array.from(host.querySelectorAll("details")).find((el) => el.textContent?.includes("Product Promo"))!;
    await click(productDetails.querySelector('input[type="checkbox"]')!);
    await click(button("Build Product Promo Plan"));
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({
      kind: "product",
      productName: "Studio",
      sourceUrl: "https://example.com/product",
    }));
  });

  it("prevents promo lengths longer than the uploaded music", async () => {
    await mount(20);
    const musicDetails = Array.from(host.querySelectorAll("details")).find((el) => el.textContent?.includes("Music Video Promo"))!;
    const buttons = Array.from(musicDetails.querySelectorAll("button"));
    expect(buttons.find((el) => el.textContent === "30s")?.disabled).toBe(true);
    expect(buttons.find((el) => el.textContent === "60s")?.disabled).toBe(true);
  });
});
