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
  ChevronDown,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";

type NavEintrag = { to: string; label: string; icon: LucideIcon; end?: boolean };
type NavGruppe = { id: string; titel: string; eintraege: NavEintrag[] };

const OBEN: NavEintrag[] = [
  { to: "/", label: "Übersicht", icon: LayoutDashboard, end: true },
  { to: "/statistik", label: "Statistik", icon: ChartColumn },
];

const GRUPPEN: NavGruppe[] = [
  {
    id: "verkauf",
    titel: "Verkauf",
    eintraege: [
      { to: "/angebote", label: "Angebote", icon: FileSignature },
      { to: "/rechnungen", label: "Rechnungen", icon: FileText },
      { to: "/gutschriften", label: "Gutschriften", icon: Receipt },
      { to: "/lieferscheine", label: "Lieferscheine", icon: Truck },
    ],
  },
  {
    id: "einkauf",
    titel: "Einkauf & Bank",
    eintraege: [
      { to: "/bestellungen", label: "Bestellungen", icon: ShoppingCart },
      { to: "/e-rechnungen", label: "E-Rechnungen", icon: FileInput },
      { to: "/bank", label: "Bank", icon: Landmark },
    ],
  },
  {
    id: "stammdaten",
    titel: "Stammdaten",
    eintraege: [
      { to: "/kunden", label: "Kunden", icon: Users },
      { to: "/lieferanten", label: "Lieferanten", icon: Building2 },
      { to: "/produkte", label: "Produkte", icon: Package },
      { to: "/lager", label: "Lager", icon: Boxes },
    ],
  },
];

const UNTEN: NavEintrag[] = [
  { to: "/einstellungen", label: "Einstellungen", icon: Settings },
];

function ladeZugeklappt(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem("nav-zugeklappt") ?? "{}");
  } catch {
    return {};
  }
}

export default function Layout() {
  const { user, isLoading, logout } = useAuth({ redirectOnUnauthenticated: true });
  const [navOffen, setNavOffen] = useState(false);
  const [zugeklappt, setZugeklappt] = useState<Record<string, boolean>>(ladeZugeklappt);

  // Akzentfarbe aus den Einstellungen aufs UI anwenden
  const einstellungen = trpc.settings.get.useQuery(undefined, { retry: false });
  useEffect(() => {
    akzentAnwenden(einstellungen.data?.akzentfarbe ?? "neutral");
  }, [einstellungen.data?.akzentfarbe]);

  function klappen(id: string) {
    setZugeklappt((z) => {
      const neu = { ...z, [id]: !z[id] };
      localStorage.setItem("nav-zugeklappt", JSON.stringify(neu));
      return neu;
    });
  }

  if (isLoading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-50">
        <p className="text-sm text-neutral-500">Anmeldung wird geprüft …</p>
      </div>
    );
  }

  const eintrag = (item: NavEintrag) => (
    <NavLink
      key={item.to}
      to={item.to}
      end={item.end}
      onClick={() => setNavOffen(false)}
      className={({ isActive }) =>
        cn(
          "mb-0.5 flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
          isActive
            ? "bg-neutral-100 font-medium text-neutral-900"
            : "text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900",
        )
      }
    >
      <item.icon className="h-4 w-4 shrink-0" />
      {item.label}
    </NavLink>
  );

  const navInhalt = (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-200 px-5 py-4">
        <div>
          <div className="font-extrabold tracking-tight">
            Re<span className="text-teal-700">WaWi</span>
          </div>
          <div className="mt-0.5 text-[11px] text-neutral-400">Rechnungs- &amp; Warenwirtschaft</div>
        </div>
        <button
          onClick={() => setNavOffen(false)}
          aria-label="Menü schließen"
          className="rounded p-1.5 text-neutral-400 hover:bg-neutral-100 md:hidden"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-2">
        {OBEN.map(eintrag)}
        {GRUPPEN.map((g) => (
          <div key={g.id} className="mt-1">
            <button
              onClick={() => klappen(g.id)}
              className="flex w-full items-center justify-between rounded-md px-3 py-1.5 text-[11px] font-semibold tracking-wider text-neutral-400 uppercase hover:text-neutral-600"
            >
              {g.titel}
              <ChevronDown
                className={cn(
                  "h-3.5 w-3.5 transition-transform",
                  zugeklappt[g.id] && "-rotate-90",
                )}
              />
            </button>
            {!zugeklappt[g.id] && g.eintraege.map(eintrag)}
          </div>
        ))}
        <div className="mt-1 border-t border-neutral-100 pt-1">{UNTEN.map(eintrag)}</div>
      </nav>

      <div className="border-t border-neutral-200 p-3">
        <div
          className="mb-2 truncate px-1 text-xs text-neutral-600"
          title={user.email ?? ""}
        >
          {user.name ?? "Benutzer"}
        </div>
        <button
          onClick={logout}
          className="flex w-full items-center justify-center gap-1.5 rounded-md border border-neutral-200 px-3 py-1.5 text-sm text-neutral-600 transition-colors hover:bg-neutral-50 hover:text-neutral-900"
        >
          <LogOut className="h-4 w-4" /> Abmelden
        </button>
        <div className="mt-2 text-center text-[11px] text-neutral-400">ReWaWi v1.1 · PraxiOS</div>
      </div>
    </div>
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
          <span className="text-sm font-extrabold tracking-tight">
            Re<span className="text-teal-700">WaWi</span>
          </span>
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
