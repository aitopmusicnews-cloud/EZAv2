import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProductionLocks, ShotLockAssignments } from "./ProductionLocks.js";
import { useStore } from "../lib/store.js";
import type { DirectorShot } from "@mvs/shared";

vi.mock("../lib/api.js", () => ({ uploadImage: vi.fn() }));
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  useStore.getState().resetProject();
  useStore.setState({ lookbook: ["https://example.com/one.png", "https://example.com/two.png"] });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
async function select(label: string, value: string) {
  const element = host.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!;
  await act(async () => { element.value = value; element.dispatchEvent(new Event("change", { bubbles: true })); });
}
describe("Production lock controls", () => {
  it("fills independent slots without duplicating a selected character into the lead slot", async () => {
    await act(async () => root.render(createElement(ProductionLocks)));
    await select("Character 3 reference", "https://example.com/two.png");
    expect(useStore.getState().productionBible?.characterLocks?.map((lock) => lock.slot)).toEqual([3]);
    await select("Character 1 reference", "https://example.com/one.png");
    expect(useStore.getState().productionBible?.characterLocks?.map((lock) => lock.slot)).toEqual([1, 3]);
    await select("Character 1 reference", "");
    expect(useStore.getState().productionBible?.characterLocks?.map((lock) => lock.slot)).toEqual([3]);
  });
  it("adds one typed asset and removes it without legacy reference resurrection", async () => {
    await act(async () => root.render(createElement(ProductionLocks)));
    await select("New asset type", "product");
    await select("New asset", "https://example.com/one.png");
    expect(useStore.getState().productionBible?.assetLocks).toHaveLength(1);
    expect(useStore.getState().productionBible?.assetLocks?.[0]?.type).toBe("product");
    const remove = [...host.querySelectorAll("button")].find((button) => button.textContent === "Remove asset")!;
    await act(async () => remove.click());
    expect(useStore.getState().productionBible?.assetLocks).toEqual([]);
  });
  it("updates a shot assignment through its checkbox", async () => {
    const shot: DirectorShot = { id: "s", clipId: "c", start: 0, end: 5, role: "intro", sectionLabel: "intro", idea: "city", camera: "pan", framing: "wide", mood: "calm", location: "street", energy: 0.5, hero: false, imageStatus: "idle", imageApproved: false, videoApproved: false, characterIds: [], assetIds: [] };
    useStore.setState({ productionBible: { characterLocks: [{ id: "lead", slot: 1, name: "Lead", referenceAssetId: "ref", locked: true }], assetLocks: [] }, directorPlan: { id: "p", version: 1, planningBasis: "professional-treatment", vision: "", treatment: { title: "a", concept: "a", style: "a", pacing: "a" }, shots: [shot] } });
    await act(async () => root.render(createElement(ShotLockAssignments, { shot })));
    const checkbox = host.querySelector<HTMLInputElement>('fieldset input[type="checkbox"]')!;
    await act(async () => checkbox.click());
    expect(useStore.getState().directorPlan?.shots[0]?.characterIds).toEqual(["lead"]);
  });
});
