import { randomUUID } from "node:crypto";
import { AGNES_IMAGE_MODEL, type TextToImageRequest } from "@mvs/shared";
import { config } from "./config.js";
import { createAgnesImage } from "./agnes_http.js";
import { saveImage } from "./images.js";
import { providerUrl, storage } from "./storage.js";

const PROVIDER_IMAGE_TTL_SECONDS = 15 * 60;

export async function generateAndSaveAgnesImage(input: TextToImageRequest) {
  if (!config.AGNES_API_KEY) throw new Error("Agnes image generation is not configured.");

  const mode = input.mode ?? "text2img";
  const rawReferences = mode === "text2img"
    ? []
    : (input.referenceImages ?? []).map((asset) => asset.url);
  const referenceImages = await Promise.all(rawReferences.map(async (rawUrl) => {
    const url = await providerUrl(rawUrl, PROVIDER_IMAGE_TTL_SECONDS);
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") throw new Error("Agnes image references must resolve to HTTPS URLs.");
    return url;
  }));

  const result = await createAgnesImage(
    {
      prompt: input.promptText,
      size: input.size,
      ...(referenceImages.length ? { referenceImages } : {}),
    },
    config.AGNES_API_KEY,
  );

  let url: string;
  if (result.kind === "url") {
    url = result.url;
  } else {
    const bytes = Buffer.from(result.data, "base64");
    if (!bytes.length) throw new Error("Agnes returned an empty image.");
    url = (await storage.saveUpload(bytes, "agnes-generated.png", "image/png")).publicUrl;
  }

  return saveImage({
    id: `img_${randomUUID().replaceAll("-", "").slice(0, 20)}`,
    name: input.promptText.slice(0, 80),
    url,
    source: mode === "compose" ? "compose" : mode === "img2img" ? "img2img" : "textToImage",
    prompt: input.promptText,
    model: AGNES_IMAGE_MODEL,
  });
}
