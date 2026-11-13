import { Suspense, lazy, useEffect, useState } from "react";
import {
  Bell, CalendarCheck, DoorOpen, LayoutGrid, LogOut, Menu, ScanFace, Settings as SettingsIcon, Users, X, Radio,
} from "lucide-react";
import { useAuth } from "./auth";
import { navigate, useRoute } from "./router";
import { Avatar, Logo, Spinner, cx, label } from "./ui";
import Login from "./pages/Login";
import Overview from "./pages/Overview";
import Presence from "./pages/Presence";
import Attendance from "./pages/Attendance";
import Employees from "./pages/Employees";
import Gates from "./pages/Gates";
import Alerts from "./pages/Alerts";
import Settings from "./pages/Settings";
// The kiosk pulls in face-api and TensorFlow.js; load it on demand.
const Kiosk = lazy(() => import("./pages/Kiosk"));

const NAV = [
  { id: "overview", label: "Overview", icon: LayoutGrid, page: Overview },
  { id: "presence", label: "Presence", icon: Radio, page: Presence },
  { id: "attendance", label: "Attendance", icon: CalendarCheck, page: Attendance },
  { id: "employees", label: "Employees", icon: Users, page: Employees },
  { id: "gates", label: "Gates", icon: DoorOpen, page: Gates },
  { id: "alerts", label: "Alerts", icon: Bell, page: Alerts },
  { id: "settings", label: "Settings", icon: SettingsIcon, page: Settings },
];

function Background() {
  return (
    <>
      <div className="ambient" aria-hidden>
        <i />
      </div>
      <div className="grain" aria-hidden />
    </>
  );
}

export default function App() {
  const { status, can } = useAuth();
  const [screen, ...rest] = useRoute();

  if (status === "loading") {
    return (
      <>
        <Background />
        <div className="relative z-10 grid min-h-dvh place-items-center">
          <Spinner className="size-6" />
        </div>
      </>
    );
  }

  if (status === "out") {
    return (
      <>
        <Background />
        <Login />
      </>
    );
  }

  // The kiosk runs full screen without the dashboard chrome.
  if (screen === "kiosk" && can("kiosk")) {
    return (
      <>
        <Background />
        <Suspense fallback={<div className="relative z-10 grid min-h-dvh place-items-center"><Spinner className="size-6" /></div>}>
          <Kiosk gateId={rest[0]} />
        </Suspense>
      </>
    );
  }

  const allowed = NAV.filter((item) => can(item.id));
  const active = allowed.find((item) => item.id === screen) ?? allowed[0];
  const Page = active.page;

  return (
    <>
      <Background />
      <main className="relative z-10 w-full max-w-full overflow-x-hidden">
        <TopNav items={allowed} active={active.id} />
        <div className="mx-auto w-full max-w-[1320px] px-4 pb-24 pt-28 sm:px-6 lg:px-10">
          <Page key={active.id} />
        </div>
      </main>
    </>
  );
}

function TopNav({ items, active }) {
  const { user, logout, can } = useAuth();
  const [open, setOpen] = useState(false);

  useEffect(() => setOpen(false), [active]);

  const link = (item, mobile) => {
    const Icon = item.icon;
    const current = item.id === active;
    return (
      <a
        key={item.id}
        href={`#/${item.id}`}
        aria-current={current ? "page" : undefined}
        aria-label={item.label}
        title={item.label}
        className={cx(
          "relative flex h-10 items-center gap-2 rounded-full px-3.5 text-[13px] font-medium transition-[background-color,color] duration-200",
          current ? "bg-white/12 text-fg shadow-[inset_0_1px_0_rgb(255_255_255/0.14)]" : "text-fg-3 hover:bg-white/6 hover:text-fg",
          mobile && "h-12 w-full px-4 text-sm"
        )}
      >
        <Icon className="size-4 shrink-0" aria-hidden />
        <span className={mobile ? "" : "hidden xl:inline"}>{item.label}</span>
      </a>
    );
  };

  return (
    <div className="fixed inset-x-0 top-4 z-40 px-4 sm:px-6">
      <nav
        aria-label="Main"
        className="glass glass-strong mx-auto flex h-[60px] max-w-[1320px] items-center gap-2 rounded-full pl-3 pr-2"
      >
        <a href="#/overview" className="mr-2 flex items-center gap-2.5 rounded-full px-2 py-1" aria-label="SmartGate home">
          <Logo className="size-9" />
          <span className="hidden text-[15px] font-semibold tracking-tight sm:inline">SmartGate</span>
        </a>

        <div className="hidden flex-1 items-center gap-1 md:flex">{items.map((item) => link(item))}</div>
        <div className="flex-1 md:hidden" />

        {can("kiosk") && (
          <a
            href="#/kiosk"
            className="hidden h-10 items-center gap-2 rounded-full bg-accent px-4 text-[13px] font-semibold text-accent-ink transition-colors duration-200 hover:bg-[#99f5d4] sm:flex"
          >
            <ScanFace className="size-4" aria-hidden />
            Kiosk
          </a>
        )}

        <div className="flex items-center gap-2 pl-1">
          <div className="hidden text-right leading-tight lg:block">
            <p className="text-[13px] font-medium text-fg">{user.full_name}</p>
            <p className="text-xs text-fg-3">{label(user.role)}</p>
          </div>
          <Avatar name={user.full_name} />
          <button
            type="button"
            onClick={logout}
            aria-label="Sign out"
            title="Sign out"
            className="hidden size-10 cursor-pointer items-center justify-center rounded-full text-fg-3 transition-colors hover:bg-white/8 hover:text-fg md:inline-flex"
          >
            <LogOut className="size-[18px]" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            className="inline-flex size-10 cursor-pointer items-center justify-center rounded-full text-fg-2 hover:bg-white/8 md:hidden"
          >
            {open ? <X className="size-5" aria-hidden /> : <Menu className="size-5" aria-hidden />}
          </button>
        </div>
      </nav>

      {open && (
        <div className="glass glass-strong reveal mx-auto mt-2 flex max-w-[1320px] flex-col gap-1 rounded-[24px] p-2 md:hidden">
          {items.map((item) => link(item, true))}
          {can("kiosk") && (
            <button type="button" onClick={() => navigate("/kiosk")} className="flex h-12 cursor-pointer items-center gap-2 rounded-full bg-accent px-4 text-sm font-semibold text-accent-ink">
              <ScanFace className="size-4" aria-hidden /> Open kiosk
            </button>
          )}
          <button type="button" onClick={logout} className="flex h-12 cursor-pointer items-center gap-2 rounded-full px-4 text-sm text-fg-2 hover:bg-white/6">
            <LogOut className="size-4" aria-hidden /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}
