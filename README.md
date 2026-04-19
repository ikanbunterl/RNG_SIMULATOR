# 🎰 RNG-GAME v2.1
> *Spin Your Destiny* 🎲✨

A fully client-side, browser-based RNG spin game featuring a deep progression system, rarity collections, dynamic events, and customizable shop mechanics. Built with vanilla web technologies for maximum performance and modularity.

## 🚀 Features
- **🎲 Advanced RNG Engine** – Weighted probability system with 11 rarities (Common → Transcendent)
- **🛡️ Pity & Streak Systems** – Guaranteed drops after 50 spins, combo luck multipliers
- **🛒 Dynamic Shop** – Luck boosts (spin/time-based), pity skips, auto-speed upgrades
- **🎒 Inventory & Set Bonuses** – Collect event items to unlock permanent luck bonuses
- **👑 Rebirth/Prestige** – Reset progress for permanent luck multipliers & unlock new rarities
- **🌸 Event System** – Dedicated AprilEVENT page with exclusive items & import/export
- **⚡ Spin Modes** – Single, Bulk (x10/x100), Auto, and Fast Spin toggle
- **💾 Save/Load System** – LocalStorage autosave + text-based import/export for sharing
- **🔊 Audio & Visual FX** – Web Audio API sound engine, screen shake, flash effects, haptic feedback, floating gems
- **📱 Responsive Design** – Mobile-friendly with pixel & retro fonts

## 🛠️ Tech Stack
- `HTML5` / `CSS3` (Custom animations, CSS variables, responsive layout)
- `Vanilla JavaScript` (ES6+, modular architecture, Web Audio API)
- `JSON` (`config.json` for settings/shop, `RNG.json` for rarities/events)
- `LocalStorage` for persistent player data

## ▶️ How to Run
1. Clone or download the repository
2. Place all files (`index.html`, `style.css`, `script.js`, `config.json`, `RNG.json`) in the same folder
3. Open `index.html` in a modern browser
> ⚠️ **Note:** Due to browser CORS policies when using `fetch()`, it's recommended to run this via a local server (e.g., VS Code Live Server, Python `http.server`, or Node `serve`).

## ⚙️ Configuration
- **`config.json`** – Controls shop items, set collections, game settings (pity threshold, spin intervals, log limits, etc.)
- **`RNG.json`** – Defines all rarities, event rarities, odds, gem rewards, and exclusive event items
> Both files are loaded dynamically on startup. Edit them to balance odds, add new items, or tweak shop prices without touching the core script.

## 🧑‍💻 Dev Team & Contributors
| Role | Member |
|------|--------|
| 🏆 Project Leader | **Sarah** |
| 🎨 UI/UX Handler | **Vanessa** |
| ⚙️ Script Handler | **George** |
| 💡 Idea & Script Handler | **Irkham** |
| 🌐 HTML/CSS/JS Contributor & Idea Support | **Anonymous** *(dengan bantuan minor AI untuk brainstorming & optimasi kode)* |

## 📜 License & Usage
This project is intended for educational and personal use. Feel free to fork, modify, and experiment with the RNG mechanics, shop balance, or visual themes. Credit the original dev team if you redistribute.

---
*Made with ❤️ by the RNG-GAME Team | v2.1 • 2026*
