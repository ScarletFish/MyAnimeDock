<h1 align="center">MyAnimeDock</h1>

<p align="center">
  <b>A local-first anime collection manager</b><br>
  Smart scanning, Bangumi metadata matching, mpv progress tracking — a modern, all-in-one local anime library.
</p>

<div align="center">
<img alt="Windows 10+" src="https://img.shields.io/badge/Windows-10%2B-blue?logo=windows">
<img alt="Tauri v2" src="https://img.shields.io/badge/Tauri-v2-orange?logo=tauri">
<img alt="Node.js" src="https://img.shields.io/badge/Node.js-18-green?logo=nodedotjs">
<img alt="mpv" src="https://img.shields.io/badge/mpv-player-brightgreen?logo=mpv">
<img alt="Bangumi" src="https://img.shields.io/badge/Bangumi-metadata-yellow">
<img alt="License" src="https://img.shields.io/badge/License-ISC-lightgrey">
</div>

<p align="center">
🇨🇳 <a href="./README.md">简体中文</a> | 🇺🇸 <a href="./README.en.md">English</a>
</p>

---

## Table of Contents

- [Introduction](#introduction)
- [Design Philosophy](#design-philosophy)
- [Features](#features)
- [Supported Folder Naming](#supported-folder-naming)
- [Quick Start](#quick-start)
- [Tech Stack](#tech-stack)
- [License](#license)

---

## Introduction

**MyAnimeDock** is a Windows desktop app for managing the anime library you've downloaded locally — it automatically matches Bangumi metadata and tracks playback progress through mpv.

> [!IMPORTANT]
> **Requires the [mpv](https://mpv.io) player**. MyAnimeDock does not include a built-in player — please install mpv yourself; we recommend the [hooke007/MPV_lazy](https://github.com/hooke007/MPV_lazy) pack for a ready-to-use setup.

![Library Home](images/README/library.png)

---

## Design Philosophy

MyAnimeDock is designed around the following principles:

| Principle | Description |
|-----------|-------------|
| **Local-First** | All data stays in local SQLite — no account registration, no cloud sync dependency |
| **Player Relay** | The playback experience is entirely up to the player itself; currently mpv only, with more external players possibly integrated in the future |
| **Low-Cost Scraping** | Automatically recognizes local anime folders to match metadata — no strict folder renaming required |
| **Full Lifecycle Coverage** | Covers all statuses: planned, watching, completed, on hold, and dropped |
| **Desktop-Native** | A native desktop app — no web server or Docker deployment needed, ready to use out of the box |

---

## Features

- **Smart Scanning**: Recursively walks your media directory and uses anitomy to parse titles, seasons, and subtitle groups; folders named with `[bgmN]` are auto-matched to Bangumi precisely.
- **Metadata Matching**: Pulls covers, synopses, ratings, tags, and cast from Bangumi; the batch matching workbench supports SSE streaming sync, cancellation, and retry; fuzzy matching and mirror-site settings are supported.
- **Library Home**: The default startup view, with multiple quick-access modules and a customizable, modular home design.
- **mpv Playback & Progress Tracking**: Tracks progress in real time via the IPC pipe, persisting every 10 seconds and on final save at close; auto-marks watched episodes and supports resume.
- **Full Status Management**: Covers the full lifecycle from import to completion, with 5 statuses plus ratings, progress, dates, and notes.
- **Statistics Dashboard**: A complete statistics page showing the tag word cloud, watch activity, rating distribution, season distribution, and more.
- **Theme System**: 6 color themes + independent dark/light mode, switchable instantly from the bottom Dock.
- ~~**Bangumi Two-Way Sync**: After authorization, Pull → Merge → Push, with every operation auto-synced.~~
  Development in this direction is temporarily paused due to network access restrictions on the Bangumi main site and related security concerns.
- **Startup Auto-Import**: On startup, asynchronously scans for new folders with `[bgmN]` and imports them automatically.
- **Pinyin Search**: Matches `title` / `bangumiTitle` / `pinyinTitle` simultaneously, with full pinyin search support.

## Supported Folder Naming

MyAnimeDock automatically recognizes titles, seasons, and subtitle groups from folder names. The following formats are all recognized:

```
[SubGroup] Anime Title S01
Anime Title/Season 1
[VCB-Studio] Another Title [Ma10p_1080p]
Anime Title [bgm12345]/
```

- Folders containing `[bgmN]` are precisely matched to the corresponding Bangumi entry — no manual search needed
- Non-episode videos such as `NCOP` / `NCED` / `PV` are automatically excluded and not counted as episodes

---

## Quick Start

### Installation (Recommended)

Download the MSI or NSIS installer from [Releases](https://github.com/ScarletFish/MyAnimeDock/releases) and double-click to install. Requires Windows 10+ (WebView2 is built in).

---

## Tech Stack

- **Backend** — Node.js (native `http` module), single-file HTTP service
- **Frontend** — Svelte 5 + Vite + Tailwind CSS v4 (SPA)
- **Desktop Shell** — Tauri v2 (Rust)
- **Database** — SQLite (better-sqlite3 native SQL)
- **Animation** — GSAP + Flip plugin
- **Player** — mpv, with real-time progress tracking via IPC
- **Metadata** — Bangumi API + AniList GraphQL (romaji support)
- **Parsing** — anitomy (TypeScript port)
- **Visualization** — D3.js + wordcloud2.js (charts and word clouds)
- **Search** — pinyin (pinyin transliteration)
- **Packaging** — pkg (Node.js sidecar)

---

## License

[ISC](LICENSE)

---

<p align="center">
  <sub>Built by <a href="https://github.com/ScarletFish">ScarletFish</a></sub>
</p>
