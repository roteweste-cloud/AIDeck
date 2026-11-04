import { useEffect, useState } from "react";
import { call, useQuickAccessVisible } from "@decky/api";
import { ButtonItem, DropdownItem, PanelSection, PanelSectionRow, TextField, ToggleField } from "@decky/ui";
import { comboLabel, type Shortcut } from "./shortcut";

const providers = { chatgpt: "ChatGPT", claude: "Claude", gemini: "Gemini", deepseek: "DeepSeek", perplexity: "Perplexity" };
export type Provider = keyof typeof providers;
export type Settings = { provider: Provider; enabled: boolean; buttons: number[]; prompts: { first: string; follow: string } };
type Status = { provider: Provider; ready: boolean | null; lastError: string };
export type PanelProps = {
  shortcut: Shortcut;
  load: () => Promise<Settings>;
  save: (value: Settings) => Promise<void>;
  open: () => void;
  capture: () => void;
  reset: () => void;
  report: (error: unknown) => void;
};
export function SettingsPanel({ shortcut, load, save, open, capture, reset, report }: PanelProps) {
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

  if (!settings || !prompts) return <PanelSection title="AI Deck">Loading settings …</PanelSection>;

  const update = async (next: Settings) => {
    setSaving(true);
    try { await save(next); setSettings(next); }
    catch (error) { report(error); }
    finally { setSaving(false); }
  };

  return <>
    <PanelSection title="AI Deck">
      <PanelSectionRow><DropdownItem label="AI provider" description="Claude, Gemini, DeepSeek and Perplexity are experimental." disabled={saving || recording}
        rgOptions={Object.entries(providers).map(([data, label]) => ({ data, label }))}
        selectedOption={settings.provider}
        onChange={({ data }) => void update({ ...settings, provider: data })} /></PanelSectionRow>
      <PanelSectionRow><ToggleField label="Enable shortcut" checked={settings.enabled} disabled={saving || recording}
        onChange={enabled => void update({ ...settings, enabled })} /></PanelSectionRow>
      <PanelSectionRow><ButtonItem layout="below" disabled={saving || recording}
        description={recording ? "Hold at least two buttons together, then release them." : comboLabel(settings.buttons)}
        onClick={() => {
          setRecording(true);
          shortcut.record(result => {
            setRecording(false);
            if (typeof result === "object") void update({ ...settings, buttons: result.buttons });
            else if (result === "short") report("Press at least two buttons together.");
            else if (result === "timeout") report("Shortcut recording timed out.");
          });
        }}>Record shortcut</ButtonItem></PanelSectionRow>
      <PanelSectionRow><ButtonItem layout="below" onClick={open}>Open {providers[settings.provider]} / sign in</ButtonItem></PanelSectionRow>
      <PanelSectionRow><ButtonItem layout="below" onClick={capture}>Capture screenshot and open chat</ButtonItem></PanelSectionRow>
      <PanelSectionRow><ButtonItem layout="below" onClick={reset}>Reset chat for current game</ButtonItem></PanelSectionRow>
      <PanelSectionRow>
        <div>{providers[settings.provider]}: {status?.provider !== settings.provider || status.ready === null
          ? "Status unknown" : status.ready ? "Chat ready" : "Sign in required"}</div>
        {status?.provider === settings.provider && status.lastError && <div>Last error: {status.lastError}</div>}
      </PanelSectionRow>
    </PanelSection>
    <PanelSection title="Prompt templates · {game}">
      <PanelSectionRow><TextField label="First prompt" value={prompts.first}
        onChange={event => setPrompts({ ...prompts, first: event.currentTarget.value })} /></PanelSectionRow>
      <PanelSectionRow><TextField label="Follow-up prompt" value={prompts.follow}
        onChange={event => setPrompts({ ...prompts, follow: event.currentTarget.value })} /></PanelSectionRow>
      <PanelSectionRow><ButtonItem layout="below" disabled={saving || recording}
        onClick={() => void update({ ...settings, prompts })}>Save prompts</ButtonItem></PanelSectionRow>
    </PanelSection>
  </>;
}
