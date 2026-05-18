import { useCallback, useEffect, useRef, useState } from 'react';
import {
  PanelGroup,
  Panel,
  PanelResizeHandle,
  type ImperativePanelHandle,
} from 'react-resizable-panels';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface SplitViewProps {
  /** Optional docs sidebar — appears on the right, alongside the editor. */
  sidebar?: ReactNode;
  /** Show the sidebar? When false, the sidebar panel collapses to 0 width. */
  sidebarVisible?: boolean;
  left: ReactNode;
  right: ReactNode;
}

const RESIZE_HANDLE_CLASS =
  'relative w-[3px] cursor-col-resize bg-border transition-colors hover:bg-primary/40 data-[resize-handle-active]:bg-primary';

/** Reflect the editor `max-width` CSS var so the shift math stays correct
 *  if the user adjusts editor width in Settings. */
const EDITOR_MAX_WIDTH_FALLBACK_PX = 760;

/**
 * Three-pane layout: reader (left) / editor (middle) / docs sidebar
 * (right, collapsible). The sidebar uses an imperative `collapse()` /
 * `expand()` so the PanelGroup never remounts when toggling — keeps
 * layout state consistent across any number of toggles.
 *
 * When the sidebar is visible, the editor pane gets a dynamic left-pad
 * equal to the sidebar's pixel width. That shifts the centered editor
 * content right by half the sidebar width — so it visually centers
 * across the combined (editor + sidebar) block instead of within the
 * editor pane alone. Clamped to never narrow the editor content below
 * its `max-width`.
 */
export function SplitView({ sidebar, sidebarVisible, left, right }: SplitViewProps): JSX.Element {
  const sidebarRef = useRef<ImperativePanelHandle>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const showSidebar = !!sidebar && (sidebarVisible ?? true);
  const [editorPadPx, setEditorPadPx] = useState(0);
  const lastSizesRef = useRef<number[] | null>(null);

  useEffect(() => {
    const panel = sidebarRef.current;
    if (!panel) return;
    if (showSidebar && panel.isCollapsed()) {
      panel.expand();
    } else if (!showSidebar && panel.isExpanded()) {
      panel.collapse();
    }
  }, [showSidebar]);

  const recompute = useCallback((sizes: number[]): void => {
    lastSizesRef.current = sizes;
    const container = containerRef.current;
    if (!container) return;
    if (sizes.length < 3) {
      setEditorPadPx(0);
      return;
    }
    const total = container.offsetWidth;
    const editorPx = (sizes[1]! / 100) * total;
    const sidebarPx = (sizes[2]! / 100) * total;
    // Read the user-configurable editor max-width if it's set as a CSS var.
    const styles = getComputedStyle(document.documentElement);
    const maxWidthRaw = styles.getPropertyValue('--rw-editor-max-width').trim();
    const maxWidth = parseFloat(maxWidthRaw) || EDITOR_MAX_WIDTH_FALLBACK_PX;
    // Stay inside the editor pane — never let the centered content
    // narrow below `maxWidth`. headroom = how much we can shrink the
    // content area without clipping at the right.
    const headroom = Math.max(0, editorPx - maxWidth);
    setEditorPadPx(Math.min(sidebarPx, headroom));
  }, []);

  // Also recompute on container resize (window resize, sidebar toggle
  // animations, …). onLayout only fires when panel sizes change.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (lastSizesRef.current) recompute(lastSizesRef.current);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [recompute]);

  return (
    <div ref={containerRef} className="h-full w-full">
      <PanelGroup direction="horizontal" className="h-full w-full" onLayout={recompute}>
        <Panel id="reader" order={1} defaultSize={showSidebar ? 41 : 50} minSize={20}>
          <div className="h-full w-full overflow-hidden">{left}</div>
        </Panel>
        <PanelResizeHandle className={RESIZE_HANDLE_CLASS} />
        <Panel id="editor" order={2} defaultSize={showSidebar ? 41 : 50} minSize={20}>
          <div
            className="h-full w-full overflow-hidden"
            style={{ paddingLeft: showSidebar ? `${editorPadPx}px` : undefined }}
          >
            {right}
          </div>
        </Panel>
        <PanelResizeHandle className={cn(RESIZE_HANDLE_CLASS, !showSidebar && 'hidden')} />
        <Panel
          ref={sidebarRef}
          id="sidebar"
          order={3}
          collapsible
          collapsedSize={0}
          defaultSize={showSidebar ? 18 : 0}
          minSize={12}
          maxSize={35}
        >
          <div className="h-full w-full overflow-hidden">{sidebar}</div>
        </Panel>
      </PanelGroup>
    </div>
  );
}
