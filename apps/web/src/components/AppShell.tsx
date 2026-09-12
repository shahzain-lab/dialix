import { NavLink, Outlet, useNavigate } from "react-router-dom";
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
  return (
    <div className="flex min-h-screen">
      <aside className="flex w-64 shrink-0 flex-col border-r border-ink-600 bg-ink-950/80">
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
        <nav className="flex-1 space-y-0.5 px-3 pb-4">
          {links.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.to === "/"}
              className={({ isActive }) =>
                `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm ${isActive ? "bg-ink-700 text-white" : "text-mist-400 hover:bg-ink-800 hover:text-mist-100"}`
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
          className="m-3 flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-mist-400 hover:bg-ink-800"
        >
          <LogOut size={16} /> Sign out
        </button>
      </aside>
      <main className="relative flex-1 overflow-auto p-8">
        <Outlet />
      </main>
    </div>
  );
}
