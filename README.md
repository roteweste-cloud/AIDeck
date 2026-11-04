# AI Deck

AI Deck opens your selected AI chat in Steam Deck Game Mode. Use **Ask AI about this screen** in Decky's Quick Access menu to send a screenshot and ask for help. The default prompts request a brief reply in English. You can edit both prompts in Decky.

1. Copy the ZIP from GitHub Releases to your Steam Deck.
2. In Decky Loader, enable Developer mode and select **Developer → Install Plugin from ZIP File**.
3. Open **AI Deck** in the Quick Access menu (…), choose an **AI provider** and select **Open … / sign in**.
4. Start a game, then open **… → Decky → AI Deck → Ask AI about this screen**. AI Deck captures the game image, closes the side menu, opens the chat, and sends the screenshot with your prompt. Press **B** to return to the game.

The in-game shortcut starts disabled, including on upgrade from older versions. You can turn it on under **Enable in-game shortcut**. If capture fails, AI Deck opens the chat and shows the error. If Steam fails to open the chat window, AI Deck reports that separately.

**Open … / sign in** leaves space for the Steam keyboard. Select your login field and use **Y · Keyboard** or **Steam + X**. After signing in, select **Full view** and use **X · Send screenshot** in a running game. The overlay reports whether capture failed, sign-in is needed, or the provider accepted the message.

ChatGPT opens in dark mode. Claude, Gemini, DeepSeek and Perplexity have experimental web integrations. Use a mode and account that accept image uploads. DeepSeek's ability to interpret the screenshot depends on the model and web client. Some embedded sign-in flows, including Google sign-in, may fail. AI Deck uses the selected provider's web session without an API key.

| Overlay button | Action |
| --- | --- |
| Shortcut or B | Return to game |
| Y | Focus the composer and open the keyboard |
| X | Send another screenshot |
| Start | Start a new chat for this game and provider |
| D-pad up / down | Scroll |

AI Deck saves confirmed chat links separately for each game and provider. Resetting removes the local link. Existing ChatGPT links and customized prompts are carried forward. With no game running, **Ask AI about this screen** opens the selected provider without taking a screenshot.

The game still receives the shortcut buttons. Screenshot capture requires Gamescope in Game Mode. Automation uses Steam's local CEF debugger on port 8080 and attaches the screenshot only to the selected provider. If attachment or sending cannot be confirmed, inspect the overlay before retrying. Web selectors are in `py_modules/selectors.json`.

Build with `corepack pnpm install --frozen-lockfile`, `corepack pnpm test`, `corepack pnpm build` and `corepack pnpm package`. On Steam Deck, verify each provider's sign-in, screenshot upload, reply, return to game and conversation reuse after restarting Steam.

Technical references: [Decky Plugin Template](https://github.com/SteamDeckHomebrew/decky-plugin-template), [DeckWebBrowser](https://github.com/jessebofill/DeckWebBrowser), [Audio Output Switcher](https://github.com/zomars/audio-output-switcher), [Desk of Madness](https://github.com/Marshy-Madness/desk-of-madness), and [RomM Tender](https://github.com/danielcopper/romm-tender).
