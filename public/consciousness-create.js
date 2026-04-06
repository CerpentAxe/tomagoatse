/**
 * Create-maze form: reference image → rasterized maze (matches picture) → sessionStorage → generator.
 */
import {
  imageToOpenGrid,
  mazeGridSizeForImage,
  pickDefaultEndpoints,
} from "./maze-shared.js";

const DRAFT_KEY = "consciousness_generator_draft";

const params = new URLSearchParams(window.location.search);
const creatureId = params.get("id");
const wrap = document.getElementById("consciousness-create-wrap");
const form = document.getElementById("consciousness-create-form");
const statusEl = document.getElementById("consciousness-create-status");

if (!creatureId && wrap) {
  wrap.classList.add("consciousness-create-wrap--hidden");
}

function mazeNameFromFileName(filename) {
  if (typeof filename !== "string" || !filename.trim()) return "";
  const base = filename.replace(/\\/g, "/").split("/").pop() || "";
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  return stem.trim();
}

async function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function getReferenceDataUrl(file, urlTrimmed) {
  if (file) {
    return readFileAsDataUrl(file);
  }
  if (urlTrimmed) {
    if (statusEl) statusEl.textContent = "Fetching image from link…";
    const proxy = await fetch("/api/consciousness/reference-image-from-url", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: urlTrimmed }),
    });
    const body = await proxy.json().catch(() => ({}));
    if (!proxy.ok) {
      throw new Error(
        body.message || body.error || `Could not load image (${proxy.status}).`
      );
    }
    const dataUrl = body.dataUrl;
    if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:")) {
      throw new Error("Invalid response from server.");
    }
    return dataUrl;
  }
  throw new Error("Choose a file or enter an image URL.");
}

async function dataUrlToImageBitmap(dataUrl) {
  const blob = await fetch(dataUrl).then((r) => r.blob());
  return createImageBitmap(blob);
}

/**
 * Drag-and-drop onto the file drop zone + show selected file name.
 */
function wireReferenceImageDrop(fileInput, fileDrop, fileNameEl, nameInput) {
  if (!fileInput || !fileDrop) return;

  function updateFileNameLabel() {
    const f = fileInput.files?.[0];
    if (!fileNameEl) return;
    if (f) {
      fileNameEl.textContent = `Selected: ${f.name}`;
      fileNameEl.hidden = false;
    } else {
      fileNameEl.textContent = "";
      fileNameEl.hidden = true;
    }
  }

  function applyMazeNameFromFile(file) {
    if (!nameInput || !file?.name) return;
    const stem = mazeNameFromFileName(file.name);
    if (!stem) return;
    nameInput.value = stem.slice(0, Number(nameInput.maxLength) || 96);
  }

  function setFileFromList(files) {
    if (!files?.length) return;
    const f = files[0];
    if (!f.type.startsWith("image/")) {
      if (statusEl) {
        statusEl.textContent =
          "Please drop an image file (PNG, JPEG, WebP, GIF, …).";
      }
      return;
    }
    const dt = new DataTransfer();
    dt.items.add(f);
    fileInput.files = dt.files;
    fileInput.dispatchEvent(new Event("change", { bubbles: true }));
  }

  fileDrop.addEventListener("dragenter", (e) => {
    e.preventDefault();
    fileDrop.classList.add("consciousness-file-drop--active");
  });
  fileDrop.addEventListener("dragleave", (e) => {
    e.preventDefault();
    const rt = e.relatedTarget;
    if (rt === null || !fileDrop.contains(rt)) {
      fileDrop.classList.remove("consciousness-file-drop--active");
    }
  });
  fileDrop.addEventListener("dragover", (e) => {
    e.preventDefault();
  });
  fileDrop.addEventListener("drop", (e) => {
    e.preventDefault();
    fileDrop.classList.remove("consciousness-file-drop--active");
    setFileFromList(e.dataTransfer?.files);
  });

  fileInput.addEventListener("change", () => {
    updateFileNameLabel();
    applyMazeNameFromFile(fileInput.files?.[0]);
  });
}

if (form && creatureId) {
  wireReferenceImageDrop(
    document.getElementById("consciousness-create-file"),
    document.getElementById("consciousness-create-file-drop"),
    document.getElementById("consciousness-create-file-name"),
    document.getElementById("consciousness-create-name")
  );

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const nameInput = document.getElementById("consciousness-create-name");
    const fileInput = document.getElementById("consciousness-create-file");
    const urlInput = document.getElementById("consciousness-create-url");
    const submit = form.querySelector('button[type="submit"]');
    const name = nameInput?.value?.trim();
    const file = fileInput?.files?.[0];
    const urlTrimmed = urlInput?.value?.trim() || "";
    if (!name) return;
    if (!file && !urlTrimmed) {
      if (statusEl) {
        statusEl.textContent =
          "Add a reference image file or paste a direct link to an image.";
      }
      return;
    }
    if (statusEl) statusEl.textContent = "Loading image…";
    if (submit) submit.disabled = true;
    try {
      const dataUrl = await getReferenceDataUrl(file, urlTrimmed);
      if (statusEl) {
        statusEl.textContent = "Tracing maze from your image…";
      }
      const bmp = await dataUrlToImageBitmap(dataUrl);
      const { cols, rows } = mazeGridSizeForImage(bmp.width, bmp.height);
      const { open } = imageToOpenGrid(bmp, cols, rows);
      const { start, end } = pickDefaultEndpoints(open, cols, rows);
      const mazeId = crypto.randomUUID();

      let aiCaption = `Layout traced from your reference (${cols}×${rows} cells: CV preprocess + Otsu; lighter = walkable).`;
      try {
        const cap = await fetch("/api/consciousness/maze-image-caption", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageBase64: dataUrl }),
        });
        if (cap.ok) {
          const j = await cap.json();
          if (j.caption) {
            aiCaption = `${String(j.caption).trim()} — ${aiCaption}`;
          }
        }
      } catch {
        /* optional BLIP */
      }

      const draft = {
        creatureId,
        mazeId,
        name,
        cols,
        rows,
        open,
        start,
        end,
        colors: {
          floor: "#c4a574",
          wall: "#5c4a3a",
          rim: "#8b7355",
          background: "#d4a574",
          fog: "#c9a66b",
        },
        aiCaption,
        referenceImageDataUrl: dataUrl,
      };
      try {
        sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
      } catch {
        delete draft.referenceImageDataUrl;
        sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
      }
      window.location.href = `/consciousness_generator.html?id=${encodeURIComponent(creatureId)}`;
    } catch (err) {
      console.error(err);
      if (statusEl) {
        statusEl.textContent =
          err?.message ||
          "Could not build a maze from the image. Try another file or URL.";
      }
      if (submit) submit.disabled = false;
    }
  });
}
