import { randomUUID } from "node:crypto";
import { AGNES_IMAGE_MODEL, type TextToImageRequest } from "@mvs/shared";
import { config } from "./config.js";
import { createAgnesImage } from "./agnes_http.js";
import { saveImage } from "./images.js";
import { storage } from "./storage.js";

export async function generateAndSaveAgnesImage(input: TextToImageRequest) {
  if (!config.AGNES_API_KEY) throw new Error("Agnes image generation is not configured.");

  const mode = input.mode ?? "text2img";
  const referenceImages = mode === "text2img"
    ? []
    : (input.referenceImages ?? []).map((asset) => asset.url);

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
