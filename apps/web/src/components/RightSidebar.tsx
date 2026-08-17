import { useStore } from "../lib/store.js";
import { Sidebar } from "./Sidebar.js";
import { SidebarEmpty } from "./SidebarEmpty.js";

export function RightSidebar() {
  const selectedId = useStore((s) => s.selectedClipId);
  const selectedClip = useStore((s) => s.clips.find((c) => c.id === selectedId));
  return (
    <aside className={`right${selectedClip ? "" : " empty"}`}>
      <div className="sidebar-scroll">
        {selectedClip ? <Sidebar /> : <SidebarEmpty />}
      </div>
    </aside>
  );
}
