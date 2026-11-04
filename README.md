# AI Deck

AI Deck öffnet ChatGPT im Steam Deck Game Mode im Dunkelmodus. Während eines Spiels nimmt **L4 + R4** einen Screenshot auf und sendet ihn zusammen mit einem Prompt an ChatGPT. Die Chat-URL wird pro Steam-App-ID gespeichert. Dadurch nutzt ein späterer Screenshot denselben Gesprächsverlauf. Du kannst im Overlay auch selbst Fragen stellen.

## Installation und Anmeldung

1. Kopiere die ZIP aus `release/` auf dein Steam Deck. Aktiviere in Decky Loader den Entwicklermodus und installiere das Paket über **Developer → Install Plugin from ZIP File**. Alternativ kannst du den ZIP-Ordner `AI Deck` über SSH in den Decky-Pluginordner (standardmäßig `~/homebrew/plugins/`) kopieren und Decky neu starten.
2. Öffne im Game Mode das Schnellzugriffsmenü (…) und wähle unter AI Deck **ChatGPT öffnen / anmelden**. Melde dich in der eingebetteten ChatGPT-Seite an. AI Deck verwendet diese Sitzung und braucht keinen API-Schlüssel.
3. Starte ein Spiel und drücke **L4 + R4**. Der erste Screenshot eröffnet einen Chat. Drücke die Kombination erneut, um ins Spiel zurückzukehren.

| Taste im Overlay | Aktion |
| --- | --- |
| Hotkey oder B | Zurück ins Spiel |
| Y | Eingabefeld fokussieren und Bildschirmtastatur öffnen |
| X | Neuen Screenshot an den aktuellen Spielchat senden |
| Start | Zuordnung des Spiels zurücksetzen und einen neuen Chat öffnen |
| Steuerkreuz ↑ / ↓ | Seite hoch / runter |

Im Schnellzugriffsmenü kannst du den Hotkey deaktivieren, eine Kombination aus mindestens zwei Tasten aufnehmen, beide Prompts bearbeiten oder den Spielchat zurücksetzen. `{game}` wird durch den Namen des Spiels ersetzt. Das Zurücksetzen löst die Zuordnung in AI Deck. Der alte Chat bleibt im ChatGPT-Verlauf. Ohne laufendes Spiel öffnet der Hotkey ChatGPT für die globale Zuordnung ohne Screenshot.

## Grenzen und Fehlersuche

- Die Spieleingabe erhält die Tasten ebenfalls. Verwende eine Kombination, die im Spiel frei ist.
- Screenshots benötigen Gamescope im Game Mode. Das Backend nutzt die Base-Plane von Gamescope. Die Arbeitskopie liegt kurz in einem privaten temporären Ordner. Der Upload geht über deine ChatGPT-Websitzung.
- Wenn Google die Anmeldung im eingebetteten Browser blockiert, verwende eine für dein Konto verfügbare E-Mail-Anmeldung. Schließe eine etwaige Cloudflare-Prüfung im Browser ab.
- ChatGPT kann Uploads limitieren oder seine Oberfläche ändern. Der Fehler erscheint als Toast. Das Overlay bleibt zur manuellen Eingabe geöffnet. Die DOM-Selektoren stehen in `py_modules/selectors.json`.
- Der Steam-CEF-Debugger muss für Decky lokal auf Port 8080 erreichbar sein. Bei einem Debuggerfehler Decky und Steam prüfen. Die Backend-Logs liegen üblicherweise unter `~/homebrew/logs/AI Deck/`.
- Die Browser- und Controller-Schnittstellen stammen aus der Steam-Oberfläche und können sich mit Steam-Updates ändern.

## Lokaler Build

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm test
corepack pnpm build
corepack pnpm package
python -m py_compile main.py py_modules/cdp.py py_modules/screenshot.py py_modules/chatgpt_driver.py
```

Auf dem Deck prüfen: Anmeldung → erster Screenshot → sichtbare Antwort → zurück ins Spiel → zweiter Screenshot im selben Chat → Steam neu starten → gleicher Chat pro Spiel. Anschließend X, Y, Start, Scrollen, Hotkey-Aufnahme und den Fehlerpfad im ausgeloggten Zustand prüfen.

Technische Vorbilder: [Decky Plugin Template](https://github.com/SteamDeckHomebrew/decky-plugin-template), [DeckWebBrowser](https://github.com/jessebofill/DeckWebBrowser), [Audio Output Switcher](https://github.com/zomars/audio-output-switcher), [Desk of Madness](https://github.com/Marshy-Madness/desk-of-madness) und [RomM Tender](https://github.com/danielcopper/romm-tender).
