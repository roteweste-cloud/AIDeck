import { useEffect, useState } from "react";
import { call, useQuickAccessVisible } from "@decky/api";
import { ButtonItem, PanelSection, PanelSectionRow, TextField, ToggleField } from "@decky/ui";
import { comboLabel, type Shortcut } from "./shortcut";

export type Settings = { enabled: boolean; buttons: number[]; prompts: { first: string; follow: string } };
type Status = { signedIn: boolean | null; lastError: string };
export type PanelProps = {
  shortcut: Shortcut;
  load: () => Promise<Settings>;
  save: (value: Settings) => Promise<void>;
  open: () => void;
  reset: () => void;
  report: (error: unknown) => void;
};
export function SettingsPanel({ shortcut, load, save, open, reset, report }: PanelProps) {
  const [settings, setSettings] = useState<Settings>();
  const [prompts, setPrompts] = useState<Settings["prompts"]>();
  const [status, setStatus] = useState<Status>();
  const [recording, setRecording] = useState(false);
  const [saving, setSaving] = useState(false);
  const visible = useQuickAccessVisible();

  useEffect(() => {
    if (!visible) return;
    let active = true;
    void load().then(value => {
      if (active) { setSettings(value); setPrompts(value.prompts); }
    }).catch(report);
    const refresh = () => void call<[], Status>("status").then(value => {
      if (active) setStatus(value);
    }).catch(report);
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => { active = false; clearInterval(timer); shortcut.cancelRecording(); };
  }, [visible, load, report, shortcut]);

  if (!settings || !prompts) return <PanelSection title="AI Deck">Einstellungen werden geladen …</PanelSection>;

  const update = async (next: Settings) => {
    setSaving(true);
    try { await save(next); setSettings(next); }
    catch (error) { report(error); }
    finally { setSaving(false); }
  };

  return <>
    <PanelSection title="AI Deck">
      <PanelSectionRow><ToggleField label="Hotkey aktiv" checked={settings.enabled} disabled={saving || recording}
        onChange={enabled => void update({ ...settings, enabled })} /></PanelSectionRow>
      <PanelSectionRow><ButtonItem layout="below" disabled={saving || recording}
        description={recording ? "Mindestens zwei Tasten zusammen halten und loslassen." : comboLabel(settings.buttons)}
        onClick={() => {
          setRecording(true);
          shortcut.record(result => {
            setRecording(false);
            if (typeof result === "object") void update({ ...settings, buttons: result.buttons });
            else if (result === "short") report("Bitte mindestens zwei Tasten zusammen drücken.");
            else if (result === "timeout") report("Aufnahme abgelaufen.");
          });
        }}>Hotkey aufnehmen</ButtonItem></PanelSectionRow>
      <PanelSectionRow><ButtonItem layout="below" onClick={open}>ChatGPT öffnen / anmelden</ButtonItem></PanelSectionRow>
      <PanelSectionRow><ButtonItem layout="below" onClick={reset}>Chat für aktuelles Spiel zurücksetzen</ButtonItem></PanelSectionRow>
      <PanelSectionRow>
        <div>ChatGPT: {status?.signedIn === true ? "angemeldet" : status?.signedIn === false ? "Anmeldung nötig" : "Status unbekannt"}</div>
        {status?.lastError && <div>Letzter Fehler: {status.lastError}</div>}
      </PanelSectionRow>
    </PanelSection>
    <PanelSection title="Prompt-Vorlagen · {game}">
      <PanelSectionRow><TextField label="Erster Prompt" value={prompts.first}
        onChange={event => setPrompts({ ...prompts, first: event.currentTarget.value })} /></PanelSectionRow>
      <PanelSectionRow><TextField label="Folge-Prompt" value={prompts.follow}
        onChange={event => setPrompts({ ...prompts, follow: event.currentTarget.value })} /></PanelSectionRow>
      <PanelSectionRow><ButtonItem layout="below" disabled={saving || recording}
        onClick={() => void update({ ...settings, prompts })}>Prompts speichern</ButtonItem></PanelSectionRow>
    </PanelSection>
  </>;
}
