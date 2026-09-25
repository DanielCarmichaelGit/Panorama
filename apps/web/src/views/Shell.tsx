import { useCallback, useEffect, useState } from "react";
import { Link, NavLink, Outlet, useMatch, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { CaretLineLeft, CaretLineRight, GearSix, Kanban, List, Lock, Robot, Tray } from "@phosphor-icons/react";
import { SidebarStatus } from "../components/SidebarStatus";
import type { Project } from "@boomerang/core";
import type { Status } from "../App";
import { api } from "../lib/api";
import { session } from "../lib/session";
import { SIDEBAR_KEY } from "../lib/storage";
import { useLanes, useProjects, useStream } from "../lib/hooks";
import { isTypingTarget } from "../lib/keys";
import { useFocusTrap } from "../lib/useFocusTrap";
import { ProjectSwitcher } from "../components/ProjectSwitcher";
import { BrandMark } from "../components/BrandMark";
import { FirstProject } from "./FirstProject";
import { TicketPanel } from "./TicketPanel";

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === "1";
  } catch {
    return false;
  }
}

function writeCollapsed(v: boolean): void {
  try {
    localStorage.setItem(SIDEBAR_KEY, v ? "1" : "0");
  } catch {
    // storage unavailable; the preference just won't persist
  }
}

function SkeletonRows() {
  return (
    <div className="view">
      {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton" />)}
    </div>
  );
}

/** Below 860px the sidebar foot has nowhere to live, so it moves in here. */
function MenuSheet({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  const ref = useFocusTrap<HTMLDivElement>(onClose);
  return (
    <div className="modal-back sheet-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Menu" ref={ref}>
        {children}
      </div>
    </div>
  );
}

export function Shell({ status, chainOk }: { status: Status; chainOk: boolean }) {
  const projects = useProjects();
  const streamStatus = useStream();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [projectOverride, setProjectOverride] = useState<string | null>(null);
  const [lockError, setLockError] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const navigate = useNavigate();
  const qc = useQueryClient();

  const list = projects.data ?? [];
  const current = list.find((p) => p.id === projectOverride) ?? list[0] ?? null;
  const lanes = useLanes(current?.id);
  const ticketMatch = useMatch("/t/:id");
  const boardTicketMatch = useMatch("/board/t/:id");
  const ticketId = ticketMatch?.params.id ?? boardTicketMatch?.params.id;
  const rootMatch = useMatch("/");
  const queueCurrent = !!rootMatch || !!ticketMatch;
  const boardMatch = useMatch("/board");
  const boardCurrent = !!boardMatch || !!boardTicketMatch;

  function closeTicketPanel() {
    navigate(boardTicketMatch ? "/board" : "/");
    if (ticketId) {
      window.setTimeout(() => {
        document.querySelector<HTMLElement>(`[data-ticket="${ticketId}"]`)?.focus();
      }, 0);
    }
  }

  useEffect(() => {
    let pendingG = false;
    let timer: number | undefined;
    const reset = () => { pendingG = false; window.clearTimeout(timer); };
    function onKeyDown(e: KeyboardEvent) {
      if (isTypingTarget() || document.querySelector(".modal-back")) { reset(); return; }
      if (pendingG) {
        reset();
        if (e.key === "q") { e.preventDefault(); navigate("/"); }
        else if (e.key === "b") { e.preventDefault(); navigate("/board"); }
        else if (e.key === "a") { e.preventDefault(); navigate("/agents"); }
        else if (e.key === "s") { e.preventDefault(); navigate("/settings"); }
        return;
      }
      if (e.key === "g") { pendingG = true; timer = window.setTimeout(reset, 900); }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("keydown", onKeyDown); reset(); };
  }, [navigate]);

  function toggleCollapsed() {
    setCollapsed((c) => { writeCollapsed(!c); return !c; });
  }

  async function handleLock() {
    setLockError("");
    try {
      await api("POST", "/api/v1/lock");
      session.clear();
      qc.invalidateQueries({ queryKey: ["status"] });
    } catch (e) {
      setLockError(e instanceof Error ? e.message : "Could not lock Boomerang.");
    }
  }

  if (projects.isError) {
    return (
      <main className="view">
        <p className="error" role="alert">Cannot reach the Boomerang server.</p>
        <button className="btn" onClick={() => projects.refetch()}>Try again</button>
      </main>
    );
  }
  if (!projects.isPending && list.length === 0) return <FirstProject />;

  return (
    <div className={collapsed ? "shell collapsed" : "shell"}>
      <a className="skip" href="#main">Skip to content</a>
      <nav className="side" aria-label="Main">
        <BrandMark collapsed={collapsed} />
        <div className="switcher">
          {current && <ProjectSwitcher id="project-switcher" list={list} current={current} onChange={setProjectOverride} compact={collapsed} />}
        </div>
        <Link to="/" className="nav-item" aria-label="Queue" title="Queue" aria-current={queueCurrent ? "page" : undefined}>
          <Tray size={22} weight="regular" aria-hidden="true" />
          <span className="label">Queue</span>
        </Link>
        <Link to="/board" className="nav-item" aria-label="Board" title="Board" aria-current={boardCurrent ? "page" : undefined}>
          <Kanban size={22} weight="regular" aria-hidden="true" />
          <span className="label">Board</span>
        </Link>
        <NavLink to="/agents" className="nav-item" aria-label="Agents" title="Agents">
          <Robot size={22} weight="regular" aria-hidden="true" />
          <span className="label">Agents</span>
        </NavLink>
        <NavLink to="/settings" className="nav-item" aria-label="Settings" title="Settings">
          <GearSix size={22} weight="regular" aria-hidden="true" />
          <span className="label">Settings</span>
        </NavLink>
        <button type="button" className="nav-item menu-item" onClick={() => setMenuOpen(true)} aria-haspopup="dialog" aria-expanded={menuOpen}>
          <List size={22} weight="regular" aria-hidden="true" />
          <span className="label">Menu</span>
        </button>
        <div className="foot">
          <SidebarStatus chainOk={chainOk} connected={streamStatus === "open"} />
          {status.encryption && (
            <button type="button" className="nav-item" onClick={handleLock} aria-label="Lock" title="Lock">
              <Lock size={22} weight="regular" aria-hidden="true" />
              <span className="label">Lock</span>
            </button>
          )}
          {lockError && <p className="error" role="alert">{lockError}</p>}
          <button type="button" className="collapse-btn" onClick={toggleCollapsed} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} title={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
            {collapsed ? <CaretLineRight size={16} weight="regular" aria-hidden="true" /> : <CaretLineLeft size={16} weight="regular" aria-hidden="true" />}
          </button>
        </div>
      </nav>
      <main id="main" className={ticketId ? "with-panel" : undefined}>
        {projects.isPending || lanes.isPending ? (
          <SkeletonRows />
        ) : lanes.isError ? (
          <div className="view">
            <p className="error" role="alert">Could not load lanes.</p>
            <button className="btn" onClick={() => lanes.refetch()}>Try again</button>
          </div>
        ) : (
          <Outlet context={{ project: current, lanes: lanes.data ?? [] }} />
        )}
      </main>
      {ticketId && <TicketPanel id={ticketId} onClose={closeTicketPanel} />}
      {menuOpen && (
        <MenuSheet onClose={closeMenu}>
          {current && (
            <ProjectSwitcher
              id="project-switcher-menu"
              list={list}
              current={current}
              onChange={(id) => { setProjectOverride(id); closeMenu(); }}
            />
          )}
          <Link to="/settings" className="btn ghost" onClick={closeMenu}>
            <GearSix size={16} weight="regular" aria-hidden="true" /> Settings
          </Link>
          <SidebarStatus chainOk={chainOk} connected={streamStatus === "open"} />
          {status.encryption && (
            <button type="button" className="btn ghost" onClick={handleLock}>
              <Lock size={16} weight="regular" aria-hidden="true" /> Lock
            </button>
          )}
          {lockError && <p className="error" role="alert">{lockError}</p>}
          <button type="button" className="btn ghost" onClick={closeMenu}>Close</button>
        </MenuSheet>
      )}
    </div>
  );
}
