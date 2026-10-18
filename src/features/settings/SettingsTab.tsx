import { Monitor, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { type Theme, useSettings } from "@/stores/settings";

const themes: { id: Theme; label: string; icon: typeof Sun }[] = [
  { id: "light", label: "Light", icon: Sun },
  { id: "dark", label: "Dark", icon: Moon },
  { id: "system", label: "System", icon: Monitor },
];

export function SettingsTab() {
  const theme = useSettings((s) => s.theme);
  const setTheme = useSettings((s) => s.setTheme);
  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-2xl space-y-8 p-8">
        <h2 className="text-lg font-semibold">Settings</h2>
        <section className="space-y-3">
          <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Appearance</h3>
          <div className="flex gap-2">
            {themes.map(({ id, label, icon: Icon }) => (
              <Button key={id} variant={theme === id ? "secondary" : "outline"} onClick={() => setTheme(id)}>
                <Icon /> {label}
              </Button>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
