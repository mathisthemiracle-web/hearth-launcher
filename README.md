# Hearth Launcher

See CHANGES-0.2.0.md for what changed in 0.2.

Hearth is a Windows-first Minecraft: Java Edition launcher built with **Rust, Tauri 2, React, and TypeScript**. It combines isolated instances, real Microsoft authentication, existing optimisation mods, shader packs, and honest performance presets in a dark, warm game-library interface.

## Implemented

- Six performance presets: Feather, Everyday, Golden Hour, Open Country, Wanderer, and Cartographer
- Isolated instance configurations with Minecraft version, loader, RAM, render distance, simulation distance, shaders, and Distant Horizons radius
- Live Modrinth search filtered by Minecraft version and mod loader
- Compatible release resolution, primary-file downloads, and recursive required-dependency installation
- Microsoft device-code sign-in, Xbox Live and XSTS authorization, Minecraft Services login, Java Edition ownership verification, profile retrieval, and token refresh
- Windows Credential Manager storage for Microsoft session credentials; Hearth never asks for or receives the account password
- Mojang version/client/library downloads with SHA-1 verification, concurrent asset installation, native-library extraction, and automatic Eclipse Temurin Java setup
- Fabric loader resolution and real Java process launch with authenticated session arguments
- Live launch-stage feedback in the desktop app
- Preservation of unrelated `options.txt` entries when updating render and simulation distance
- Shader-pack selection with automatic Iris inclusion
- JSON settings export/import, dark/light themes, reduced motion, and responsive layouts

## Microsoft application ID — one-time setup

Microsoft authentication requires a public-client application identity. Hearth does not impersonate the official Minecraft launcher or reuse another project’s client ID.

1. Create a free app registration in Microsoft Entra.
2. Configure it to support personal Microsoft accounts and enable public-client/device flows.
3. Copy its **Application (client) ID** into **Hearth → Settings → Microsoft account**.
4. Submit the client ID for Minecraft API access at https://aka.ms/mce-reviewappid. Until Mojang approves it, Microsoft and Xbox sign-in work but Minecraft answers 403 (Hearth explains this when it happens).
5. Click **Connect Microsoft**, enter the displayed device code in the browser (it is already copied), and approve sign-in.

The account must own Minecraft: Java Edition. No Microsoft account was available in the build environment, so authentication and game start cannot be end-to-end account-tested here.

## Launch support

The game launcher currently starts **Fabric** instances. Forge, NeoForge, and Quilt remain available for custom configurations and compatible Modrinth searches, but Hearth reports their game-launch support boundary rather than pretending to start them.

The first launch downloads Minecraft, libraries, assets, Fabric, and Java, so it can take time and requires an internet connection. Later launches reuse verified files.

## Build on Windows

Install Node.js 20+, stable Rust, Microsoft C++ Build Tools, and WebView2, then run:

```bash
npm ci
npm run tauri build
```

The NSIS installer is generated under `src-tauri/target/release/bundle/nsis/`.

## Cross-build from Linux

With LLVM/LLD, NSIS, and the Windows MSVC Rust target installed:

```bash
rustup target add x86_64-pc-windows-msvc
cargo install --locked cargo-xwin
npm run tauri build -- --runner cargo-xwin --target x86_64-pc-windows-msvc
```

The installer is generated under `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/`.

## Browser preview

```bash
npm ci
npm run dev
```

The preview stores configuration in this browser’s `localStorage`. It does not download mods, authenticate accounts, or launch Minecraft. Desktop configuration is saved in Hearth’s OS app-data folder.

## Performance policy

Hearth does not promise unlimited chunks, universal mod compatibility, or a fixed FPS increase. Sodium, Iris, Distant Horizons, and shader-pack compatibility vary by Minecraft release. Distant terrain remains constrained by CPU, memory, GPU, and generation time. Test changes per instance and keep backups of important worlds.

## Project layout

- `src/` — React interface, state, presets, browser preview adapter, and dark design system
- `src-tauri/src/auth.rs` — Microsoft/Xbox/Minecraft authentication and credential storage
- `src-tauri/src/game.rs` — game files, assets, Java, Fabric, arguments, and process launch
- `src-tauri/src/modrinth.rs` — compatible mod/shader downloads and dependencies
- `src-tauri/src/storage.rs` — settings and isolated instance storage
- `.github/workflows/build-windows.yml` — manually triggered Windows build
