import { describe, expect, it, vi } from "vitest";
import { config } from "./config.js";
import { generatePromoPlan, generatePromoSpeech, promoProvider } from "./promoDirector.js";
import { checkPromoEdit, PromoSpeechRequest, type PromoDirectorRequest } from "@mvs/shared";

const input: PromoDirectorRequest = {
  brief: { product: "EZ Way Copyrights", audience: "Music creators", facts: "Downloadable evidence records, not government registration", callToAction: "Visit ezwaycopyrights.com", style: "Confident hip-hop", duration: 15 }, assets: [],
};
const plan = { concept: "Show the workflow", narration: "Keep a record of your creation. Visit EZ Way Copyrights.", voiceDirection: "Confident", continuity: "Warm studio", reviewNotes: [],
  shots: [{ title: "Demo", duration: 15, purpose: "Show evidence", visualPrompt: "Actual app recording", realFootage: true, assetIndex: -1, onScreenText: "Keep your record" }] };
const env = { ...config, OPENAI_API_KEY: "test-only", PROMO_AI_PROVIDER: "openai" as const };

describe("promo director providers", () => {
  it("uses Azure deployment names, isolated Azure credentials and the speech preview route", () => {
    const azure = { ...env, PROMO_AI_PROVIDER: "azure" as const, AZURE_OPENAI_ENDPOINT: "https://my-resource.openai.azure.com/", AZURE_OPENAI_API_KEY: "azure-test", AZURE_PROMO_DIRECTOR_DEPLOYMENT: "director", AZURE_PROMO_SPEECH_DEPLOYMENT: "narrator" };
    expect(promoProvider("plan", azure)).toEqual({ url: "https://my-resource.openai.azure.com/openai/v1/responses", model: "director", headers: { "api-key": "azure-test", "content-type": "application/json" } });
    expect(promoProvider("speech", azure).url).toBe("https://my-resource.openai.azure.com/openai/v1/audio/speech?api-version=preview");
    expect(() => promoProvider("plan", { ...azure, AZURE_OPENAI_ENDPOINT: "https://my-resource.openai.azure.com.evil.test" })).toThrow(/endpoint/);
    expect(() => promoProvider("plan", { ...azure, AZURE_OPENAI_API_KEY: undefined })).toThrow(/not configured/);
  });
  it("returns a validated timed plan and repairs an invalid duration once", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ output_text: JSON.stringify({ ...plan, shots: [{ ...plan.shots[0], duration: 9 }] }) })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ output: [{ content: [{ type: "output_text", text: JSON.stringify(plan) }] }] })));
    expect(await generatePromoPlan(input, { env, fetchImpl })).toEqual(plan);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it("stops after two invalid plans and never fabricates a fallback", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ output_text: "{}" })));
    await expect(generatePromoPlan(input, { env, fetchImpl })).rejects.toThrow(/valid timed plan/);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it("sends only the narration as speech input, with direction separate", async () => {
    const fetchImpl = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "audio/mpeg" } }));
    const speech = PromoSpeechRequest.parse({ script: "Keep your record.", voice: "marin", speed: 1, direction: "Confident", productionNotes: "Never speak this camera direction" });
    await generatePromoSpeech(speech, { env, fetchImpl });
    const body = JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.input).toBe("Keep your record.");
    expect(JSON.stringify(body)).not.toContain("camera direction");
    expect(body.instructions).toContain("Confident");
  });
  it("does not leak provider error bodies or retry a charged speech request", async () => {
    const fetchImpl = vi.fn(async () => new Response("secret credential", { status: 401 }));
    await expect(generatePromoSpeech({ script: "Hello", voice: "marin", direction: "", speed: 1 }, { env, fetchImpl })).rejects.toThrow("Promo speech failed (401)");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("promo preflight", () => {
  const scene = { url: "https://test.test/image.png", duration: 15, text: "", textIn: 0, textOut: 15, uiSafe: false, motion: "static", fit: "contain" };
  const edit = { scenes: [scene], musicVolume: 0.28, voiceVolume: 1, script: "Keep your record.", spokenScript: "Keep your record.", voiceUrl: "https://test.test/voice.mp3", voiceDuration: 12 };
  it("accepts a complete edit", () => expect(checkPromoEdit(edit).errors).toEqual([]));
  it("blocks missing visuals, stale narration and a voiceover that would be truncated", () => {
    const result = checkPromoEdit({ ...edit, scenes: [{ ...scene, url: "" }], script: "New words", voiceDuration: 20 });
    expect(result.errors.join(" ")).toMatch(/visual/);
    expect(result.errors.join(" ")).toMatch(/script changed/);
    expect(result.errors.join(" ")).toMatch(/cutting it off/);
  });
  it("blocks motion on exact app screens and invalid text timing", () => {
    const result = checkPromoEdit({ ...edit, scenes: [{ ...scene, uiSafe: true, motion: "push-in", text: "Hello", textIn: 5, textOut: 3 }] });
    expect(result.errors).toHaveLength(2);
  });
});
