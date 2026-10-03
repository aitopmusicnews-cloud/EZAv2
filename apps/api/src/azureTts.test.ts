import { describe, expect, it } from "vitest";
import { resolveAzureTtsApiKey } from "./azureTts.js";

describe("resolveAzureTtsApiKey", () => {
  it("prefers a dedicated TTS key when present", () => {
    expect(resolveAzureTtsApiKey("tts-key", "main-key")).toBe("tts-key");
  });

  it("reuses the Azure main resource key when no dedicated TTS key is set", () => {
    expect(resolveAzureTtsApiKey(undefined, "main-key")).toBe("main-key");
  });

  it("returns empty when neither Azure resource key is configured", () => {
    expect(resolveAzureTtsApiKey(undefined, undefined)).toBe("");
  });
});
