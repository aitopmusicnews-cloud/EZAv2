import { useEffect, useState } from "react";
import { resumeInflightJobs } from "../lib/scheduler.js";
import { resumeInflightLipSyncJobs } from "../lib/lipsync.js";
import { DirectorWorkspace } from "../components/DirectorWorkspace.js";
import { AdvancedEditor } from "../components/AdvancedEditor.js";

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
        <AdvancedEditor />
      </>
    );
  }

  return <DirectorWorkspace onOpenAdvanced={() => setAdvanced(true)} />;
}
