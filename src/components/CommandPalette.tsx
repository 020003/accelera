import { useEffect } from "react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  BarChart3,
  Bell,
  Cog,
  DollarSign,
  Download,
  Gauge,
  Monitor,
  Moon,
  RefreshCw,
  ShieldAlert,
  Sun,
  TrendingUp,
} from "lucide-react";
import type { HostData } from "@/types/dashboard";

export type PaletteRefreshMode = "realtime" | "balanced" | "low-load" | "manual";

export const DASHBOARD_SECTIONS = [
  { value: "overview", label: "Overview", icon: BarChart3, shortcut: "1" },
  { value: "visualizations", label: "Advanced Visualizations", icon: TrendingUp, shortcut: "2" },
  { value: "costs", label: "Cost Analysis", icon: DollarSign, shortcut: "3" },
  { value: "alerts", label: "Alerts", icon: Bell, shortcut: "4" },
  { value: "gpu-events", label: "GPU Health", icon: ShieldAlert, shortcut: "5" },
  { value: "settings", label: "Settings", icon: Cog, shortcut: "6" },
] as const;

const REFRESH_MODES: { value: PaletteRefreshMode; label: string }[] = [
  { value: "realtime", label: "Realtime (2s)" },
  { value: "balanced", label: "Balanced (5s)" },
  { value: "low-load", label: "Low load (30s)" },
  { value: "manual", label: "Manual" },
];

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hostsData: HostData[];
  onNavigate: (tab: string) => void;
  onRefresh: () => void;
  onToggleTheme: () => void;
  theme: string;
  onExportCsv: () => void;
  performanceMode: PaletteRefreshMode;
  onPerformanceMode: (mode: PaletteRefreshMode) => void;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

export function CommandPalette({
  open,
  onOpenChange,
  hostsData,
  onNavigate,
  onRefresh,
  onToggleTheme,
  theme,
  onExportCsv,
  performanceMode,
  onPerformanceMode,
}: CommandPaletteProps) {
  // Global shortcuts: Ctrl/⌘+K toggles the palette, Alt+1…6 jump between sections.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpenChange(!open);
        return;
      }
      if (e.altKey && !e.metaKey && !e.ctrlKey && !isTypingTarget(e.target)) {
        const section = DASHBOARD_SECTIONS.find((s) => e.code === `Digit${s.shortcut}`);
        if (section) {
          e.preventDefault();
          onNavigate(section.value);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange, onNavigate]);

  const run = (fn: () => void) => () => {
    onOpenChange(false);
    fn();
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <DialogTitle className="sr-only">Command palette</DialogTitle>
      <DialogDescription className="sr-only">Search sections, hosts and actions</DialogDescription>
      <CommandInput placeholder="Jump to a host or section, or run an action…" />
      <CommandList>
        <CommandEmpty>No matches.</CommandEmpty>
        <CommandGroup heading="Sections">
          {DASHBOARD_SECTIONS.map((s) => {
            const Icon = s.icon;
            return (
              <CommandItem key={s.value} value={`section ${s.label}`} onSelect={run(() => onNavigate(s.value))}>
                <Icon className="mr-2" />
                {s.label}
                <CommandShortcut>Alt+{s.shortcut}</CommandShortcut>
              </CommandItem>
            );
          })}
        </CommandGroup>
        {hostsData.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Hosts">
              {hostsData.map((host) => {
                const util = host.gpus.length
                  ? Math.round(host.gpus.reduce((s, g) => s + g.utilization, 0) / host.gpus.length)
                  : 0;
                return (
                  <CommandItem
                    key={host.url}
                    value={`host ${host.name} ${host.url}`}
                    onSelect={run(() => onNavigate(host.url))}
                  >
                    <Monitor className="mr-2" />
                    <span className="truncate">{host.name}</span>
                    <span
                      className={`ml-2 h-2 w-2 shrink-0 rounded-full ${host.isConnected ? "bg-emerald-500" : "bg-red-500"}`}
                    />
                    <CommandShortcut className="tracking-normal">
                      {host.isConnected ? `${host.gpus.length} GPU · ${util}%` : "offline"}
                    </CommandShortcut>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </>
        )}
        <CommandSeparator />
        <CommandGroup heading="Actions">
          <CommandItem value="action refresh now reload" onSelect={run(onRefresh)}>
            <RefreshCw className="mr-2" />
            Refresh fleet now
          </CommandItem>
          <CommandItem value="action export csv download snapshot" onSelect={run(onExportCsv)}>
            <Download className="mr-2" />
            Export fleet snapshot (CSV)
          </CommandItem>
          <CommandItem value="action toggle theme dark light" onSelect={run(onToggleTheme)}>
            {theme === "dark" ? <Sun className="mr-2" /> : <Moon className="mr-2" />}
            Switch to {theme === "dark" ? "light" : "dark"} mode
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Refresh mode">
          {REFRESH_MODES.map((m) => (
            <CommandItem
              key={m.value}
              value={`refresh mode ${m.label}`}
              onSelect={run(() => onPerformanceMode(m.value))}
            >
              <Gauge className="mr-2" />
              {m.label}
              {performanceMode === m.value && <CommandShortcut>current</CommandShortcut>}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
