/* OmniVoice Studio — frontend wiring.
   Plain ES6, no build step. Every element is looked up by the exact id
   from the frontend contract (SPEC section 3). */

(() => {
  "use strict";

  const API = {
    generate: "/api/generate",
    voices: "/api/voices",
    history: "/api/history",
  };

  const TABS = ["clone", "design", "auto", "library"];

  /* ---------- DOM helpers ---------- */

  const IDS = [
    "clone-dropzone", "clone-ref-audio", "clone-ref-preview", "clone-voice-select",
    "clone-ref-text", "clone-text", "clone-save-voice-name",
    "clone-num-step", "clone-speed", "clone-duration",
    "clone-generate-btn", "clone-status", "clone-result",

    "design-gender", "design-age", "design-pitch", "design-whisper",
    "design-lang", "design-accent-dialect", "design-accent-dialect-label",
    "design-accent-dialect-hint", "design-script-hint",
    "design-instruct-preview", "design-text",
    "design-num-step", "design-speed", "design-duration",
    "design-generate-btn", "design-status", "design-result",
    "design-age-readout", "design-pitch-readout",

    "auto-text", "auto-num-step", "auto-speed", "auto-duration",
    "auto-generate-btn", "auto-status", "auto-result",

    "library-voices", "library-history",

    "tab-clone", "tab-design", "tab-auto", "tab-library",

    "theme-select",
  ];

  const $ = (id) => document.getElementById(id);

  const els = {};
  for (const id of IDS) els[id] = $(id);

  const missing = IDS.filter((id) => !els[id]);
  if (missing.length) {
    console.error("OmniVoice Studio: missing DOM ids:", missing.join(", "));
  }

  /* ---------- small utilities ---------- */

  const escapeHtml = (value) =>
    String(value ?? "").replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[ch]));

  const formatDate = (iso) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso || "";
    return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  };

  const snippet = (text, max = 220) => {
    const t = String(text || "").trim();
    return t.length > max ? t.slice(0, max - 1).trimEnd() + "…" : t;
  };

  /** Reads a FastAPI-style error body into a readable message. */
  async function readError(res) {
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (typeof body.detail === "string") {
        message = body.detail;
      } else if (Array.isArray(body.detail)) {
        message = body.detail
          .map((d) => (d && d.msg) ? d.msg : JSON.stringify(d))
          .join("; ");
      }
    } catch (_) { /* body was not JSON */ }
    return message;
  }

  /** fetch wrapper that throws a readable Error on non-2xx. */
  async function api(url, options = {}) {
    let res;
    try {
      res = await fetch(url, options);
    } catch (_) {
      throw new Error("Can't reach the server. Is it still running?");
    }
    if (!res.ok) throw new Error(await readError(res));
    return res;
  }

  function setStatus(statusId, message, isError = false) {
    const el = els[statusId];
    if (!el) return;
    el.textContent = message || "";
    el.classList.toggle("is-error", Boolean(isError) && Boolean(message));
  }

  function setBusy(button, busy, label = "Generate") {
    button.disabled = busy;
    button.classList.toggle("is-busy", busy);
    const span = button.querySelector(".btn-label");
    if (span) span.textContent = busy ? "Rendering…" : label;
  }

  function parseOptionalNumber(value) {
    const v = String(value ?? "").trim();
    if (v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : NaN;
  }

  /** Adds num_step / speed / duration from an Advanced block, validating numbers. */
  function appendAdvanced(form, prefix) {
    const numStep = parseOptionalNumber(els[`${prefix}-num-step`].value);
    const speed = parseOptionalNumber(els[`${prefix}-speed`].value);
    const duration = parseOptionalNumber(els[`${prefix}-duration`].value);

    if (Number.isNaN(numStep) || Number.isNaN(speed) || Number.isNaN(duration)) {
      throw new Error("Advanced values must be numbers.");
    }
    if (numStep !== null) form.append("num_step", String(Math.round(numStep)));
    if (speed !== null) form.append("speed", String(speed));
    if (duration !== null) form.append("duration", String(duration));
  }

  /* ---------- tabs ---------- */

  const tabButtons = [...document.querySelectorAll("[data-tab]")];

  function showTab(name) {
    if (!TABS.includes(name)) return;
    for (const tab of TABS) {
      const panel = $(`tab-${tab}`);
      if (panel) panel.hidden = tab !== name;
    }
    for (const btn of tabButtons) {
      const active = btn.dataset.tab === name;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-selected", String(active));
    }
    if (name === "library") loadHistory();
  }

  tabButtons.forEach((btn) => {
    btn.addEventListener("click", () => showTab(btn.dataset.tab));
  });

  /* ---------- theme switcher ---------- */

  const THEME_KEY = "omnivoice-theme";
  const THEME_COLOR_SCHEME = {
    dark: "dark",
    light: "light",
    nord: "dark",
    catppuccin: "dark",
  };

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    const colorSchemeMeta = document.querySelector('meta[name="color-scheme"]');
    if (colorSchemeMeta) {
      const scheme = THEME_COLOR_SCHEME[theme] || "dark";
      colorSchemeMeta.setAttribute("content", `${scheme} light`);
    }
  }

  function initTheme() {
    let saved = "dark";
    try {
      saved = localStorage.getItem(THEME_KEY) || document.documentElement.getAttribute("data-theme") || "dark";
    } catch (_) {
      saved = document.documentElement.getAttribute("data-theme") || "dark";
    }
    applyTheme(saved);
    if (els["theme-select"]) els["theme-select"].value = saved;
  }

  if (els["theme-select"]) {
    els["theme-select"].addEventListener("change", (e) => {
      const theme = e.target.value;
      applyTheme(theme);
      try {
        localStorage.setItem(THEME_KEY, theme);
      } catch (_) {
        /* private mode / blocked storage — theme still applies for this session */
      }
    });
  }

  initTheme();

  /* ---------- clone: dropzone + reference audio ---------- */

  const dropzone = els["clone-dropzone"];
  const refInput = els["clone-ref-audio"];
  const refPreview = els["clone-ref-preview"];
  const voiceSelect = els["clone-voice-select"];
  let previewUrl = null;

  function clearPreview() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
    refPreview.removeAttribute("src");
    refPreview.hidden = true;
    refPreview.load();
    dropzone.classList.remove("has-file");
    const title = dropzone.querySelector(".dropzone-title");
    if (title) title.textContent = "Drop a voice sample here";
  }

  function handleReferenceFile(file) {
    if (!file) return;
    if (file.type && !file.type.startsWith("audio/")) {
      setStatus("clone-status", "That file isn't audio. Choose an audio file.", true);
      return;
    }
    setStatus("clone-status", "");

    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(file);
    refPreview.src = previewUrl;
    refPreview.hidden = false;
    dropzone.classList.add("has-file");
    const title = dropzone.querySelector(".dropzone-title");
    if (title) title.textContent = file.name;

    // A fresh upload takes precedence over a saved voice.
    voiceSelect.value = "";
  }

  dropzone.addEventListener("click", () => refInput.click());

  dropzone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      refInput.click();
    }
  });

  refInput.addEventListener("change", () => {
    handleReferenceFile(refInput.files && refInput.files[0]);
  });

  // Dragging counts as entering only once the pointer leaves the zone's children.
  let dragDepth = 0;

  dropzone.addEventListener("dragenter", (e) => {
    e.preventDefault();
    dragDepth += 1;
    dropzone.classList.add("is-dragover");
  });

  dropzone.addEventListener("dragover", (e) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    dropzone.classList.add("is-dragover");
  });

  dropzone.addEventListener("dragleave", () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) dropzone.classList.remove("is-dragover");
  });

  dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    dragDepth = 0;
    dropzone.classList.remove("is-dragover");
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!file) return;
    try {
      // Keep the hidden input in sync so the picker and drop agree.
      const dt = new DataTransfer();
      dt.items.add(file);
      refInput.files = dt.files;
    } catch (_) { /* older browsers: preview still works from the File */ }
    handleReferenceFile(file);
  });

  // Picking a saved voice means the uploaded sample is no longer used.
  voiceSelect.addEventListener("change", () => {
    if (voiceSelect.value) {
      refInput.value = "";
      clearPreview();
    }
  });

  /* ---------- design: live instruct composition ----------
     OmniVoice's voice-design instruct only accepts an exact, fixed vocabulary,
     and a single instruct string must stay entirely in ONE language — English
     attributes with English comma-space joins, or Chinese attributes with a
     single full-width comma and no space. Mixing languages, or using a label
     the model doesn't recognise (e.g. a bare "high"), raises a ValueError.
     These lists are the model's own valid-item lists, taken verbatim from its
     error message, so every value sent here is guaranteed well-formed. */

  const LANG = {
    en: {
      joiner: ", ",
      fieldLabel: "Accent",
      hint: "English accents — options match the instruct language selected above.",
      scriptHint: "Write this in English to match the attributes above.",
      genderMale: "male",
      genderFemale: "female",
      ageBuckets: ["child", "teenager", "young adult", "middle-aged", "elderly"],
      pitchBuckets: ["very low pitch", "low pitch", "moderate pitch", "high pitch", "very high pitch"],
      whisper: "whisper",
      accentDialectOptions: [
        { value: "american accent", label: "American accent" },
        { value: "australian accent", label: "Australian accent" },
        { value: "british accent", label: "British accent" },
        { value: "canadian accent", label: "Canadian accent" },
        { value: "chinese accent", label: "Chinese accent" },
        { value: "indian accent", label: "Indian accent" },
        { value: "japanese accent", label: "Japanese accent" },
        { value: "korean accent", label: "Korean accent" },
        { value: "portuguese accent", label: "Portuguese accent" },
        { value: "russian accent", label: "Russian accent" },
      ],
    },
    zh: {
      joiner: "，",
      fieldLabel: "Dialect",
      hint: "Chinese dialects — options match the instruct language selected above.",
      scriptHint: "Write this in Chinese to match the attributes above.",
      genderMale: "男",
      genderFemale: "女",
      ageBuckets: ["儿童", "少年", "青年", "中年", "老年"],
      pitchBuckets: ["极低音调", "低音调", "中音调", "高音调", "极高音调"],
      whisper: "耳语",
      accentDialectOptions: [
        { value: "东北话", label: "东北话 (Northeastern)" },
        { value: "云南话", label: "云南话 (Yunnan)" },
        { value: "四川话", label: "四川话 (Sichuanese)" },
        { value: "宁夏话", label: "宁夏话 (Ningxia)" },
        { value: "桂林话", label: "桂林话 (Guilin)" },
        { value: "河南话", label: "河南话 (Henan)" },
        { value: "济南话", label: "济南话 (Jinan)" },
        { value: "甘肃话", label: "甘肃话 (Gansu)" },
        { value: "石家庄话", label: "石家庄话 (Shijiazhuang)" },
        { value: "贵州话", label: "贵州话 (Guizhou)" },
        { value: "陕西话", label: "陕西话 (Shaanxi)" },
        { value: "青岛话", label: "青岛话 (Qingdao)" },
      ],
    },
  };

  let currentLang = "en";
  let selectedGender = "";

  /** Maps a 0-100 slider value onto one of N equal bucket indices. */
  function bucketIndex(value, count) {
    const v = Math.min(100, Math.max(0, Number(value) || 0));
    return Math.min(count - 1, Math.floor(v / (100 / count)));
  }

  /** Rebuilds the accent/dialect <select> options for the current language. */
  function populateAccentDialectOptions() {
    const terms = LANG[currentLang];
    const select = els["design-accent-dialect"];
    select.innerHTML = "";
    select.add(new Option("— none —", ""));
    for (const opt of terms.accentDialectOptions) {
      select.add(new Option(opt.label, opt.value));
    }
    els["design-accent-dialect-label"].textContent = terms.fieldLabel;
    els["design-accent-dialect-hint"].textContent = terms.hint;
    els["design-script-hint"].textContent = terms.scriptHint;
  }

  function composeInstruct() {
    const terms = LANG[currentLang];
    const ageIdx = bucketIndex(els["design-age"].value, terms.ageBuckets.length);
    const pitchIdx = bucketIndex(els["design-pitch"].value, terms.pitchBuckets.length);
    const age = terms.ageBuckets[ageIdx];
    const pitch = terms.pitchBuckets[pitchIdx];

    els["design-age-readout"].textContent = age;
    els["design-pitch-readout"].textContent = pitch;

    const gender = selectedGender === "male" ? terms.genderMale
      : selectedGender === "female" ? terms.genderFemale
      : "";

    const parts = [
      gender,
      age,
      pitch,
      els["design-whisper"].checked ? terms.whisper : "",
      els["design-accent-dialect"].value,
    ].filter((p) => p && String(p).trim() !== "");

    const instruct = parts.join(terms.joiner);
    els["design-instruct-preview"].textContent = instruct || "—";
    els["design-instruct-preview"].dataset.value = instruct;
    updateFaderFill(els["design-age"]);
    updateFaderFill(els["design-pitch"]);
    return instruct;
  }

  /** Feeds the slider position to CSS so the track fill follows the thumb. */
  function updateFaderFill(input) {
    const min = Number(input.min) || 0;
    const max = Number(input.max) || 100;
    const pct = ((Number(input.value) - min) / (max - min)) * 100;
    input.style.setProperty("--pct", `${pct}%`);
  }

  const langButtons = [...els["design-lang"].querySelectorAll(".seg")];
  langButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      currentLang = btn.dataset.value === "zh" ? "zh" : "en";
      langButtons.forEach((b) => {
        const on = b === btn;
        b.classList.toggle("active", on);
        b.setAttribute("aria-checked", String(on));
      });
      populateAccentDialectOptions();
      composeInstruct();
    });
  });

  const genderButtons = [...els["design-gender"].querySelectorAll(".seg")];

  genderButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedGender = btn.dataset.value || "";
      genderButtons.forEach((b) => {
        const on = b === btn;
        b.classList.toggle("active", on);
        b.setAttribute("aria-checked", String(on));
      });
      composeInstruct();
    });
  });

  ["design-age", "design-pitch"].forEach((id) => {
    els[id].addEventListener("input", composeInstruct);
    els[id].addEventListener("change", composeInstruct);
  });
  ["design-whisper", "design-accent-dialect"].forEach((id) => {
    els[id].addEventListener("change", composeInstruct);
  });

  populateAccentDialectOptions();
  composeInstruct();

  /* ---------- generation ---------- */

  function showResult(kind, data) {
    const card = els[`${kind}-result`];
    const audio = card.querySelector(".result-audio");
    const link = card.querySelector(".result-download");

    audio.src = data.audio_url;
    audio.load();
    link.href = data.audio_url;
    link.setAttribute("download", `${data.id || "omnivoice"}.wav`);
    card.hidden = false;
    card.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  async function runGenerate(kind, buildForm) {
    const button = els[`${kind}-generate-btn`];
    const label = button.querySelector(".btn-label");
    const defaultLabel = label ? label.textContent : "Generate";

    let form;
    try {
      form = new FormData();
      buildForm(form);
    } catch (err) {
      setStatus(`${kind}-status`, err.message, true);
      return;
    }

    setStatus(`${kind}-status`, "Rendering — this can take a little while…");
    setBusy(button, true, defaultLabel);

    try {
      const res = await api(API.generate, { method: "POST", body: form });
      const data = await res.json();

      showResult(kind, data);
      setStatus(`${kind}-status`, "");

      if (data.saved_voice_id) {
        await loadVoices();
      }
      await loadHistory();
    } catch (err) {
      setStatus(`${kind}-status`, err.message || "Something went wrong.", true);
    } finally {
      setBusy(button, false, defaultLabel);
    }
  }

  // Clone
  els["clone-generate-btn"].addEventListener("click", () => {
    runGenerate("clone", (form) => {
      const text = els["clone-text"].value.trim();
      if (!text) throw new Error("Add some text for the voice to speak.");

      form.append("mode", "clone");
      form.append("text", text);

      const voiceId = voiceSelect.value;
      const file = refInput.files && refInput.files[0];

      if (voiceId) {
        form.append("voice_id", voiceId);
      } else if (file) {
        form.append("ref_audio", file, file.name);
        const saveName = els["clone-save-voice-name"].value.trim();
        if (saveName) form.append("save_voice_name", saveName);
      } else {
        throw new Error("Choose a reference audio file or a saved voice first.");
      }

      const refText = els["clone-ref-text"].value.trim();
      if (refText) form.append("ref_text", refText);

      appendAdvanced(form, "clone");
    });
  });

  // Design
  els["design-generate-btn"].addEventListener("click", () => {
    runGenerate("design", (form) => {
      const text = els["design-text"].value.trim();
      if (!text) throw new Error("Add some text for the voice to speak.");

      const instruct = composeInstruct();
      form.append("mode", "design");
      form.append("text", text);
      if (instruct) form.append("instruct", instruct);

      appendAdvanced(form, "design");
    });
  });

  // Auto
  els["auto-generate-btn"].addEventListener("click", () => {
    runGenerate("auto", (form) => {
      const text = els["auto-text"].value.trim();
      if (!text) throw new Error("Add some text to speak.");

      form.append("mode", "auto");
      form.append("text", text);

      appendAdvanced(form, "auto");
    });
  });

  /* ---------- library: voices ---------- */

  function renderVoiceOptions(voices) {
    const previous = voiceSelect.value;
    voiceSelect.innerHTML = "";

    const blank = new Option("— new reference audio —", "");
    voiceSelect.add(blank);

    for (const v of voices) {
      voiceSelect.add(new Option(v.name, v.id));
    }

    // Keep the current choice if that voice still exists.
    if (previous && voices.some((v) => v.id === previous)) {
      voiceSelect.value = previous;
    }
  }

  function renderVoiceCards(voices) {
    const root = els["library-voices"];
    if (!voices.length) {
      root.innerHTML = `<p class="empty">No saved voices yet. Clone a voice and give it a name to keep it here.</p>`;
      return;
    }

    root.innerHTML = voices.map((v) => `
      <article class="item voice-card">
        <div class="item-head">
          <h3 class="item-title">${escapeHtml(v.name)}</h3>
        </div>
        <p class="item-meta">saved ${escapeHtml(formatDate(v.created_at))}</p>
        <div class="item-actions">
          <span class="mode-tag">voice</span>
          <button type="button" class="delete-voice" data-id="${escapeHtml(v.id)}">Delete</button>
        </div>
      </article>
    `).join("");
  }

  async function loadVoices() {
    try {
      const res = await api(API.voices);
      const data = await res.json();
      const voices = Array.isArray(data.voices) ? data.voices : [];
      renderVoiceOptions(voices);
      renderVoiceCards(voices);
    } catch (err) {
      setStatus("clone-status", `Couldn't load saved voices: ${err.message}`, true);
    }
  }

  /* ---------- library: history ---------- */

  function renderHistory(items) {
    const root = els["library-history"];
    if (!items.length) {
      root.innerHTML = `<p class="empty">Nothing rendered yet. Your takes will appear here.</p>`;
      return;
    }

    root.innerHTML = items.map((item) => {
      const url = escapeHtml(item.audio_url);
      const mode = escapeHtml(item.mode || "auto");
      return `
        <article class="item">
          <div class="item-head">
            <h3 class="item-title">${escapeHtml(snippet(item.text, 60) || "Untitled take")}</h3>
            <span class="mode-tag">${mode}</span>
          </div>
          <p class="item-meta">${escapeHtml(formatDate(item.created_at))}</p>
          <p class="item-text">${escapeHtml(snippet(item.text))}</p>
          <audio controls preload="none" src="${url}"></audio>
          <div class="item-actions">
            <a class="result-download" href="${url}" download>Download</a>
            <button type="button" class="delete-history" data-id="${escapeHtml(item.id)}">Delete</button>
          </div>
        </article>
      `;
    }).join("");
  }

  async function loadHistory() {
    try {
      const res = await api(API.history);
      const data = await res.json();
      renderHistory(Array.isArray(data.items) ? data.items : []);
    } catch (err) {
      els["library-history"].innerHTML = "";
      showLibraryError(`Couldn't load history: ${err.message}`);
    }
  }

  /* ---------- library: error surface + delete delegation ---------- */

  let libraryErrorTimer = null;

  /** The library has no status element of its own, so surface errors transiently. */
  function showLibraryError(message) {
    const panel = $("tab-library");
    let note = panel.querySelector(".library-error");
    if (!note) {
      note = document.createElement("p");
      note.className = "status library-error is-error";
      note.setAttribute("role", "alert");
      panel.prepend(note);
    }
    note.textContent = message;
    clearTimeout(libraryErrorTimer);
    libraryErrorTimer = setTimeout(() => note.remove(), 5000);
  }

  async function deleteItem(button, url, after) {
    button.disabled = true;
    try {
      await api(url, { method: "DELETE" });
      await after();
    } catch (err) {
      button.disabled = false;
      showLibraryError(err.message || "Delete failed.");
    }
  }

  els["library-voices"].addEventListener("click", (e) => {
    const btn = e.target.closest(".delete-voice");
    if (!btn) return;
    const id = btn.dataset.id;
    deleteItem(btn, `${API.voices}/${encodeURIComponent(id)}`, loadVoices);
  });

  els["library-history"].addEventListener("click", (e) => {
    const btn = e.target.closest(".delete-history");
    if (!btn) return;
    const id = btn.dataset.id;
    deleteItem(btn, `${API.history}/${encodeURIComponent(id)}`, loadHistory);
  });

  /* ---------- boot ---------- */

  loadVoices();
  loadHistory();
})();
