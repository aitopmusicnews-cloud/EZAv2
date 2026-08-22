import type { ProductionBible, ReferenceAsset, SpatialLock } from "@mvs/shared";

export type PromptCompileInput = {
  scenePrompt?: string;
  productionBible?: ProductionBible | null;
  spatialLock?: SpatialLock | null;
  referenceAssets?: ReferenceAsset[];
  negativePrompt?: string;
};

function spatialLines(lock?: SpatialLock | null): string[] {
  if (!lock) return [];
  const lines: string[] = [];

  if (lock.trafficSystem === "US_RIGHT_HAND") lines.push("Use normal U.S. right-hand traffic flow.");
  if (lock.trafficSystem === "UK_LEFT_HAND") lines.push("Use normal left-hand traffic flow.");
  if (lock.driveSide === "LEFT_HAND_DRIVE") lines.push("United States left-hand-drive vehicle; the steering wheel is on the LEFT.");
  if (lock.driveSide === "RIGHT_HAND_DRIVE") lines.push("Right-hand-drive vehicle; the steering wheel is on the RIGHT.");
  if (lock.driverSeat === "FRONT_LEFT") lines.push("The protagonist is seated in the LEFT FRONT DRIVER'S SEAT.");
  if (lock.driverSeat === "FRONT_RIGHT") lines.push("The protagonist is seated in the RIGHT FRONT DRIVER'S SEAT.");
  if (lock.passengerSeat === "FRONT_RIGHT") lines.push("The RIGHT FRONT PASSENGER seat is empty unless the scene explicitly says otherwise.");
  if (lock.passengerSeat === "FRONT_LEFT") lines.push("The LEFT FRONT PASSENGER seat is empty unless the scene explicitly says otherwise.");
  if (lock.cameraPosition === "FRONT_PASSENGER_INTERIOR") lines.push("The camera is positioned inside the right front passenger area.");
  if (lock.cameraPosition === "FRONT_DRIVER_INTERIOR") lines.push("The camera is positioned inside the front driver area without changing the driver's physical seat.");
  if (lock.cameraPosition === "CENTER_DASH_INTERIOR") lines.push("The camera is positioned near the center dashboard inside the cabin.");
  if (lock.cameraPosition === "DRIVER_SIDE_EXTERIOR") lines.push("The camera is outside the vehicle on the driver's side.");
  if (lock.cameraPosition === "PASSENGER_SIDE_EXTERIOR") lines.push("The camera is outside the vehicle on the passenger side.");
  if (lock.cameraPosition === "FRONT_EXTERIOR") lines.push("The camera is outside and ahead of the vehicle, looking back toward it while moving in the same direction.");
  if (lock.cameraPosition === "REAR_EXTERIOR") lines.push("The camera is outside and behind the vehicle, looking forward in the same direction of travel.");
  if (lock.cameraPosition === "AERIAL") lines.push("The camera is high above the roadway in an aerial perspective.");
  if (lock.cameraDirection === "TOWARD_DRIVER_AND_CENTER_MIRROR") lines.push("The camera looks diagonally toward the driver and the center rearview mirror.");
  if (lock.cameraDirection === "FORWARD") lines.push("The camera looks forward in the vehicle's direction of travel.");
  if (lock.cameraDirection === "BACKWARD") lines.push("The camera looks backward toward the roadway behind the vehicle.");
  if (lock.cameraDirection === "TOWARD_DRIVER") lines.push("The camera is aimed toward the driver.");
  if (lock.cameraDirection === "TOWARD_VEHICLE") lines.push("The camera is aimed toward the vehicle as the main subject.");
  if (lock.vehicleDirection === "FORWARD") lines.push("The vehicle travels FORWARD.");
  if (lock.vehicleDirection === "REVERSE") lines.push("The vehicle travels in REVERSE.");
  if (lock.vehicleDirection === "STATIONARY") lines.push("The vehicle is completely STATIONARY.");
  if (lock.competitorPosition === "BEHIND") lines.push("The competitors are BEHIND the protagonist.");
  if (lock.competitorPosition === "AHEAD") lines.push("The competitors are AHEAD of the protagonist.");
  if (lock.competitorPosition === "ADJACENT") lines.push("The competitors are in adjacent lanes beside the protagonist.");
  if (lock.competitorPosition === "NONE") lines.push("No competitor vehicles are present.");
  if (lock.competitorDirection === "SAME_DIRECTION") lines.push("Competitor vehicles travel in the SAME direction as the protagonist.");
  if (lock.competitorDirection === "ONCOMING") lines.push("Competitor vehicles travel toward the protagonist as oncoming traffic.");
  if (lock.rearviewMirrorShows === "ROAD_BEHIND_AND_COMPETITORS") {
    lines.push("The center rearview mirror reflects the roadway BEHIND the protagonist and the competitors following from behind.");
  }
  if (lock.rearviewMirrorShows === "ROAD_BEHIND") lines.push("The center rearview mirror reflects the roadway BEHIND the protagonist.");
  if (lock.rearviewMirrorShows === "EMPTY_ROAD_BEHIND") lines.push("The center rearview mirror reflects only empty roadway BEHIND the protagonist.");
  if (lock.windshieldShows === "OPEN_ROAD_AHEAD") lines.push("The front windshield shows open road ahead.");
  if (lock.windshieldShows === "ROAD_AHEAD_WITH_TRAFFIC") lines.push("The front windshield shows roadway and traffic ahead.");
  if (lock.allowOncomingTraffic === false) lines.push("No oncoming traffic.");
  if (lock.allowOncomingTraffic === true) lines.push("Oncoming traffic may appear only where normal road geometry allows it.");

  return lines;
}

function lockedRefs(referenceAssets: ReferenceAsset[] | undefined, role: ReferenceAsset["role"]): ReferenceAsset[] {
  return (referenceAssets ?? []).filter((asset) => asset.role === role && asset.locked !== false);
}

function compileCore(input: PromptCompileInput): string {
  const sections: string[] = [];
  const spatial = spatialLines(input.spatialLock ?? input.productionBible?.defaultSpatialLock);
  if (spatial.length) sections.push(`[HARD SPATIAL CONSTRAINTS]\n${spatial.join(" ")}`);

  const characterRefs = lockedRefs(input.referenceAssets, "character");
  const characterText = [
    characterRefs.length ? "Match the locked character reference image(s) exactly; treat them as identity references, not general inspiration." : "",
    input.productionBible?.characterProfile ?? "",
  ].filter(Boolean).join(" ");
  if (characterText) sections.push(`[CHARACTER LOCK]\n${characterText}`);

  const vehicleRefs = lockedRefs(input.referenceAssets, "vehicle");
  const vehicleText = [
    vehicleRefs.length ? "Match the locked vehicle reference image(s) exactly; preserve body shape, interior orientation, and recurring visual details." : "",
    input.productionBible?.vehicleProfile ?? "",
  ].filter(Boolean).join(" ");
  if (vehicleText) sections.push(`[VEHICLE LOCK]\n${vehicleText}`);

  const scene = (input.scenePrompt ?? "").trim();
  if (scene) sections.push(`[SCENE]\n${scene}`);

  const style = input.productionBible?.stylePrompt?.trim();
  if (style) sections.push(`[STYLE]\n${style}`);

  return sections.join("\n\n");
}

export function compileImagePrompt(input: PromptCompileInput): string {
  const core = compileCore(input);
  const negative = compileNegativePrompt(input);
  return negative ? `${core}\n\n[AVOID]\n${negative}` : core;
}

export function compileVideoPrompt(input: PromptCompileInput): string {
  return compileCore(input);
}

function splitNegativeTerms(value?: string | null): string[] {
  if (!value) return [];
  return value
    .split(/[,\n]/)
    .map((term) => term.trim())
    .filter(Boolean);
}

function automaticNegativeTerms(lock?: SpatialLock | null): string[] {
  if (!lock || Object.keys(lock).length === 0) return [];
  const terms: string[] = [];
  if (lock.driveSide === "LEFT_HAND_DRIVE") terms.push("right-hand-drive car", "mirrored cabin", "steering wheel on right");
  if (lock.driveSide === "RIGHT_HAND_DRIVE") terms.push("left-hand-drive car", "mirrored cabin", "steering wheel on left");
  if (lock.driverSeat === "FRONT_LEFT") terms.push("woman in passenger seat");
  if (lock.driverSeat === "FRONT_RIGHT") terms.push("woman in left passenger seat");
  if (lock.competitorDirection === "SAME_DIRECTION" || lock.allowOncomingTraffic === false) terms.push("oncoming competitors");
  if (lock.rearviewMirrorShows === "ROAD_BEHIND_AND_COMPETITORS") terms.push("protagonist duplicated in rearview mirror", "competitors shown through windshield");
  terms.push("duplicate steering wheel");
  return terms;
}

export function compileNegativePrompt(input: PromptCompileInput): string {
  const lock = input.spatialLock ?? input.productionBible?.defaultSpatialLock;
  const terms = [
    ...splitNegativeTerms(input.productionBible?.negativePrompt),
    ...splitNegativeTerms(input.negativePrompt),
    ...automaticNegativeTerms(lock),
  ];
  const seen = new Set<string>();
  const deduped = terms.filter((term) => {
    const key = term.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return deduped.join(", ");
}

export function validateSpatialLock(lock?: SpatialLock | null): string[] {
  if (!lock) return [];
  const issues: string[] = [];
  if (lock.driveSide === "LEFT_HAND_DRIVE" && lock.driverSeat === "FRONT_RIGHT") {
    issues.push("Left-hand-drive is selected but the driver seat is FRONT_RIGHT.");
  }
  if (lock.driveSide === "RIGHT_HAND_DRIVE" && lock.driverSeat === "FRONT_LEFT") {
    issues.push("Right-hand-drive is selected but the driver seat is FRONT_LEFT.");
  }
  if (lock.allowOncomingTraffic === false && lock.competitorDirection === "ONCOMING") {
    issues.push("Oncoming traffic is disabled but competitors are configured as oncoming traffic.");
  }
  if (lock.rearviewMirrorShows === "ROAD_BEHIND_AND_COMPETITORS" && lock.competitorPosition && lock.competitorPosition !== "BEHIND") {
    issues.push("The rearview mirror is configured to show competitors, but competitors are not positioned BEHIND.");
  }
  if (lock.windshieldShows === "OPEN_ROAD_AHEAD" && lock.competitorPosition === "AHEAD") {
    issues.push("The windshield is configured as open road ahead, but competitors are positioned AHEAD.");
  }
  return issues;
}
