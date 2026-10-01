import { PanelLeft } from "lucide-react";

// The approved soft silhouette is shared by the sidebar's expand / collapse actions.
// Shape styling only touches this icon, not other PanelLeft consumers.
export default function SidebarToggleIcon() {
  return (
    <PanelLeft
      size={18}
      strokeWidth={1.6}
      className="sidebar-toggle-icon shrink-0"
      aria-hidden="true"
      focusable="false"
    />
  );
}
