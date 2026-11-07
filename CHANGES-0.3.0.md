# Hearth 0.3.0

## Performance
- **Background warm-up.** Game files, libraries, assets and Java start downloading
  when an instance is created, selected or gets a preset, so the first Play mostly
  just starts Java.
- **High-performance GPU.** Before launch, Hearth sets the Windows per-app graphics
  preference for Hearth's Java to "High performance". This is the same setting as
  Settings → Display → Graphics. It stops laptops from running Minecraft on the
  integrated GPU. On by default, with a switch in Settings.
- **FPS boost (per instance).** Fast graphics, minimal particles, no clouds, no entity
  shadows, no smooth lighting, mipmaps off. Written to `options.txt` on every launch
  while it is on.
- Hearth's campfire animation and sound stop while Minecraft runs.

## New
- **Library page:** worlds (size, last played, icon), backups to zip in one click,
  restore as a new world (never overwrites), screenshots gallery, playtime and launch
  stats per instance.
- **Automatic world backups** before a preset or "Update all mods" changes anything.
  The last 5 automatic backups per world are kept.
- **Crash doctor:** reads the newest crash report and logs and recognises incompatible
  mods, duplicate mods, out-of-memory, wrong Java, mixin failures, graphics-driver
  problems, native crashes/overlays, shader compile errors and missing dependencies.
  It names the suspect mods and opens automatically when the game closes right after
  starting.
- **Update all mods** in one click (old jars are replaced).
- **Modrinth modpacks (.mrpack) import:** downloads the pack's files (only from hosts
  Modrinth allows), applies overrides and creates the instance.
- **Resource packs tab:** search Modrinth, install, reorder and turn packs on/off.
  Hearth writes them into `options.txt`.
- **Quilt instances** launch too. Fabric mods are used where no Quilt build exists.
- **Français (Québec) / English** switch. The interface is fully translated, and the
  language is picked automatically from Windows the first time.
- **Campfire sounds:** a soft procedural crackle (no audio files). Off by default,
  and silent while you play.
- The official-launcher bridge also works for Quilt.

## Not done, on purpose
- **Hearth's own mods:** writing one is possible, but it could not be compiled or
  tested here (no access to Fabric's Maven/Gradle). Shipping an untested mod could
  crash your game, so none is included.
- **Auto-updater:** it needs a signing key and a place to publish releases
  (e.g. a GitHub repo). It can be added once those exist.
- **NeoForge/Forge launching:** their installers run "processors" that patch the game,
  which is much more involved than Fabric/Quilt. Use "Play via Minecraft Launcher"
  for them for now.

# Hearth 0.3.1
- **Fix:** Distant Horizons always showed as "no build". Hearth used the wrong
  Modrinth ID (`distant-horizons` instead of `distanthorizons`). Existing instances
  are migrated automatically and DH downloads on the next Play.
- Skipped mods now say whether they are "not found on Modrinth" or have
  "no build for this version".
- **Voxy** is added as an alternative far-terrain engine. It is Fabric-only, alpha,
  needs OpenGL 4.6, and supports recent versions only.
- **Far terrain switch** in each instance: Off / Distant Horizons / Voxy. Only one can
  be installed at a time.
- **Automatic fallback:** if the chosen far-terrain mod has no build for the
  instance's Minecraft version, Hearth installs the other one and tells you.
