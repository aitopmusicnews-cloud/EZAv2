import { useEffect, useState } from "react";
import { resumeInflightJobs } from "../lib/scheduler.js";
import { resumeInflightLipSyncJobs } from "../lib/lipsync.js";
import { DirectorWorkspace } from "../components/DirectorWorkspace.js";
import { AdvancedEditor } from "../components/AdvancedEditor.js";

const promoLaunchStyle = {
  position: "fixed" as const,
  top: 52,
  right: 16,
  zIndex: 95,
};

export function Editor() {
  const [advanced, setAdvanced] = useState(false);

  useEffect(() => {
    resumeInflightJobs();
    resumeInflightLipSyncJobs();
  }, []);

  if (advanced) {
    return (
      <>
        <button type="button" className="director-return" onClick={() => setAdvanced(false)}>
          ← Back to BeatSync Director
        </button>
        <a href="/promo" className="btn primary" style={promoLaunchStyle}>Promo Mode</a>
        <AdvancedEditor />
      </>
    );
  }

  return (
    <>
      <a href="/promo" className="btn primary" style={promoLaunchStyle}>Promo Mode</a>
      <DirectorWorkspace onOpenAdvanced={() => setAdvanced(true)} />
    </>
  );
}
