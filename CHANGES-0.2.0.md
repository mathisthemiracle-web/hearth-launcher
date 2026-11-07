# Hearth 0.2.0

## Login fixes
- **Device-code polling failed on the first check.** The code compared Microsoft's
  *description* text to `authorization_pending`, but that text never contains the
  code (`AADSTS70016: ... Authorization is pending`). Sign-in failed straight away
  with "Microsoft sign-in could not finish". Polling now reads the OAuth `error` field.
- **Saving the session could fail at the very end.** Windows Credential Manager
  holds at most 2560 bytes per secret. A Minecraft token plus a refresh token is
  longer than that. The session is now split across several entries.
- **Real error messages.** Tauri returns errors as strings, and the UI threw them
  away. Errors now show the real cause, with plain-language explanations for the
  common Entra mistakes: wrong account type, public client flows off, and the Mojang
  approval 403.
- Sign-in can be cancelled, uses Microsoft's real expiry time, survives brief
  network drops, and asks for a fresh sign-in when a refresh token is revoked.
- Client ID format is validated before any request is sent.

## Other bugs fixed
- Removing a mod always failed: the parameter was `mod` instead of `modInfo`.
- Shader packs were never switched on. Hearth stored the pack's display title,
  never wrote Iris' config, and Iris needs the file name. Hearth now writes
  `config/iris.properties` before each launch.
- Distant Horizons radius was never applied. It is now written into
  `config/DistantHorizons.toml` after DH has created that file once.
- One mod without a build for the chosen Minecraft version broke the whole preset,
  and the instance could never launch. Hearth now skips that mod and tells you which.
- Updating a mod left the old jar next to the new one, and Fabric crashed with a
  duplicate-mod error. Hearth now tracks the files it installs and replaces them.
- Shader search could pick OptiFine-only releases. It now prefers Iris releases.
- Old-style LWJGL natives used the wrong classifier (`x86_64` instead of `64`).
- Instant crashes reported "success". Hearth now waits 4 s, and if Java exits it
  shows the last lines of `logs/hearth-launch.log`.
- `package-lock.json` pointed at a private npm mirror (`npm.mirrors.msh.team`), so
  `npm ci` hung on any other machine, including GitHub Actions.
- `icons/icon.png` was RGB, and Tauri refuses to compile with a non-RGBA icon.
- Duplicated instances could never launch until a preset was re-applied.

## Speed
- One pooled HTTP client for everything (warm TLS, keep-alive), with retries.
- Libraries, assets and Java now download **at the same time**, with 32 parallel
  downloads. Before, libraries came one by one and assets 8 at a time.
- Relaunch no longer re-reads and re-hashes every asset. Hearth checks sizes plus
  a per-index "complete" marker, so the second Play skips straight to Java.
- Mojang/Fabric metadata is cached, so you can launch offline after the first time.
- Natives are extracted once per version, not on every launch.
- Preset mods download 8 at a time instead of one after another.
- Atomic downloads (temp file, then rename): a crash never leaves half a jar.
- Tuned JVM: Mojang's own G1 settings plus safe extras, `-Xms = -Xmx`, and an
  optional generational ZGC on Java 21+. The game starts with above-normal
  priority (optional).
- UI: settings are saved with a debounce off the UI thread. The PWA service
  worker and inspector plugin are gone. Only Latin font subsets are bundled.
  Animations pause while Minecraft runs, while Hearth is minimised, and with
  reduced motion on.
- Hearth can minimise itself while you play and comes back when the game closes.

## Mods & settings
- New optimisation mods: More Culling, BadOptimizations (both added to presets),
  ScalableLux and Alternate Current (optional).
- New instances start with `maxFps:260` (unlimited), VSync off, biome blend 1 and
  similar settings. Your in-game changes are kept afterwards.
- Live Minecraft version list from Mojang, including the 26.x releases.
- Real RAM and CPU detection picks the recommended preset and caps the memory slider.

## Look
- New campfire design: night scene with animated fire, ember palette, new logo
  and app icon, player head from your skin, progress bar with percentages.

# Hearth 0.2.1
- **Play via Minecraft Launcher**: one click prepares the instance's mods and
  settings, installs the Fabric version into `.minecraft/versions`, and adds a
  "Hearth · <instance>" installation to the official launcher. That installation
  uses Hearth's instance folder, memory and JVM flags. Sign-in and launch go through
  Mojang's launcher, so it works before Mojang approves Hearth's own client ID.
  `launcher_profiles.json` is backed up once (`.hearth-backup`) and other
  installations are left untouched.
