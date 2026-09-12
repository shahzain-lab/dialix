import { Menu, X } from "lucide-react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import {
  Bot,
  BookOpen,
  AudioLines,
  Phone,
  Users,
  ListOrdered,
  Megaphone,
  PhoneCall,
  CalendarDays,
  Plug,
  Wallet,
  Settings,
  LayoutDashboard,
  LogOut,
} from "lucide-react";
import { useAuth } from "../lib/auth";
import { Select } from "./ui";

const links = [
  { to: "/", label: "Overview", icon: LayoutDashboard },
  { to: "/agents", label: "Agents", icon: Bot },
  { to: "/knowledge", label: "Knowledge", icon: BookOpen },
  { to: "/voices", label: "Voices", icon: AudioLines },
  { to: "/phone-numbers", label: "Phone numbers", icon: Phone },
  { to: "/contacts", label: "Contacts", icon: Users },
  { to: "/lists", label: "Lists", icon: ListOrdered },
  { to: "/campaigns", label: "Campaigns", icon: Megaphone },
  { to: "/calls", label: "Calls", icon: PhoneCall },
  { to: "/appointments", label: "Appointments", icon: CalendarDays },
  { to: "/integrations", label: "Integrations", icon: Plug },
  { to: "/billing", label: "Billing", icon: Wallet },
  { to: "/team", label: "Team", icon: Users },
  { to: "/settings", label: "Settings", icon: Settings },
];

export function AppShell() {
  const { session, org, setOrgId, logout } = useAuth();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const close = () => setOpen(false);
    window.addEventListener("resize", close);
    return () => window.removeEventListener("resize", close);
  }, []);

  const sidebar = (
    <>
      <div className="px-5 py-5">
        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">Dialix</div>
        <div className="mt-1 text-lg font-semibold">Voice control plane</div>
        <div className="mt-1 truncate text-xs text-mist-400">{org?.name}</div>
      </div>
      <div className="px-4 pb-3">
        <Select value={org?.id} onChange={(e) => setOrgId(e.target.value)}>
          {session?.organizations.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </Select>
      </div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 pb-4">
        {links.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            end={link.to === "/"}
            onClick={() => setOpen(false)}
            className={({ isActive }) =>
              `flex min-h-11 items-center gap-2.5 rounded-lg px-3 py-2 text-sm ${isActive ? "bg-ink-700 text-white" : "text-mist-400 hover:bg-ink-800 hover:text-mist-100"}`
            }
          >
            <link.icon size={16} />
            {link.label}
          </NavLink>
        ))}
      </nav>
      <button
        onClick={async () => {
          await logout();
          nav("/login", { replace: true });
        }}
        className="m-3 flex min-h-11 items-center gap-2 rounded-lg px-3 py-2 text-sm text-mist-400 hover:bg-ink-800"
      >
        <LogOut size={16} /> Sign out
      </button>
    </>
  );

  return (
    <div className="flex min-h-screen">
      {open ? <button className="fixed inset-0 z-40 bg-black/50 md:hidden" aria-label="Close menu" onClick={() => setOpen(false)} /> : null}
      <aside className={`fixed inset-y-0 left-0 z-50 flex w-64 shrink-0 flex-col border-r border-ink-600 bg-ink-950 transition-transform md:static md:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}>
        {sidebar}
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-ink-600 bg-ink-950/90 px-4 py-3 backdrop-blur md:hidden">
          <button className="rounded-lg p-2 hover:bg-ink-800" aria-label="Open menu" onClick={() => setOpen((v) => !v)}>
            {open ? <X size={20} /> : <Menu size={20} />}
          </button>
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-[0.2em] text-accent">Dialix</div>
            <div className="truncate text-sm font-medium">{org?.name}</div>
          </div>
        </header>
        <main className="relative min-w-0 flex-1 overflow-auto p-4 sm:p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
