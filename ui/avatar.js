// avatar.js - PS1-Style Anime Avatar Creator inspired by Where Winds Meet
// Integrates AI image-to-avatar analysis, procedural low-poly 3D generation,
// deep Y2K / grunge / fairycore customization, retro sound effects, and GLTF/PNG export.

import { $, el, toast, busy } from "./util.js";
import { Avatar3D } from "./avatar3d.js";

// Retro Web Audio Sound Effects Synthesizer
class RetroAudio {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }

  _ensure() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) this.ctx = new AudioCtx();
    }
    if (this.ctx && this.ctx.state === "suspended") {
      this.ctx.resume();
    }
  }

  playBlip(freq = 440, type = "square", duration = 0.06) {
    if (this.muted) return;
    this._ensure();
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.5, this.ctx.currentTime + duration);
    gain.gain.setValueAtTime(0.12, this.ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.01, this.ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + duration);
  }

  playRandomize() {
    if (this.muted) return;
    this._ensure();
    if (!this.ctx) return;
    const notes = [261.63, 329.63, 392.0, 523.25, 659.25, 783.99];
    notes.forEach((freq, idx) => {
      setTimeout(() => this.playBlip(freq, "triangle", 0.08), idx * 45);
    });
  }

  playSuccess() {
    if (this.muted) return;
    this._ensure();
    if (!this.ctx) return;
    const notes = [440, 554.37, 659.25, 880];
    notes.forEach((freq, idx) => {
      setTimeout(() => this.playBlip(freq, "sine", 0.12), idx * 60);
    });
  }
}

export function initAvatar(api) {
  let avatar3d = null;
  let presets = {};
  let currentConfig = null;
  let activeTab = "presets";
  let uploadedImageB64 = null;
  const audio = new RetroAudio();

  const root = $("panel-avatar");
  if (!root) return { load: () => {} };

  // Setup DOM structure
  root.innerHTML = `
    <header class="avatar-header">
      <div class="avatar-title-group">
        <h2><span class="retro-icon">✦</span> PS1 Anime Avatar Creator <span class="retro-icon">✦</span></h2>
        <span class="avatar-subtitle">Where Winds Meet × Y2K · Grunge · Fairycore Aesthetic</span>
      </div>
      <div class="avatar-header-actions">
        <button type="button" class="ghost small audio-mute-btn" id="avatarAudioBtn" title="Toggle Sound FX">🔊 SFX</button>
        <button type="button" class="ghost small" id="avatarToggleSpecsBtn" title="Toggle Character Specs">✦ Specs</button>
        <button class="close" aria-label="Close">×</button>
      </div>
    </header>

    <div class="avatar-creator-layout">
      <!-- Left Panel: Categories & Upload -->
      <aside class="avatar-left-pane">
        <nav class="avatar-category-nav" role="tablist">
          <button type="button" class="avatar-nav-btn active" data-tab="presets">✧ Presets</button>
          <button type="button" class="avatar-nav-btn" data-tab="upload">📸 Reference Photo</button>
          <button type="button" class="avatar-nav-btn" data-tab="appearance">💇 Appearance</button>
          <button type="button" class="avatar-nav-btn" data-tab="clothing">👗 Clothing</button>
          <button type="button" class="avatar-nav-btn" data-tab="accessories">🦋 Accessories</button>
          <button type="button" class="avatar-nav-btn" data-tab="retro">📺 Retro PS1 FX</button>
        </nav>

        <div class="avatar-tab-content" id="avatarTabContent"></div>
      </aside>

      <!-- Center: 3D Viewport -->
      <main class="avatar-viewport-container">
        <canvas id="avatarCanvas" class="avatar-canvas" aria-label="Interactive 3D Avatar"></canvas>

        <!-- CRT Scanline & Dither Overlay -->
        <div class="avatar-crt-overlay" id="avatarCrtOverlay"></div>

        <!-- Floating Viewport Controls -->
        <div class="avatar-viewport-hud">
          <div class="avatar-view-angles">
            <button type="button" class="hud-btn" data-view="front" title="Front View">Front</button>
            <button type="button" class="hud-btn" data-view="angle" title="3/4 View">3/4</button>
            <button type="button" class="hud-btn" data-view="side" title="Side Profile">Side</button>
            <button type="button" class="hud-btn" data-view="back" title="Back View">Back</button>
            <button type="button" class="hud-btn" data-view="face" title="Face Close-up">Face</button>
            <button type="button" class="hud-btn" id="avatarResetCam" title="Reset View">↺ Reset</button>
          </div>

          <div class="avatar-hud-status" id="avatarHudStatus">
            <span class="status-indicator">●</span> <span id="avatarStatusText">Ready</span>
          </div>
        </div>
      </main>

      <!-- Right Panel: Detailed Controls -->
      <aside class="avatar-right-pane" id="avatarRightPane"></aside>
    </div>

    <!-- Bottom Toolbar -->
    <footer class="avatar-bottom-bar">
      <div class="avatar-bar-left">
        <button type="button" class="avatar-btn randomize-btn" id="avatarRandomizeBtn">🎲 Randomize</button>
        <button type="button" class="avatar-btn" id="avatarResetBtn">↺ Reset</button>
      </div>

      <div class="avatar-bar-center">
        <div class="preset-selector-group">
          <label for="avatarPresetSelect">Preset:</label>
          <select id="avatarPresetSelect"></select>
          <button type="button" class="avatar-btn small" id="avatarSavePresetBtn">💾 Save</button>
          <button type="button" class="avatar-btn small danger" id="avatarDeletePresetBtn">🗑</button>
        </div>
      </div>

      <div class="avatar-bar-right">
        <button type="button" class="avatar-btn primary char-integrate-btn" id="avatarUseAsCharBtn" title="Set this 3D avatar as your active companion in Vermeil">✦ Set as Character</button>
        <button type="button" class="avatar-btn" id="avatarExportGLBBtn" title="Export low-poly 3D model for Blender or game engines">📦 .GLB</button>
        <button type="button" class="avatar-btn" id="avatarSnapshotBtn" title="Capture high-resolution retro character portrait">🖼 PNG</button>
      </div>
    </footer>
  `;

  function ensure3D() {
    if (!avatar3d) {
      const canvas = $("avatarCanvas");
      if (canvas) {
        try {
          avatar3d = new Avatar3D(canvas);
        } catch (e) {
          console.warn("Avatar3D init:", e);
        }
      }
    }
    return avatar3d;
  }

  // Setup Sound Toggle
  const sfxBtn = $("avatarAudioBtn");
  sfxBtn.addEventListener("click", () => {
    audio.muted = !audio.muted;
    sfxBtn.textContent = audio.muted ? "🔇 Muted" : "🔊 SFX";
    sfxBtn.classList.toggle("muted", audio.muted);
  });

  // Setup Navigation Tabs
  const navBtns = root.querySelectorAll(".avatar-nav-btn");
  navBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      audio.playBlip(520, "square", 0.04);
      navBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      activeTab = btn.dataset.tab;
      renderActiveTab();
    });
  });

  // Setup Viewport Buttons
  root.querySelectorAll(".avatar-view-angles [data-view]").forEach((btn) => {
    btn.addEventListener("click", () => {
      audio.playBlip(600, "triangle", 0.04);
      ensure3D()?.setView(btn.dataset.view);
    });
  });
  $("avatarResetCam").addEventListener("click", () => {
    audio.playBlip(440, "sine", 0.05);
    ensure3D()?.resetCamera();
  });

  // Bottom Toolbar Actions
  $("avatarRandomizeBtn").addEventListener("click", () => {
    audio.playRandomize();
    randomizeCharacter();
  });

  $("avatarResetBtn").addEventListener("click", () => {
    audio.playBlip(360, "square", 0.06);
    if (presets[currentConfig.id]) {
      applyConfig(JSON.parse(JSON.stringify(presets[currentConfig.id])));
      toast("Reset character to preset defaults.");
    }
  });

  $("avatarSavePresetBtn").addEventListener("click", async () => {
    audio.playBlip(700, "sine", 0.08);
    const name = prompt("Name your custom avatar preset:", currentConfig.name || "My Y2K Fairy");
    if (!name) return;
    const cleanId = name.toLowerCase().replace(/[^a-z0-9_]/g, "_");
    const toSave = { ...currentConfig, id: cleanId, name };
    presets = await api.avatar_save_preset(cleanId, toSave);
    updatePresetSelect();
    toast(`Saved preset "${name}".`);
  });

  $("avatarDeletePresetBtn").addEventListener("click", async () => {
    const sel = $("avatarPresetSelect").value;
    if (["y2k_cyber_fairy", "grunge_fairycore", "dark_fairy", "pastel_dream", "retro_anime_protagonist"].includes(sel)) {
      alert("Built-in aesthetic presets cannot be deleted.");
      return;
    }
    if (!confirm(`Delete preset "${presets[sel]?.name || sel}"?`)) return;
    presets = await api.avatar_delete_preset(sel);
    updatePresetSelect();
    toast("Deleted preset.");
  });

  $("avatarPresetSelect").addEventListener("change", (e) => {
    const p = presets[e.target.value];
    if (p) {
      audio.playBlip(480, "triangle", 0.05);
      applyConfig(JSON.parse(JSON.stringify(p)));
    }
  });

  // Toggle specs on responsive/mobile layouts
  $("avatarToggleSpecsBtn")?.addEventListener("click", () => {
    const pane = $("avatarRightPane");
    if (pane) {
      pane.classList.toggle("open-responsive");
      $("avatarToggleSpecsBtn").classList.toggle("active", pane.classList.contains("open-responsive"));
    }
  });

  async function integrateAvatarAsCharacter() {
    audio.playSuccess();
    const defaultName = currentConfig.name || "Neko Shaman";
    const name = prompt("Name your character for the Vermeil character roster:", defaultName);
    if (!name || !name.trim()) return;

    toast("Exporting 3D avatar (.GLB) and registering to Characters...", 3000);
    const glbRes = await ensure3D()?.exportGLBData();
    if (!glbRes || !glbRes.ok) {
      toast(`Failed to package 3D model: ${glbRes?.error || "Unknown error"}`);
      return;
    }

    try {
      const promptText = `You are ${name.trim()}, a cool, sleepy-eyed anime companion with cat ears, an alt-grunge aesthetic, and relaxed demeanor. You speak in concise dialogue under 45 words.`;
      const res = await api.avatar_apply_as_character(name.trim(), glbRes.glbBase64, promptText);
      if (res && res.ok) {
        audio.playSuccess();
        toast(`✨ Saved "${name.trim()}" to Characters! Now active in your room.`);
        if (window.onAvatarCharacterSaved) {
          window.onAvatarCharacterSaved(res);
        }
      } else {
        toast(`Error saving character: ${res?.error || "Unknown error"}`);
      }
    } catch (err) {
      toast(`Integration failed: ${err?.message || err}`);
    }
  }

  $("avatarUseAsCharBtn")?.addEventListener("click", integrateAvatarAsCharacter);

  $("avatarExportGLBBtn").addEventListener("click", () => {
    audio.playSuccess();
    toast("Packaging 3D model (.GLB)...");
    ensure3D()?.exportGLB((res) => {
      if (res.ok) toast("Exported low-poly avatar as .GLB!");
      else toast(`Export failed: ${res.error}`);
    });
  });

  $("avatarSnapshotBtn").addEventListener("click", () => {
    audio.playSuccess();
    const dataUrl = ensure3D()?.captureSnapshot(800, 800);
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `ps1_avatar_${currentConfig.id || "portrait"}.png`;
    a.click();
    toast("Saved avatar snapshot as PNG!");
  });

  // ---------------- Configuration Management ----------------
  function applyConfig(cfg) {
    currentConfig = { ...cfg };
    ensure3D()?.loadAvatar(currentConfig);
    renderActiveTab();
    renderRightPane();
    updateCrtOverlay();
    const name = currentConfig.name || currentConfig.id || "Custom";
    $("avatarStatusText").textContent = name;
  }

  function updateConfig(changes) {
    Object.assign(currentConfig, changes);
    ensure3D()?.loadAvatar(currentConfig);
    renderRightPane();
  }

  function updatePresetSelect() {
    const sel = $("avatarPresetSelect");
    sel.innerHTML = "";
    Object.values(presets).forEach((p) => {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.name;
      if (currentConfig && currentConfig.id === p.id) opt.selected = true;
      sel.appendChild(opt);
    });
  }

  function updateCrtOverlay() {
    const crt = $("avatarCrtOverlay");
    if (currentConfig.crt_effect !== false) {
      crt.classList.add("active");
    } else {
      crt.classList.remove("active");
    }
  }

  // ---------------- Randomizer ----------------
  function randomizeCharacter() {
    const hairStyles = ["cat_wolf_cut", "twin_buns", "wolf_cut", "pigtails", "hime_cut", "messy_bob", "fairy_locs", "short_spiky"];
    const hairColors = ["#14151b", "#ff77aa", "#3b261d", "#121217", "#c8b6ff", "#2b3a67", "#00ffee", "#ff0055", "#e8d8c8", "#ff9e00"];
    const eyeColors = ["#1b1c24", "#00f0ff", "#5b7c52", "#9d4edd", "#ff9ebb", "#48cae4", "#ff007f", "#d4af37"];
    const tops = ["asym_bell_sleeve", "oversized_tee", "layered_baby_tee", "corset_cami", "track_jacket", "fishnet_knit"];
    const bottoms = ["baggy_skater_pants", "pleated_skirt", "cargo_pants", "tulle_skirt", "denim_shorts"];
    const shoes = ["platform_boots", "cyber_sneakers", "ballet_flats", "leg_warmers"];
    const wings = [true, false];
    const wingStyles = ["cyber_wings", "fairy_moth", "bat_fairy", "butterfly"];
    const allAcc = ["golden_spear", "butterfly_clips", "headphones", "choker", "chain_belt", "star_pins"];
    const allMakeup = ["blush", "freckles", "goth_eyeliner", "fairy_glitter", "cyber_markings", "dark_lips"];
    const lightings = ["ps1_street", "ps1_bios", "cyber_void", "fairy_garden", "dark_fairy", "grunge_room"];

    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
    const pickMulti = (arr, count) => {
      const shuffled = [...arr].sort(() => 0.5 - Math.random());
      return shuffled.slice(0, Math.floor(Math.random() * (count + 1)));
    };

    const randomized = {
      ...currentConfig,
      hair_style: pick(hairStyles),
      hair_color: pick(hairColors),
      eye_color: pick(eyeColors),
      eye_style: pick(["sleepy_grunge", "sparkle", "grunge_dark", "retro_game", "fairy_mystic"]),
      top: pick(tops),
      top_color: pick(["#c5aee0", "#111116", "#2a1b3d", "#1b3d2f", "#442222", "#ffd6e0", "#ffffff"]),
      top_accent: pick(hairColors),
      bottom: pick(bottoms),
      bottom_color: pick(["#13141a", "#111116", "#2a1b3d", "#383f34", "#202028", "#c8b6ff"]),
      shoes: pick(shoes),
      shoes_color: pick(["#0a0b0e", "#111111", "#ffffff", "#2b2b2b", "#d88da6"]),
      shoes_accent: pick(hairColors),
      wings: pick(wings),
      wing_style: pick(wingStyles),
      wing_color: pick(eyeColors),
      accessories: pickMulti(allAcc, 3),
      makeup: pickMulti(allMakeup, 3),
      lighting: pick(lightings),
    };

    applyConfig(randomized);
    toast("🎲 Randomized avatar!");
  }

  // ---------------- Tab Renderers (Left Pane) ----------------
  function renderActiveTab() {
    const pane = $("avatarTabContent");
    pane.innerHTML = "";

    if (activeTab === "presets") {
      renderPresetsTab(pane);
    } else if (activeTab === "upload") {
      renderUploadTab(pane);
    } else if (activeTab === "appearance") {
      renderAppearanceTab(pane);
    } else if (activeTab === "clothing") {
      renderClothingTab(pane);
    } else if (activeTab === "accessories") {
      renderAccessoriesTab(pane);
    } else if (activeTab === "retro") {
      renderRetroTab(pane);
    }
  }

  function renderPresetsTab(container) {
    const div = el("div", { class: "presets-tab" });
    const pIntro = el("p", { class: "tab-intro" }, "Select an iconic aesthetic preset to instantly transform geometry, colors, wings, and lighting.");
    div.appendChild(pIntro);

    const grid = el("div", { class: "preset-cards-grid" });
    Object.values(presets).forEach((preset) => {
      const isSelected = currentConfig && currentConfig.id === preset.id;
      const card = el("div", {
        class: `preset-card ${isSelected ? "selected" : ""}`,
        onclick: () => {
          audio.playBlip(580, "square", 0.05);
          applyConfig(JSON.parse(JSON.stringify(preset)));
          updatePresetSelect();
        },
      });

      const icon = el("div", { class: "preset-icon" }, preset.wings ? "🧚" : "🎮");
      const title = el("h4", {}, preset.name);
      const desc = el("p", {}, preset.description || "");

      // Color swatch preview
      const swatches = el("div", { class: "preset-swatches" });
      [preset.hair_color, preset.eye_color, preset.top_accent, preset.top_color].forEach((c) => {
        if (c) {
          const s = el("span", { class: "swatch", style: `background: ${c}` });
          swatches.appendChild(s);
        }
      });

      card.append(icon, title, desc, swatches);
      grid.appendChild(card);
    });

    div.appendChild(grid);
    container.appendChild(div);
  }

  function renderUploadTab(container) {
    const div = el("div", { class: "upload-tab" });

    // AI Status Indicator Banner
    const infoBanner = el("div", { class: "ai-status-banner" });
    infoBanner.innerHTML = `
      <div class="banner-badge">✦ Dual Pipeline</div>
      <p class="banner-text">
        <strong>Multimodal AI Vision</strong> runs automatically if <code>GROQ_API_KEY</code> or <code>OPENAI_API_KEY</code> is present in your <code>env</code> file.<br>
        Otherwise, an offline <strong>Computer Vision & Color Segmentation</strong> fallback analyzes face landmarks and palettes with zero external calls.
      </p>
    `;
    div.appendChild(infoBanner);

    // Aesthetic selector for generation
    const aethRow = el("div", { class: "field-row" });
    const aethLabel = el("label", {}, "Target Aesthetic:");
    const aethSelect = el("select", { id: "avatarAestheticSelect" });
    [
      ["y2k_grunge_shaman", "PS1 Anime Match (Cat-Wolf Cut, Asym Bell Top, Baggy Pants)"],
      ["y2k_cyber_fairy", "Y2K Cyber Fairy"],
      ["grunge_fairycore", "Grunge Fairycore"],
      ["dark_fairy", "Dark Fairy"],
      ["pastel_dream", "Pastel Dream"],
      ["retro_anime_protagonist", "Retro Anime Protagonist"],
    ].forEach(([val, label]) => {
      const opt = el("option", { value: val }, label);
      if (currentConfig && currentConfig.id === val) opt.selected = true;
      aethSelect.appendChild(opt);
    });
    aethRow.append(aethLabel, aethSelect);
    div.appendChild(aethRow);

    // Style Reference Card (Dual Reference Pipeline visual representation)
    const styleRefCard = el("div", { class: "reference-comparison-card" });
    styleRefCard.innerHTML = `
      <div class="ref-role-badge">🎨 Target Style Reference: PS1 3D Anime</div>
      <div class="style-ref-thumb-row">
        <img class="style-ref-thumb" src="assets/ps1_style_reference.png" alt="PS1 Style Reference">
        <div class="style-ref-details">
          <strong>PS1-Era Anime Character Target</strong>
          <p>Slender low-poly silhouette, narrow waist, spiky cat-wolf cut, sleepy lashes, lilac bell-sleeve crop top & flowing baggy skater pants.</p>
        </div>
      </div>
    `;
    div.appendChild(styleRefCard);

    // Dropzone / File Picker (Identity Reference)
    const dropzone = el("div", { class: "avatar-dropzone", id: "avatarDropzone" });
    dropzone.innerHTML = `
      <div class="ref-role-badge identity" style="margin-bottom: 6px;">👤 Identity Reference: Your Photo</div>
      <div class="dropzone-content">
        <span class="dropzone-icon">📷</span>
        <p class="dropzone-title">Upload your photo for identity & feature extraction</p>
        <p class="dropzone-sub">Extracts facial features and translates them into the retro PS1 anime aesthetic</p>
        <input type="file" id="avatarFileInput" accept="image/jpeg,image/png,image/webp" hidden>
        <button type="button" class="avatar-btn small" id="avatarBrowseBtn">Browse Files</button>
      </div>
    `;

    // Drop events
    dropzone.addEventListener("dragover", (e) => {
      e.preventDefault();
      dropzone.classList.add("drag-hover");
    });
    dropzone.addEventListener("dragleave", () => dropzone.classList.remove("drag-hover"));
    dropzone.addEventListener("drop", (e) => {
      e.preventDefault();
      dropzone.classList.remove("drag-hover");
      if (e.dataTransfer.files?.[0]) handleFile(e.dataTransfer.files[0]);
    });

    const fileInput = dropzone.querySelector("#avatarFileInput");
    dropzone.querySelector("#avatarBrowseBtn").addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", (e) => {
      if (e.target.files?.[0]) handleFile(e.target.files[0]);
    });

    div.appendChild(dropzone);

    // Preview area (hidden initially or shown if image loaded)
    const previewArea = el("div", { class: "upload-preview-area", id: "avatarPreviewArea" });
    if (!uploadedImageB64) previewArea.hidden = true;
    previewArea.innerHTML = `
      <div class="preview-card">
        <img id="avatarUploadedImg" src="${uploadedImageB64 || ""}" alt="Uploaded Reference">
        <div class="preview-actions">
          <button type="button" class="avatar-btn small danger" id="avatarClearImgBtn">✕ Remove</button>
        </div>
      </div>
      <button type="button" class="avatar-btn primary generate-btn" id="avatarGenerateBtn">
        ✨ Generate PS1 Anime Avatar
      </button>
      <div class="gen-progress" id="avatarGenProgress" hidden>
        <div class="spinner"></div>
        <span id="avatarGenStatusText">Analyzing photo landmarks & color palettes...</span>
      </div>
    `;

    div.appendChild(previewArea);
    container.appendChild(div);

    // Hook preview buttons
    const clearBtn = previewArea.querySelector("#avatarClearImgBtn");
    if (clearBtn) {
      clearBtn.addEventListener("click", () => {
        uploadedImageB64 = null;
        renderUploadTab(container);
      });
    }

    const genBtn = previewArea.querySelector("#avatarGenerateBtn");
    if (genBtn) {
      genBtn.addEventListener("click", async () => {
        if (!uploadedImageB64) {
          toast("Please upload a reference photo first.");
          return;
        }

        const prog = $("avatarGenProgress");
        const statusText = $("avatarGenStatusText");
        genBtn.disabled = true;
        prog.hidden = false;
        statusText.textContent = "Scanning features (hair, eyes, skin, style)...";

        try {
          const aesthetic = $("avatarAestheticSelect").value;
          const res = await api.avatar_analyze(uploadedImageB64, aesthetic);

          if (!res || !res.ok) {
            toast(`Generation error: ${res?.error || "Failed to analyze photo"}`);
            return;
          }

          audio.playSuccess();

          // Apply generated configuration
          const attrs = res.attributes;
          applyConfig(attrs);

          // Show provenance toast
          const providerText = res.provider || res.source || "Computer Vision";
          toast(`Avatar generated via ${providerText}!`);

          if (res.summary) {
            console.log("[Avatar AI Summary]:", res.summary);
          }
        } catch (err) {
          toast(`Generation failed: ${err.message}`);
        } finally {
          genBtn.disabled = false;
          prog.hidden = true;
        }
      });
    }

    function handleFile(file) {
      if (!file.type.match(/image\/(jpeg|png|webp)/i)) {
        toast("Please select a JPG, PNG, or WebP image.");
        return;
      }
      if (file.size > 15 * 1024 * 1024) {
        toast("File too large. Maximum size is 15MB.");
        return;
      }
      const reader = new FileReader();
      reader.onload = (ev) => {
        uploadedImageB64 = ev.target.result;
        audio.playBlip(620, "sine", 0.05);
        renderUploadTab(container);
      };
      reader.readAsDataURL(file);
    }
  }

  function renderAppearanceTab(container) {
    const div = el("div", { class: "controls-tab" });

    // Hairstyle Selector
    const hairStyles = [
      ["cat_wolf_cut", "Neko Wolf Cut (Cat Ears)"],
      ["wolf_cut", "Grunge Wolf Cut"],
      ["twin_buns", "Cyber Space Buns"],
      ["pigtails", "Spiky Twin Pigtails"],
      ["hime_cut", "Hime Cut & Sidelocks"],
      ["messy_bob", "90s Grunge Bob"],
      ["fairy_locs", "Fairy Braids & Beads"],
      ["short_spiky", "Spiky Anime Hero"],
    ];

    div.appendChild(createSectionHeader("Hairstyle"));
    const hairGrid = el("div", { class: "choice-chips-grid" });
    hairStyles.forEach(([val, label]) => {
      const chip = el("button", {
        type: "button",
        class: `choice-chip ${currentConfig.hair_style === val ? "active" : ""}`,
        onclick: () => {
          audio.playBlip(540, "triangle", 0.04);
          updateConfig({ hair_style: val });
          renderAppearanceTab(container);
        },
      }, label);
      hairGrid.appendChild(chip);
    });
    div.appendChild(hairGrid);

    // Hair Color Picker
    div.appendChild(createSectionHeader("Hair Color"));
    const hairColors = ["#ff77aa", "#3b261d", "#121217", "#c8b6ff", "#2b3a67", "#00ffee", "#ff0055", "#e8d8c8", "#ff9e00"];
    div.appendChild(createColorPalette(hairColors, currentConfig.hair_color, (hex) => updateConfig({ hair_color: hex })));

    // Skin Tone
    div.appendChild(createSectionHeader("Skin Tone"));
    const skinTones = ["#ffe3dc", "#f8e2da", "#f5d0c5", "#f4d6c6", "#fae0d4", "#e8b298", "#b87d60", "#6b4737"];
    div.appendChild(createColorPalette(skinTones, currentConfig.skin_tone, (hex) => updateConfig({ skin_tone: hex })));

    // Eye Style & Color
    div.appendChild(createSectionHeader("Anime Eyes"));
    const eyeStyles = [
      ["sleepy_grunge", "Sleepy Grunge (Spiked Lashes)"],
      ["sparkle", "Anime Sparkle"],
      ["grunge_dark", "Sleepy Dark Rim"],
      ["fairy_mystic", "Fairy Mystic"],
      ["retro_game", "PS1 Pixel"],
    ];
    const eyeGrid = el("div", { class: "choice-chips-grid" });
    eyeStyles.forEach(([val, label]) => {
      const chip = el("button", {
        type: "button",
        class: `choice-chip ${currentConfig.eye_style === val ? "active" : ""}`,
        onclick: () => {
          audio.playBlip(560, "triangle", 0.04);
          updateConfig({ eye_style: val });
          renderAppearanceTab(container);
        },
      }, label);
      eyeGrid.appendChild(chip);
    });
    div.appendChild(eyeGrid);

    const eyeColors = ["#00f0ff", "#5b7c52", "#9d4edd", "#ff9ebb", "#48cae4", "#ff007f", "#d4af37"];
    div.appendChild(createColorPalette(eyeColors, currentConfig.eye_color, (hex) => updateConfig({ eye_color: hex })));

    // Makeup & Facial Details
    div.appendChild(createSectionHeader("Facial Details & Makeup"));
    const makeups = [
      ["blush", "Anime Blush"],
      ["freckles", "Freckles"],
      ["goth_eyeliner", "Goth Eyeliner"],
      ["fairy_glitter", "Fairy Glitter"],
      ["cyber_markings", "Cyber Markings"],
      ["dark_lips", "Dark Lipstick"],
    ];
    const mkList = el("div", { class: "checkbox-chips-grid" });
    makeups.forEach(([val, label]) => {
      const has = currentConfig.makeup && currentConfig.makeup.includes(val);
      const chip = el("button", {
        type: "button",
        class: `check-chip ${has ? "checked" : ""}`,
        onclick: () => {
          audio.playBlip(500, "square", 0.04);
          const current = [...(currentConfig.makeup || [])];
          const next = has ? current.filter((x) => x !== val) : [...current, val];
          updateConfig({ makeup: next });
          renderAppearanceTab(container);
        },
      }, `${has ? "✓" : "+"} ${label}`);
      mkList.appendChild(chip);
    });
    div.appendChild(mkList);

    container.appendChild(div);
  }

  function renderClothingTab(container) {
    const div = el("div", { class: "controls-tab" });

    // Tops
    div.appendChild(createSectionHeader("Top / Outfit"));
    const tops = [
      ["asym_bell_sleeve", "Floral Asym Bell Sleeve (Pic Match)"],
      ["layered_baby_tee", "Layered Baby Tee"],
      ["oversized_tee", "Oversized Graphic Tee"],
      ["corset_cami", "Fairy Lace Corset"],
      ["track_jacket", "Y2K Track Jacket"],
      ["fishnet_knit", "Grunge Fishnet Knit"],
    ];
    const topGrid = el("div", { class: "choice-chips-grid" });
    tops.forEach(([val, label]) => {
      const chip = el("button", {
        type: "button",
        class: `choice-chip ${currentConfig.top === val ? "active" : ""}`,
        onclick: () => {
          audio.playBlip(520, "triangle", 0.04);
          updateConfig({ top: val });
          renderClothingTab(container);
        },
      }, label);
      topGrid.appendChild(chip);
    });
    div.appendChild(topGrid);

    div.appendChild(createSectionHeader("Top Main Color"));
    const topColors = ["#c5aee0", "#1a1a2e", "#222222", "#0f0f14", "#ffd6e0", "#202028", "#ffffff", "#4b2138"];
    div.appendChild(createColorPalette(topColors, currentConfig.top_color, (hex) => updateConfig({ top_color: hex })));

    div.appendChild(createSectionHeader("Top Accent / Floral Color"));
    const accentColors = ["#6e3d5c", "#00f0ff", "#5b7c52", "#7b2cbf", "#bbd0ff", "#e63946", "#ff007f", "#ffd166"];
    div.appendChild(createColorPalette(accentColors, currentConfig.top_accent, (hex) => updateConfig({ top_accent: hex })));

    // Bottoms
    div.appendChild(createSectionHeader("Bottom"));
    const bottoms = [
      ["baggy_skater_pants", "Baggy Skater Pants (Pic Match)"],
      ["cargo_pants", "Baggy Parachute Cargos"],
      ["pleated_skirt", "Pleated Micro-Skirt"],
      ["tulle_skirt", "Fairy Tulle Skirt"],
      ["denim_shorts", "Distressed Denim Shorts"],
    ];
    const botGrid = el("div", { class: "choice-chips-grid" });
    bottoms.forEach(([val, label]) => {
      const chip = el("button", {
        type: "button",
        class: `choice-chip ${currentConfig.bottom === val ? "active" : ""}`,
        onclick: () => {
          audio.playBlip(510, "triangle", 0.04);
          updateConfig({ bottom: val });
          renderClothingTab(container);
        },
      }, label);
      botGrid.appendChild(chip);
    });
    div.appendChild(botGrid);

    div.appendChild(createSectionHeader("Bottom Color"));
    const botColors = ["#2d1b4e", "#383f34", "#181822", "#c8b6ff", "#3f5e78", "#111116", "#ffffff"];
    div.appendChild(createColorPalette(botColors, currentConfig.bottom_color, (hex) => updateConfig({ bottom_color: hex })));

    // Shoes
    div.appendChild(createSectionHeader("Shoes / Legwear"));
    const shoes = [
      ["platform_boots", "Chunky Goth Platform Boots"],
      ["cyber_sneakers", "Neon Cyber Sneakers"],
      ["ballet_flats", "Fairy Lace-up Flats"],
      ["leg_warmers", "Slouchy Leg Warmers"],
    ];
    const shoeGrid = el("div", { class: "choice-chips-grid" });
    shoes.forEach(([val, label]) => {
      const chip = el("button", {
        type: "button",
        class: `choice-chip ${currentConfig.shoes === val ? "active" : ""}`,
        onclick: () => {
          audio.playBlip(490, "triangle", 0.04);
          updateConfig({ shoes: val });
          renderClothingTab(container);
        },
      }, label);
      shoeGrid.appendChild(chip);
    });
    div.appendChild(shoeGrid);

    container.appendChild(div);
  }

  function renderAccessoriesTab(container) {
    const div = el("div", { class: "controls-tab" });

    // Fairy Wings Toggle
    div.appendChild(createSectionHeader("Fairy Wings"));
    const wingRow = el("div", { class: "toggle-row" });
    const wingToggle = el("button", {
      type: "button",
      class: `toggle-pill ${currentConfig.wings ? "on" : "off"}`,
      onclick: () => {
        audio.playBlip(currentConfig.wings ? 380 : 640, "sine", 0.06);
        updateConfig({ wings: !currentConfig.wings });
        renderAccessoriesTab(container);
      },
    }, currentConfig.wings ? "Wings: ENABLED" : "Wings: DISABLED");
    wingRow.appendChild(wingToggle);
    div.appendChild(wingRow);

    if (currentConfig.wings) {
      const wingStyles = [
        ["cyber_wings", "Cyber Hologram Wings"],
        ["fairy_moth", "Gossamer Moth Wings"],
        ["bat_fairy", "Dark Bat Wings"],
        ["butterfly", "Fairy Butterfly"],
      ];
      const wingGrid = el("div", { class: "choice-chips-grid" });
      wingStyles.forEach(([val, label]) => {
        const chip = el("button", {
          type: "button",
          class: `choice-chip ${currentConfig.wing_style === val ? "active" : ""}`,
          onclick: () => {
            audio.playBlip(580, "triangle", 0.04);
            updateConfig({ wing_style: val });
            renderAccessoriesTab(container);
          },
        }, label);
        wingGrid.appendChild(chip);
      });
      div.appendChild(wingGrid);

      div.appendChild(createSectionHeader("Wing Glow Color"));
      const wingColors = ["#00ffee", "#6e8b74", "#7b2cbf", "#ffcbf2", "#ffd166", "#ff007f", "#ffffff"];
      div.appendChild(createColorPalette(wingColors, currentConfig.wing_color, (hex) => updateConfig({ wing_color: hex })));
    }

    // Y2K & Grunge Jewelry / Accessories
    div.appendChild(createSectionHeader("Jewelry & Accessories"));
    const accOptions = [
      ["golden_spear", "Back Shaman Spear (Gold Tip)"],
      ["butterfly_clips", "Butterfly Hair Clips"],
      ["headphones", "Y2K DJ Headphones"],
      ["choker", "Spiked / Heart Choker"],
      ["chain_belt", "Hip Chain & Safety Pins"],
      ["star_pins", "Shooting Star Hairpins"],
    ];
    const accList = el("div", { class: "checkbox-chips-grid" });
    accOptions.forEach(([val, label]) => {
      const has = currentConfig.accessories && currentConfig.accessories.includes(val);
      const chip = el("button", {
        type: "button",
        class: `check-chip ${has ? "checked" : ""}`,
        onclick: () => {
          audio.playBlip(520, "square", 0.04);
          const current = [...(currentConfig.accessories || [])];
          const next = has ? current.filter((x) => x !== val) : [...current, val];
          updateConfig({ accessories: next });
          renderAccessoriesTab(container);
        },
      }, `${has ? "✓" : "+"} ${label}`);
      accList.appendChild(chip);
    });
    div.appendChild(accList);

    // Jewelry Tone
    div.appendChild(createSectionHeader("Hardware / Metal Finish"));
    const metalTones = ["#c0c0c0", "#181818", "#d4af37", "#00ffee"];
    div.appendChild(createColorPalette(metalTones, currentConfig.jewelry_color, (hex) => updateConfig({ jewelry_color: hex })));

    container.appendChild(div);
  }

  function renderRetroTab(container) {
    const div = el("div", { class: "controls-tab" });

    div.appendChild(createSectionHeader("PS1 Retro Graphics & Effects"));

    // Vertex Wobble
    const wobbleRow = el("div", { class: "setting-toggle-card" });
    wobbleRow.innerHTML = `
      <div class="toggle-info">
        <strong>PS1 Vertex Wobble (Subpixel Jitter)</strong>
        <p>Simulates the classic PlayStation 1 lack of floating-point coordinate precision.</p>
      </div>
    `;
    const wobbleBtn = el("button", {
      type: "button",
      class: `toggle-pill ${currentConfig.wobble !== false ? "on" : "off"}`,
      onclick: () => {
        const next = currentConfig.wobble === false;
        audio.playBlip(next ? 600 : 350, "sine", 0.05);
        updateConfig({ wobble: next });
        ensure3D()?.toggleWobble(next);
        renderRetroTab(container);
      },
    }, currentConfig.wobble !== false ? "ON" : "OFF");
    wobbleRow.appendChild(wobbleBtn);
    div.appendChild(wobbleRow);

    // CRT Scanlines & Dithering Overlay
    const crtRow = el("div", { class: "setting-toggle-card" });
    crtRow.innerHTML = `
      <div class="toggle-info">
        <strong>CRT Scanlines & Retro Dithering</strong>
        <p>CRT television phosphors and early 2000s monitor scanlines overlay.</p>
      </div>
    `;
    const crtBtn = el("button", {
      type: "button",
      class: `toggle-pill ${currentConfig.crt_effect !== false ? "on" : "off"}`,
      onclick: () => {
        const next = currentConfig.crt_effect === false;
        audio.playBlip(next ? 600 : 350, "sine", 0.05);
        updateConfig({ crt_effect: next });
        updateCrtOverlay();
        renderRetroTab(container);
      },
    }, currentConfig.crt_effect !== false ? "ON" : "OFF");
    crtRow.appendChild(crtBtn);
    div.appendChild(crtRow);

    // Wireframe Mode
    const wireRow = el("div", { class: "setting-toggle-card" });
    wireRow.innerHTML = `
      <div class="toggle-info">
        <strong>PS1 Wireframe Debug Mode</strong>
        <p>Reveals the faceted low-poly polygon meshes.</p>
      </div>
    `;
    const wireBtn = el("button", {
      type: "button",
      class: `toggle-pill ${avatar3d.wireframeMode ? "on" : "off"}`,
      onclick: () => {
        audio.playBlip(540, "square", 0.05);
        ensure3D()?.toggleWireframe(!ensure3D()?.wireframeMode);
        renderRetroTab(container);
      },
    }, avatar3d.wireframeMode ? "ON" : "OFF");
    wireRow.appendChild(wireBtn);
    div.appendChild(wireRow);

    // Environment Lighting Preset
    div.appendChild(createSectionHeader("Stage Environment & Lighting"));
    const stages = [
      ["ps1_street", "PS1 Roadway (Muted Blue-Gray Asphalt)"],
      ["cyber_void", "Y2K Cyber Void (Neon Grid)"],
      ["fairy_garden", "Twilight Fairy Garden (Moss & Spores)"],
      ["dark_fairy", "Dark Fairy Cathedral (Gothic Violet)"],
      ["ps1_bios", "PS1 Memory Card Screen (Classic Navy)"],
      ["grunge_room", "Lo-Fi Grunge Bedroom (Warm Tungsten)"],
    ];
    const stageGrid = el("div", { class: "choice-chips-grid" });
    stages.forEach(([val, label]) => {
      const chip = el("button", {
        type: "button",
        class: `choice-chip ${currentConfig.lighting === val ? "active" : ""}`,
        onclick: () => {
          audio.playBlip(560, "triangle", 0.04);
          updateConfig({ lighting: val });
          ensure3D()?.setLighting(val);
          renderRetroTab(container);
        },
      }, label);
      stageGrid.appendChild(chip);
    });
    div.appendChild(stageGrid);

    container.appendChild(div);
  }

  // ---------------- Right Pane (Detailed Attributes Inspector) ----------------
  function renderRightPane() {
    const pane = $("avatarRightPane");
    if (!pane || !currentConfig) return;

    pane.innerHTML = `
      <div class="right-pane-card">
        <h3><span class="retro-icon">✦</span> Character Specs</h3>
        <div class="specs-grid">
          <div class="spec-item">
            <span class="spec-label">Style</span>
            <span class="spec-val">${currentConfig.name || "Custom"}</span>
          </div>
          <div class="spec-item">
            <span class="spec-label">Hairstyle</span>
            <span class="spec-val">${(currentConfig.hair_style || "").replace("_", " ")}</span>
          </div>
          <div class="spec-item">
            <span class="spec-label">Top</span>
            <span class="spec-val">${(currentConfig.top || "").replace("_", " ")}</span>
          </div>
          <div class="spec-item">
            <span class="spec-label">Bottom</span>
            <span class="spec-val">${(currentConfig.bottom || "").replace("_", " ")}</span>
          </div>
          <div class="spec-item">
            <span class="spec-label">Shoes</span>
            <span class="spec-val">${(currentConfig.shoes || "").replace("_", " ")}</span>
          </div>
          <div class="spec-item">
            <span class="spec-label">Wings</span>
            <span class="spec-val">${currentConfig.wings ? (currentConfig.wing_style || "Yes").replace("_", " ") : "None"}</span>
          </div>
        </div>

        <div class="active-palette-preview">
          <span class="spec-label">Active Color Palette:</span>
          <div class="palette-swatch-row">
            <span class="swatch-circle" style="background:${currentConfig.skin_tone}" title="Skin"></span>
            <span class="swatch-circle" style="background:${currentConfig.hair_color}" title="Hair"></span>
            <span class="swatch-circle" style="background:${currentConfig.eye_color}" title="Eyes"></span>
            <span class="swatch-circle" style="background:${currentConfig.top_color}" title="Top"></span>
            <span class="swatch-circle" style="background:${currentConfig.top_accent}" title="Accent"></span>
            <span class="swatch-circle" style="background:${currentConfig.bottom_color}" title="Bottom"></span>
            <span class="swatch-circle" style="background:${currentConfig.wing_color || "#ffffff"}" title="Wings"></span>
          </div>
        </div>

        <div class="specs-actions" style="display:flex; flex-direction:column; gap:8px;">
          <button type="button" class="avatar-btn primary char-integrate-btn w-100" id="avatarRightIntegrateBtn">✦ Set as Vermeil Character</button>
          <button type="button" class="avatar-btn small w-100" id="avatarCopyJsonBtn">📋 Copy Config JSON</button>
        </div>
      </div>
    `;

    pane.querySelector("#avatarRightIntegrateBtn")?.addEventListener("click", integrateAvatarAsCharacter);

    pane.querySelector("#avatarCopyJsonBtn")?.addEventListener("click", () => {
      audio.playBlip(700, "sine", 0.05);
      navigator.clipboard.writeText(JSON.stringify(currentConfig, null, 2));
      toast("Copied character configuration to clipboard!");
    });
  }

  // ---------------- Small UI Helpers ----------------
  function createSectionHeader(title) {
    return el("h4", { class: "avatar-section-title" }, `✧ ${title}`);
  }

  function createColorPalette(hexList, selectedHex, onSelect) {
    const row = el("div", { class: "color-palette-row" });
    hexList.forEach((hex) => {
      const isSel = (selectedHex || "").toLowerCase() === hex.toLowerCase();
      const dot = el("button", {
        type: "button",
        class: `color-dot ${isSel ? "active" : ""}`,
        style: `background: ${hex}`,
        onclick: () => {
          audio.playBlip(620, "sine", 0.03);
          onSelect(hex);
        },
      });
      row.appendChild(dot);
    });

    // Custom color picker input
    const custom = el("input", {
      type: "color",
      class: "custom-color-input",
      value: selectedHex || "#ffffff",
      title: "Pick custom color",
      onchange: (e) => {
        audio.playBlip(620, "sine", 0.03);
        onSelect(e.target.value);
      },
    });
    row.appendChild(custom);
    return row;
  }

  // ---------------- Public Interface ----------------
  return {
    load: async () => {
      // Load presets from backend
      try {
        presets = await api.avatar_presets();
      } catch (e) {
        console.warn("avatar presets load:", e);
      }

      updatePresetSelect();

      // If no config loaded yet, pick default preset (prefer picture match)
      if (!currentConfig) {
        const firstPreset = presets["y2k_grunge_shaman"] || presets["y2k_cyber_fairy"] || Object.values(presets)[0];
        if (firstPreset) applyConfig(JSON.parse(JSON.stringify(firstPreset)));
      }

      // Resize 3D canvas
      ensure3D(); setTimeout(() => avatar3d?.resize(), 60);
    },
  };
}
