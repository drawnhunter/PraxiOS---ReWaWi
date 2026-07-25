import { useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router";
import { trpc } from "@/providers/trpc";
import { akzentAnwenden } from "@/lib/design";
import {
  LayoutDashboard,
  ChartColumn,
  Landmark,
  FileInput,
  FileText,
  Receipt,
  Users,
  Package,
  Boxes,
  Settings,
  Truck,
  ShoppingCart,
  Building2,
  FileSignature,
  LogOut,
  Menu,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";

const NAV = [
  { to: "/", label: "Übersicht", icon: LayoutDashboard, end: true },
  { to: "/statistik", label: "Statistik", icon: ChartColumn },
  { to: "/angebote", label: "Angebote", icon: FileSignature },
  { to: "/rechnungen", label: "Rechnungen", icon: FileText },
  { to: "/gutschriften", label: "Gutschriften", icon: Receipt },
  { to: "/bank", label: "Bank", icon: Landmark },
  { to: "/e-rechnungen", label: "E-Rechnungen", icon: FileInput },
  { to: "/lieferscheine", label: "Lieferscheine", icon: Truck },
  { to: "/bestellungen", label: "Bestellungen", icon: ShoppingCart },
  { to: "/kunden", label: "Kunden", icon: Users },
  { to: "/lieferanten", label: "Lieferanten", icon: Building2 },
  { to: "/produkte", label: "Produkte", icon: Package },
  { to: "/lager", label: "Lager", icon: Boxes },
  { to: "/einstellungen", label: "Einstellungen", icon: Settings },
];

export default function Layout() {
  const { user, isLoading, logout } = useAuth({ redirectOnUnauthenticated: true });
  const [navOffen, setNavOffen] = useState(false);

  // Akzentfarbe aus den Einstellungen aufs UI anwenden
  const einstellungen = trpc.settings.get.useQuery(undefined, { retry: false });
  useEffect(() => {
    akzentAnwenden(einstellungen.data?.akzentfarbe ?? "neutral");
  }, [einstellungen.data?.akzentfarbe]);

  if (isLoading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-50">
        <p className="text-sm text-neutral-500">Anmeldung wird geprüft …</p>
      </div>
    );
  }

  const navInhalt = (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-5">
        <div>
          <div className="text-sm font-semibold tracking-tight">ReWaWi</div>
          <div className="text-xs text-neutral-500">Rechnungs- &amp; Warenwirtschaft</div>
        </div>
        <button
          onClick={() => setNavOffen(false)}
          aria-label="Menü schließen"
          className="rounded p-1.5 text-neutral-400 hover:bg-neutral-100 md:hidden"
        >
          <X className="h-5 w-5" />
        </button>
      </div>
      <nav className="px-3">
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            onClick={() => setNavOffen(false)}
            className={({ isActive }) =>
              cn(
                "mb-0.5 flex items-center gap-2.5 rounded-md px-3 py-2.5 text-sm transition-colors",
                isActive
                  ? "bg-neutral-100 font-medium text-neutral-900"
                  : "text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900",
              )
            }
          >
            <item.icon className="h-4 w-4 shrink-0" />
            {item.label}
          </NavLink>
        ))}
      </nav>
      <div className="absolute bottom-4 left-0 w-full px-5">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 gap-2">
          <span className="truncate text-xs text-neutral-600" title={user.email ?? ""}>
            {user.name ?? "Benutzer"}
          </span>
          <button
            onClick={logout}
            title="Abmelden"
            className="rounded p-1 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700"
          >
            <LogOut className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="text-[11px] text-neutral-400">ReWaWi v1.0 · PraxiOS</div>
      </div>
    </>
  );

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900">
      {/* Mobiler Kopfbereich */}
      <header className="fixed inset-x-0 top-0 z-30 flex h-14 items-center justify-between border-b border-neutral-200 bg-white px-4 md:hidden">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setNavOffen(true)}
            aria-label="Menü öffnen"
            className="rounded p-1.5 text-neutral-600 hover:bg-neutral-100"
          >
            <Menu className="h-5 w-5" />
          </button>
          <span className="text-sm font-semibold tracking-tight">ReWaWi</span>
        </div>
        <button
          onClick={logout}
          aria-label="Abmelden"
          className="rounded p-1.5 text-neutral-400 hover:bg-neutral-100"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </header>

      {/* Abdunklung hinter dem mobilen Menü */}
      {navOffen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={() => setNavOffen(false)}
        />
      )}

      {/* Seitenleiste: mobil als Einblendung, ab md dauerhaft sichtbar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-64 border-r border-neutral-200 bg-white transition-transform duration-200 md:w-56 md:translate-x-0",
          navOffen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        {navInhalt}
      </aside>

      <main className="min-h-screen pt-14 md:ml-56 md:pt-0">
        <div className="mx-auto max-w-5xl px-4 py-6 md:px-8 md:py-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
