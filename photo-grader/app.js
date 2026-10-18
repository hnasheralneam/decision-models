(() => {
  "use strict";

  const DEFAULT_SERVER = "http://10.0.0.143:8080";
  const MAX_IMAGE_EDGE = 1600;
  const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
  const ANALYSIS_TIMEOUT_MS = 180_000;
  const CONCERN_THRESHOLD = 0.5;
  const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

  const queryServer = new URLSearchParams(window.location.search).get("server");
  const SERVER_URL = normalizeServer(queryServer || DEFAULT_SERVER);

  const STATE_TEXT = "This is a photograph submitted for a visual critique. Judge the photograph itself: its craft, framing, light, and impact. It may be a casual snapshot, so judge what is visible rather than assuming a professional workflow.";

  const ICONS = {
    lighting: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round"><circle cx="12" cy="12" r="4.1"/><path d="M12 2.2v2.1M12 19.7v2.1M2.2 12h2.1M19.7 12h2.1M4.9 4.9l1.5 1.5M17.6 17.6l1.5 1.5M19.1 4.9l-1.5 1.5M6.4 17.6l-1.5 1.5"/></svg>`,
    exposure: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.35"><circle cx="12" cy="12" r="8.6"/><path d="M12 3.4v17.2"/><path d="M12 3.4a8.6 8.6 0 0 1 0 17.2Z" fill="currentColor" stroke="none" opacity=".82"/></svg>`,
    framing: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round"><path d="M7 3.5v4H3M17 3.5v4h4M7 20.5v-4H3M17 20.5v-4h4"/></svg>`,
    focus: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round"><circle cx="12" cy="12" r="7.6"/><circle cx="12" cy="12" r="3.1"/><path d="M12 2v2.2M12 19.8V22M2 12h2.2M19.8 12H22"/></svg>`,
    composition: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.35"><rect x="3.4" y="3.4" width="17.2" height="17.2" rx="1.3"/><path d="M9.1 3.4v17.2M14.9 3.4v17.2M3.4 9.1h17.2M3.4 14.9h17.2" opacity=".66"/></svg>`,
    color: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linejoin="round"><path d="M12 3.5c3.4 3.9 5.7 6.8 5.7 9.5a5.7 5.7 0 0 1-11.4 0c0-2.7 2.3-5.6 5.7-9.5Z"/><path d="M9.5 13.1a2.5 2.5 0 0 0 2.5 2.5" stroke-linecap="round" opacity=".65"/></svg>`,
    background: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linejoin="round"><path d="m12 3.2 8 4.4-8 4.4-8-4.4 8-4.4Z"/><path d="m4 12 8 4.4 8-4.4M4 16.4l8 4.4 8-4.4" opacity=".7"/></svg>`,
    subject: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round"><circle cx="12" cy="8" r="3.3"/><path d="M5 20c.7-4 3.3-6.1 7-6.1s6.3 2.1 7 6.1"/></svg>`,
    overall: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linejoin="round"><circle cx="12" cy="12" r="8.7"/><path d="m12 3.4 5.5 12.9H6.5L12 3.4Z"/><path d="m12 20.7-5.5-12.9h11L12 20.7Z" opacity=".45"/><circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none"/></svg>`,
    check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.2 4.2L19 6.8"/></svg>`,
    arrow: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h13M13 6.5l5.5 5.5-5.5 5.5"/></svg>`,
  };

  const CHECKS = [
    {
      key: "lighting",
      label: "Lighting",
      hint: "quality, direction, and shape",
      icon: "lighting",
      question: "Is the lighting on the main subject good?",
      goodNote: "The light on the subject is doing its job.",
      followUp: "What change would most improve the lighting?",
      criteria: {
        "more light": "The subject is too dark and needs more light.",
        "less light": "The subject is too bright and needs less light.",
        "softer light": "The light is harsh and needs diffusion or softer light.",
        "different direction": "The light comes from an awkward direction.",
      },
      advice: {
        "more light": "Open the curtains, move toward a window, or raise exposure just enough to reveal detail in the subject.",
        "less light": "Shade the subject or pull the exposure down so the brightest areas keep their texture.",
        "softer light": "Diffuse the source with a sheer curtain, bounce it off a wall, or move the subject into open shade.",
        "different direction": "Move around the subject or turn it toward the light so the light shapes the face or object instead of flattening it.",
      },
      fallback: "Reshape the light before shooting again: move the subject, change the time of day, or add a simple bounce.",
    },
    {
      key: "exposure",
      label: "Exposure",
      hint: "highlights, shadows, and balance",
      icon: "exposure",
      question: "Is the exposure well balanced, with detail in both highlights and shadows?",
      goodNote: "Highlights and shadows are staying within a usable range.",
      followUp: "What exposure correction would help most?",
      criteria: {
        "brighten the image": "The photo is underexposed and needs to be brighter.",
        "darken the image": "The photo is overexposed and needs to be darker.",
        "recover the highlights": "Highlights are blown out and need recovery.",
        "lift the shadows": "Shadows are crushed and need more detail.",
      },
      advice: {
        "brighten the image": "Raise the exposure or add light, then check that the shadows still hold detail instead of turning grey.",
        "darken the image": "Lower the exposure or shade the subject so highlights stop clipping.",
        "recover the highlights": "Pull the highlights down and protect the brightest areas; bracket the shot if the range is too wide.",
        "lift the shadows": "Add a little fill light or lift the shadows in post so dark areas keep some texture.",
      },
      fallback: "Check the histogram and protect both ends of the range before you shoot again.",
    },
    {
      key: "framing",
      label: "Framing",
      hint: "crop, edges, and subject size",
      icon: "framing",
      question: "Is the photograph framed and cropped effectively?",
      goodNote: "The crop gives the subject room and keeps the edges clean.",
      followUp: "What framing change would improve the photo?",
      criteria: {
        "move closer": "The subject is too small; move closer or crop in.",
        "step back": "The subject is too tight; give it more room in the frame.",
        "reposition the subject": "The subject sits awkwardly inside the frame.",
        "straighten the frame": "The frame or horizon is tilted and needs leveling.",
      },
      advice: {
        "move closer": "Step in or crop so the subject fills more of the frame; remove empty space that is not doing work.",
        "step back": "Give the subject breathing room and check that nothing important is cut off at the edges.",
        "reposition the subject": "Shift the subject toward a third or leave space in the direction it faces.",
        "straighten the frame": "Level the horizon and check verticals; a small rotation often makes the whole frame feel calmer.",
      },
      fallback: "Refine the crop around the subject and check all four edges for interruptions.",
    },
    {
      key: "focus",
      label: "Focus",
      hint: "sharpness where it matters",
      icon: "focus",
      question: "Is the main subject sharp and in focus?",
      goodNote: "The important detail in the frame reads sharp.",
      followUp: "What is the focus problem?",
      criteria: {
        "missed focus": "The intended subject is not in focus.",
        "motion blur": "Camera or subject movement is blurring the image.",
        "deeper depth of field": "Too little of the scene is sharp.",
        "focus on another area": "Focus landed on the wrong part of the frame.",
      },
      advice: {
        "missed focus": "Lock focus on the subject's eyes or the key detail, then refocus and shoot again.",
        "motion blur": "Use a faster shutter speed or steady the camera; ask a moving subject to pause.",
        "deeper depth of field": "Stop the aperture down or move farther back so more of the subject stays sharp.",
        "focus on another area": "Move the focus point onto the intended subject instead of letting the camera pick.",
      },
      fallback: "Re-check focus on the most important detail and steady the camera.",
    },
    {
      key: "composition",
      label: "Composition",
      hint: "balance, space, and viewpoint",
      icon: "composition",
      question: "Is the composition balanced and visually pleasing?",
      goodNote: "The elements settle into a balanced frame.",
      followUp: "What would strengthen the composition?",
      criteria: {
        "simplify the frame": "Too many elements are competing for attention.",
        "rebalance the space": "The space around the subject feels awkward.",
        "change the angle": "A different viewpoint would be stronger.",
        "reposition the subject": "The subject placement feels off.",
      },
      advice: {
        "simplify the frame": "Remove or crop out anything that does not support the subject; fewer elements usually means a stronger read.",
        "rebalance the space": "Give the subject more room in the direction it faces, or crop the empty space that creates tension.",
        "change the angle": "Try a higher, lower, or side-on viewpoint; move until the subject separates from its surroundings.",
        "reposition the subject": "Move the subject to a stronger point in the frame, then check the balance of the remaining space.",
      },
      fallback: "Simplify the frame and move around the subject until the balance feels intentional.",
    },
    {
      key: "color",
      label: "Color",
      hint: "white balance and saturation",
      icon: "color",
      question: "Are the colors natural and well balanced?",
      goodNote: "The color balance feels natural and controlled.",
      followUp: "What color adjustment would help most?",
      criteria: {
        "warmer": "The photo is too cool and needs more warmth.",
        "cooler": "The photo is too warm and needs cooling.",
        "less saturation": "Colors are oversaturated and need to come down.",
        "more saturation": "Colors look flat and need more life.",
      },
      advice: {
        "warmer": "Warm the white balance slightly or shoot closer to golden hour; keep skin tones natural.",
        "cooler": "Cool the white balance a little or move the subject out of very warm light.",
        "less saturation": "Pull saturation back, especially in reds and greens, so the image feels less processed.",
        "more saturation": "Add a little vibrance or richer light, but avoid pushing skin tones past natural.",
      },
      fallback: "Set a neutral white balance and adjust saturation gently.",
    },
    {
      key: "background",
      label: "Background",
      hint: "clutter and separation",
      icon: "background",
      question: "Is the background clean and free of distracting elements?",
      goodNote: "The background stays out of the subject's way.",
      followUp: "How should the background be improved?",
      criteria: {
        "simplify the background": "The background is cluttered.",
        "blur the background": "The background needs more separation from the subject.",
        "move the subject": "The subject merges with something behind it.",
        "change the angle": "A different angle would clean up the background.",
      },
      advice: {
        "simplify the background": "Crop or reposition to remove clutter; a plain wall or open sky is often enough.",
        "blur the background": "Open the aperture or move the subject farther from the background to create separation.",
        "move the subject": "Shift the subject so it does not merge with a pole, line, or bright patch behind it.",
        "change the angle": "Move a few steps to the side or lower the camera until the background simplifies.",
      },
      fallback: "Reduce background competition by simplifying the scene or changing your position.",
    },
    {
      key: "subject",
      label: "Subject clarity",
      hint: "is the focal point obvious",
      icon: "subject",
      question: "Is the main subject immediately clear to a viewer?",
      goodNote: "The main subject is easy to identify.",
      followUp: "What would make the subject clearer?",
      criteria: {
        "move closer": "The subject is too small in the frame.",
        "isolate the subject": "Competing elements are obscuring the subject.",
        "choose a clearer subject": "There is no obvious main subject.",
        "change the angle": "The subject is partly hidden from this viewpoint.",
      },
      advice: {
        "move closer": "Fill more of the frame with the subject so a viewer knows where to look first.",
        "isolate the subject": "Remove competing elements or use light and depth of field to separate the subject.",
        "choose a clearer subject": "Pick one focal point and let the rest of the frame recede; a photo can only lead with one idea.",
        "change the angle": "Find an angle where the subject is not hidden by another object or lost against the background.",
      },
      fallback: "Make the main subject unmistakable through size, light, or placement.",
    },
  ];

  const OVERALL = {
    key: "overall",
    label: "Overall impact",
    hint: "would it hold a viewer's attention",
    icon: "overall",
    question: "Would this photograph read as strong and finished overall?",
  };

  const $ = (selector) => document.querySelector(selector);

  const dropzone = $("#dropzone");
  const fileInput = $("#fileInput");
  const photoStage = $("#photoStage");
  const photoFrame = $("#photoFrame");
  const photoImg = $("#photoImg");
  const photoBadge = $("#photoBadge");
  const photoName = $("#photoName");
  const photoDetails = $("#photoDetails");
  const removePhotoButton = $("#removePhoto");
  const replacePhotoButton = $("#replacePhoto");
  const gradeAgainButton = $("#gradeAgain");
  const uploadError = $("#uploadError");
  const readTitle = $("#readTitle");
  const readEmpty = $("#readEmpty");
  const readLoading = $("#readLoading");
  const readError = $("#readError");
  const readResults = $("#readResults");
  const checkList = $("#checkList");
  const copyJsonButton = $("#copyJson");
  const serverStatus = $("#serverStatus");
  const serverStatusText = $("#serverStatusText");
  const modelBadge = $("#modelBadge");
  const elapsedLabel = $("#elapsed");
  const analysisPhrase = $("#analysisPhrase");
  const analysisSub = $("#analysisSub");
  const analysisNote = $("#analysisNote");
  const errorText = $("#errorText");
  const retryButton = $("#retryButton");
  const scoreRing = $("#scoreRing");
  const scoreValue = $("#scoreValue");
  const verdictChip = $("#verdictChip");
  const verdictTitle = $("#verdictTitle");
  const verdictSummary = $("#verdictSummary");
  const resultMeta = $("#resultMeta");
  const fixCount = $("#fixCount");
  const fixList = $("#fixList");
  const passCount = $("#passCount");
  const passList = $("#passList");
  const followupNote = $("#followupNote");
  const rawJson = $("#rawJson");

  const state = {
    image: null,
    imageToken: 0,
    runId: 0,
    loading: false,
    controller: null,
    timeout: null,
    timer: null,
    startedAt: 0,
    primary: null,
    followUp: null,
    lastReport: null,
    followUpError: null,
  };

  const READ_TITLES = {
    empty: "What the model checks",
    loading: "Reading your photo",
    error: "Something went wrong",
    results: "Your photo report",
  };

  function normalizeServer(value) {
    const trimmed = String(value || "").trim().replace(/\/+$/, "");
    if (!/^https?:\/\/.+/i.test(trimmed)) return DEFAULT_SERVER;
    return trimmed;
  }

  function makeElement(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function makeIcon(name, className = "check-icon") {
    const span = makeElement("span", className);
    span.innerHTML = ICONS[name] || ICONS.overall;
    span.setAttribute("aria-hidden", "true");
    return span;
  }

  function clamp(value, min = 0, max = 1) {
    return Math.min(max, Math.max(min, Number(value) || 0));
  }

  function formatPercent(value, digits = 0) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return "—";
    return `${(numeric * 100).toFixed(digits)}%`;
  }

  function formatLatency(milliseconds) {
    if (!Number.isFinite(milliseconds)) return "—";
    if (milliseconds < 1000) return `${Math.round(milliseconds)} ms`;
    return `${(milliseconds / 1000).toFixed(1)} s`;
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function formatClock(milliseconds) {
    const seconds = Math.max(0, Math.floor(milliseconds / 1000));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  }

  function humanizeChoice(choice) {
    const text = String(choice ?? "").trim().replaceAll("_", " ").replaceAll("-", " ");
    if (!text) return "—";
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  function maskServer(server) {
    return server.replace(/^https?:\/\//i, "");
  }

  function setServerStatus(kind, text, title) {
    serverStatus.classList.remove("is-checking", "is-online", "is-offline");
    serverStatus.classList.add(`is-${kind}`);
    serverStatusText.textContent = text;
    serverStatus.title = title || text;
  }

  async function checkServer() {
    setServerStatus("checking", "Connecting…", "Checking the llama server…");
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 5000);

    try {
      const healthResponse = await fetch(`${SERVER_URL}/health`, {
        signal: controller.signal,
        cache: "no-store",
        credentials: "omit",
      });
      if (!healthResponse.ok) {
        throw new Error(`Health check returned HTTP ${healthResponse.status}`);
      }

      let model = "clef-flash";
      try {
        const modelsResponse = await fetch(`${SERVER_URL}/v1/models`, {
          signal: controller.signal,
          cache: "no-store",
          credentials: "omit",
        });
        if (modelsResponse.ok) {
          const data = await modelsResponse.json();
          model = data?.data?.[0]?.id || data?.models?.[0]?.name || model;
        }
      } catch {
        // The health endpoint alone is enough to show the server as online.
      }

      setServerStatus("online", `${model} online`, `${SERVER_URL}/health · click to recheck`);
      modelBadge.textContent = model;
      modelBadge.hidden = false;
    } catch (error) {
      const timedOut = error?.name === "AbortError";
      setServerStatus(
        "offline",
        timedOut ? "Server timeout" : "Server offline",
        `Could not reach ${SERVER_URL}/health · click to retry`,
      );
    } finally {
      window.clearTimeout(timer);
    }
  }

  function renderCheckList() {
    const fragment = document.createDocumentFragment();
    [...CHECKS, OVERALL].forEach((check, index) => {
      const item = makeElement("li", "check-item");
      const copy = makeElement("div", "check-item-copy");
      copy.append(
        makeElement("strong", null, check.label),
        makeElement("span", null, check.hint),
      );
      item.append(
        makeIcon(check.icon),
        copy,
        makeElement("span", "check-number", String(index + 1).padStart(2, "0")),
      );
      fragment.append(item);
    });
    checkList.replaceChildren(fragment);
  }

  function setRead(kind) {
    readTitle.textContent = READ_TITLES[kind];
    readEmpty.hidden = kind !== "empty";
    readLoading.hidden = kind !== "loading";
    readError.hidden = kind !== "error";
    readResults.hidden = kind !== "results";
    copyJsonButton.hidden = kind !== "results";
  }

  function updateStep(stepNumber, status, title, subtitle) {
    const step = document.querySelector(`.step[data-step="${stepNumber}"]`);
    if (!step) return;
    step.classList.remove("is-active", "is-done", "is-skipped", "is-error");
    if (status) step.classList.add(`is-${status}`);
    if (title) step.querySelector("strong").textContent = title;
    if (subtitle) step.querySelector("span:not(.step-node)").textContent = subtitle;
  }

  function resetSteps() {
    updateStep(1, "done");
    updateStep(2, "", "Score the checks", "Nine reads in a single forward pass");
    updateStep(3, "", "Follow up on weak spots", "Only checks above the 50% concern line");
    elapsedLabel.textContent = "0:00";
    analysisPhrase.textContent = "Reading the frame";
    analysisSub.textContent = "Sending the photograph for its first read.";
    analysisNote.textContent = "The first read usually takes a few seconds.";
  }

  function startTimer() {
    stopTimer();
    state.startedAt = performance.now();
    elapsedLabel.textContent = "0:00";
    state.timer = window.setInterval(() => {
      elapsedLabel.textContent = formatClock(performance.now() - state.startedAt);
    }, 1000);
  }

  function stopTimer() {
    if (state.timer) {
      window.clearInterval(state.timer);
      state.timer = null;
    }
  }

  function setScanning(isScanning) {
    photoFrame.classList.toggle("is-scanning", isScanning);
    photoBadge.hidden = !isScanning;
  }

  function setGradeButtonLoading(isLoading) {
    gradeAgainButton.disabled = isLoading;
    gradeAgainButton.classList.toggle("is-loading", isLoading);
    gradeAgainButton.querySelector(".button-label").textContent = isLoading ? "Reading…" : "Analyze again";
  }

  function showUploadError(message) {
    uploadError.textContent = message;
    uploadError.hidden = false;
  }

  function clearUploadError() {
    uploadError.hidden = true;
    uploadError.textContent = "";
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("The photograph could not be read."));
      reader.readAsDataURL(file);
    });
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("The photograph could not be prepared."));
      }, type, quality);
    });
  }

  async function decodeWithFallback(file) {
    if ("createImageBitmap" in window) {
      try {
        return await createImageBitmap(file, { imageOrientation: "from-image" });
      } catch {
        // Fall back to an HTML image element.
      }
    }

    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      return image;
    } finally {
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }

  async function preparePhoto(file) {
    if (!IMAGE_TYPES.has(file.type)) {
      throw new Error("Use a JPG, PNG, WEBP, or GIF photograph.");
    }
    if (file.size > MAX_IMAGE_BYTES) {
      throw new Error("That file is larger than 25 MB. Choose a smaller photograph.");
    }

    const bitmap = await decodeWithFallback(file);
    const width = bitmap.width;
    const height = bitmap.height;
    if (!width || !height) {
      throw new Error("The photograph dimensions could not be read.");
    }

    const needsResize = Math.max(width, height) > MAX_IMAGE_EDGE;
    const serverSafeOriginal = file.type === "image/jpeg" || file.type === "image/png";
    if (!needsResize && file.size <= 4 * 1024 * 1024 && serverSafeOriginal) {
      return {
        dataUrl: await readFileAsDataUrl(file),
        name: file.name || "pasted-photo",
        width,
        height,
        bytes: file.size,
      };
    }

    const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(width, height));
    const targetWidth = Math.max(1, Math.round(width * scale));
    const targetHeight = Math.max(1, Math.round(height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;

    const context = canvas.getContext("2d");
    if (!context) throw new Error("Your browser could not prepare this photograph.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, targetWidth, targetHeight);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
    if (typeof bitmap.close === "function") bitmap.close();

    const blob = await canvasToBlob(canvas, "image/jpeg", 0.92);
    return {
      dataUrl: await readFileAsDataUrl(blob),
      name: file.name || "pasted-photo",
      width: targetWidth,
      height: targetHeight,
      bytes: blob.size,
    };
  }

  function showPhoto(image) {
    state.image = image;
    photoImg.src = image.dataUrl;
    photoImg.alt = `Photograph selected for grading: ${image.name}`;
    photoName.textContent = image.name;
    photoDetails.textContent = `${image.width} × ${image.height} · ${formatBytes(image.bytes)}`;
    dropzone.hidden = true;
    photoStage.hidden = false;
    clearUploadError();
    setScanning(false);
  }

  function clearPhoto() {
    state.imageToken += 1;
    state.runId += 1;
    window.clearTimeout(state.timeout);
    state.controller?.abort();
    state.controller = null;
    state.loading = false;
    stopTimer();
    setScanning(false);
    state.image = null;
    state.primary = null;
    state.followUp = null;
    state.lastReport = null;
    state.followUpError = null;
    fileInput.value = "";
    photoImg.removeAttribute("src");
    photoStage.hidden = true;
    dropzone.hidden = false;
    setGradeButtonLoading(false);
    setRead("empty");
    clearUploadError();
  }

  async function acceptPhoto(file) {
    if (!file) return;
    clearUploadError();
    const token = ++state.imageToken;
    const name = file.name || "pasted-photo";

    try {
      const image = await preparePhoto(file);
      if (token !== state.imageToken) return;
      image.name = name;
      showPhoto(image);
      startAnalysis();
    } catch (error) {
      if (token !== state.imageToken) return;
      showUploadError(error.message || "The photograph could not be prepared.");
    }
  }

  async function handleFiles(fileList) {
    const file = [...(fileList || [])].find((candidate) => candidate.type.startsWith("image/"));
    if (!file) {
      showUploadError("Choose a photograph to grade.");
      return;
    }
    await acceptPhoto(file);
  }

  function buildPrimaryPayload(image) {
    const questions = {};
    [...CHECKS, OVERALL].forEach((check) => {
      questions[check.key] = {
        type: "noul",
        instructions: check.question,
      };
    });
    return {
      state: STATE_TEXT,
      images: [image.dataUrl],
      questions,
    };
  }

  function buildFollowUpPayload(image, flagged) {
    const questions = {};
    flagged.forEach((check) => {
      questions[check.key] = {
        type: "choice",
        instructions: check.followUp,
        criteria: check.criteria,
      };
    });
    const names = flagged.map((check) => check.label.toLowerCase()).join(", ");
    return {
      state: `${STATE_TEXT} A first pass raised concerns about ${names}. For each question, choose the single correction that would most improve the photograph.`,
      images: [image.dataUrl],
      questions,
    };
  }

  async function postSystemOne(payload, signal) {
    let response;
    try {
      response = await fetch(`${SERVER_URL}/v1/systemone`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal,
        credentials: "omit",
      });
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      throw new Error(`Could not reach the llama server at ${SERVER_URL}. Check that it is online.`);
    }

    const responseText = await response.text();
    let data;
    try {
      data = JSON.parse(responseText);
    } catch {
      throw new Error(`The server returned an unreadable response (HTTP ${response.status}).`);
    }

    if (!response.ok) {
      throw new Error(data?.error?.message || data?.message || `The server returned HTTP ${response.status}.`);
    }
    if (!data.answers || typeof data.answers !== "object") {
      throw new Error("The server response did not include any answers.");
    }
    return data;
  }

  function getPositiveAnswer(answers, key) {
    const answer = answers?.[key];
    if (!answer || answer.type !== "noul") return null;
    const probability = Number(answer.noul);
    return Number.isFinite(probability) ? clamp(probability) : null;
  }

  function interpret(primary, followUp) {
    const answers = primary.answers || {};
    const checks = CHECKS.map((check) => {
      const good = getPositiveAnswer(answers, check.key);
      const concern = good === null ? null : 1 - good;
      const answer = followUp?.answers?.[check.key];
      const choice = answer?.type === "choice" && answer.choice ? answer.choice : null;
      const choiceProbability = choice && answer?.probabilities
        ? Number(answer.probabilities[choice])
        : null;
      return {
        ...check,
        good,
        concern,
        flagged: concern !== null && concern > CONCERN_THRESHOLD,
        followUpAnswer: choice ? {
          choice,
          probability: Number.isFinite(choiceProbability) ? choiceProbability : null,
        } : null,
      };
    });

    const overall = getPositiveAnswer(answers, "overall");
    const scored = checks.filter((check) => check.good !== null);
    if (!scored.length) {
      throw new Error("The model did not return a readable score for any check.");
    }

    const average = scored.reduce((sum, check) => sum + check.good, 0) / scored.length;
    const score = Math.round(clamp(overall ?? average) * 100);
    const flagged = checks.filter((check) => check.flagged).sort((a, b) => b.concern - a.concern);
    const passed = checks
      .filter((check) => check.good !== null && !check.flagged)
      .sort((a, b) => b.good - a.good);
    const unread = checks.filter((check) => check.good === null);

    return { checks, flagged, passed, unread, overall, score };
  }

  function scoreTone(score) {
    if (score >= 85) {
      return { className: "is-strong", color: "#a8cf9f", chip: "Strong frame", title: "This frame holds up." };
    }
    if (score >= 70) {
      return { className: "", color: "#ffb454", chip: "Almost there", title: "A few fixes would lift this frame." };
    }
    if (score >= 50) {
      return { className: "", color: "#e6a45a", chip: "Needs another pass", title: "The frame needs another look." };
    }
    return { className: "is-weak", color: "#ff7a63", chip: "Worth a re-shoot", title: "This one is worth re-shooting." };
  }

  function renderSummary(report) {
    const { score, flagged } = report;
    const tone = scoreTone(score);
    scoreValue.textContent = String(score);
    scoreRing.style.setProperty("--score", "0");
    scoreRing.style.setProperty("--score-color", tone.color);
    verdictChip.className = `verdict-chip ${tone.className}`.trim();
    verdictChip.textContent = tone.chip;

    let title = tone.title;
    if (flagged.length === 1) title = "One clear fix would lift this frame.";
    if (flagged.length >= 2 && flagged.length <= 3) title = "A few fixes would lift this frame.";
    if (flagged.length >= 4) title = "This frame needs another pass.";
    verdictTitle.textContent = title;

    verdictSummary.replaceChildren(
      document.createTextNode(
        report.overall === null
          ? "Across the checks, the photo averages "
          : "The model gives this photo a ",
      ),
      makeElement("strong", null, `${score}%`),
      document.createTextNode(
        report.overall === null
          ? " for reading as a strong photograph. "
          : " chance of reading as a strong photograph overall. ",
      ),
    );

    if (!flagged.length) {
      verdictSummary.append("Every individual check stayed below the 50% concern line.");
    } else if (flagged.length === 1) {
      verdictSummary.append(`${flagged[0].label} is the clearest place to start.`);
    } else {
      verdictSummary.append(`${flagged[0].label} and ${flagged[1].label.toLowerCase()} are the biggest opportunities.`);
    }

    window.requestAnimationFrame(() => {
      scoreRing.style.setProperty("--score", String(score));
    });
  }

  function renderMeta(report, elapsed, inputTokens) {
    resultMeta.replaceChildren(
      makeMetaChip("model", modelBadge.textContent || "clef-flash"),
      makeMetaChip("time", formatLatency(elapsed)),
      makeMetaChip("input", `${Number(inputTokens || 0).toLocaleString()} tok`),
      makeMetaChip(report.flagged.length === 1 ? "follow-up" : "follow-ups", String(report.flagged.length)),
    );
  }

  function makeMetaChip(label, value) {
    const chip = makeElement("span", "meta-chip");
    chip.append(document.createTextNode(label), makeElement("strong", null, value));
    return chip;
  }

  function renderFixCard(check, index) {
    const card = makeElement("article", "fix-card");
    card.style.animationDelay = `${index * 55}ms`;

    const head = makeElement("div", "fix-head");
    const title = makeElement("div", "fix-title");
    title.append(
      makeElement("span", null, "Needs attention"),
      makeElement("h4", null, check.label),
    );
    head.append(
      makeIcon(check.icon),
      title,
      makeElement("span", "concern-badge", `${formatPercent(check.concern, 1)} concern`),
    );

    const meter = makeElement("div", "fix-meter");
    const track = makeElement("span", "meter-track");
    const fill = makeElement("i", "meter-fill");
    track.append(fill);
    meter.append(
      track,
      makeElement("span", null, `${formatPercent(check.good, 1)} good`),
      makeElement("span", null, `${formatPercent(check.concern, 1)} concern`),
    );

    const finding = makeElement("p", "fix-finding");
    const follow = check.followUpAnswer;
    if (follow) {
      finding.append(
        document.createTextNode("The follow-up points to "),
        makeElement("strong", null, humanizeChoice(follow.choice)),
        document.createTextNode(follow.probability === null
          ? "."
          : ` (${Math.round(follow.probability * 100)}%).`),
      );
    } else {
      finding.append("The follow-up was unavailable, so this is general guidance for the first-pass concern.");
    }

    card.append(head, meter, finding);

    if (follow) {
      const correction = makeElement("div", "correction");
      correction.append(
        document.createTextNode("model correction"),
        makeElement("strong", null, humanizeChoice(follow.choice)),
      );
      if (follow.probability !== null) {
        correction.append(makeElement("span", null, `${Math.round(follow.probability * 100)}%`));
      }
      correction.title = "The model's preferred correction from the follow-up pass";
      card.append(correction);
    }

    const advice = check.advice[follow?.choice] || check.fallback;
    card.append(makeElement("p", "fix-advice", advice));

    window.requestAnimationFrame(() => {
      fill.style.width = `${Math.round(check.concern * 100)}%`;
    });
    return card;
  }

  function renderPassCard(check, index) {
    const card = makeElement("article", "pass-card");
    card.style.animationDelay = `${index * 45}ms`;

    const head = makeElement("div", "pass-head");
    head.append(
      makeIcon(check.icon),
      makeElement("span", "pass-label", check.label),
      makeElement("span", "pass-score", `${Math.round(check.good * 100)}% good`),
    );

    const meter = makeElement("span", "mini-meter");
    const fill = makeElement("i");
    meter.append(fill);

    card.append(head, makeElement("p", null, check.goodNote), meter);
    window.requestAnimationFrame(() => {
      fill.style.width = `${Math.round(check.good * 100)}%`;
    });
    return card;
  }

  function renderReport(report, primary, followUp, elapsed, followUpError) {
    renderSummary(report);
    const inputTokens = Number(primary?.usage?.input_tokens || 0) + Number(followUp?.usage?.input_tokens || 0);
    renderMeta(report, elapsed, inputTokens);

    fixCount.textContent = report.flagged.length
      ? `${report.flagged.length} of ${CHECKS.length}`
      : "none";
    fixList.replaceChildren();

    if (report.flagged.length) {
      report.flagged.forEach((check, index) => {
        fixList.append(renderFixCard(check, index));
      });
    } else {
      const clear = makeElement("div", "no-fixes");
      const copy = makeElement("div");
      copy.append(
        makeElement("strong", null, "No priority fixes"),
        makeElement("p", null, "Every check stayed below the 50% concern line."),
      );
      clear.append(makeIcon("check"), copy);
      fixList.append(clear);
    }

    passCount.textContent = report.passed.length
      ? `${report.passed.length} of ${CHECKS.length}`
      : "none";
    passList.replaceChildren();
    if (report.passed.length) {
      report.passed.forEach((check, index) => {
        passList.append(renderPassCard(check, index));
      });
    } else {
      passList.append(makeElement("p", "empty-note", "Every check came back above the concern line. Start with the first fix above."));
    }

    const notes = [];
    if (followUpError) {
      notes.push(`Specific follow-up advice could not be loaded (${followUpError}). The fixes above use general guidance.`);
    }
    if (report.unread.length) {
      notes.push(`No readable score came back for ${report.unread.map((check) => check.label.toLowerCase()).join(", ")}.`);
    }
    followupNote.hidden = notes.length === 0;
    followupNote.textContent = notes.join(" ");

    rawJson.textContent = JSON.stringify({ primary, followUp }, null, 2);
    copyJsonButton.querySelector("span").textContent = "Copy JSON";
    setRead("results");
  }

  async function startAnalysis() {
    if (!state.image) return;

    window.clearTimeout(state.timeout);
    state.controller?.abort();
    const runId = ++state.runId;
    const image = state.image;
    const controller = new AbortController();
    state.controller = controller;
    state.loading = true;
    state.primary = null;
    state.followUp = null;
    state.lastReport = null;
    state.followUpError = null;

    setRead("loading");
    resetSteps();
    setScanning(true);
    setGradeButtonLoading(true);
    startTimer();
    updateStep(2, "active");
    analysisSub.textContent = "The model is scoring all nine reads in one forward pass.";
    analysisNote.textContent = "The first read usually takes a few seconds.";

    state.timeout = window.setTimeout(() => controller.abort(), ANALYSIS_TIMEOUT_MS);

    try {
      const primary = await postSystemOne(buildPrimaryPayload(image), controller.signal);
      if (runId !== state.runId) return;
      state.primary = primary;
      updateStep(2, "done");

      let followUp = null;
      let followUpError = null;
      let report;
      try {
        report = interpret(primary, null);
      } catch (error) {
        throw error;
      }

      if (report.flagged.length) {
        const names = report.flagged.map((check) => check.label.toLowerCase());
        analysisPhrase.textContent = "Following up on the weak spots";
        analysisSub.textContent = `Asking what to change with ${names.join(", ")}.`;
        analysisNote.textContent = "One batched follow-up question for each check above 50% concern.";
        updateStep(3, "active");

        try {
          followUp = await postSystemOne(buildFollowUpPayload(image, report.flagged), controller.signal);
          if (runId !== state.runId) return;
          state.followUp = followUp;
          updateStep(3, "done");
        } catch (error) {
          if (error?.name === "AbortError") throw error;
          followUpError = error?.message || "The follow-up request failed.";
          state.followUpError = followUpError;
          updateStep(3, "error");
        }
      } else {
        updateStep(3, "skipped", "No follow-up needed", "Every check stayed below 50% concern.");
      }

      if (runId !== state.runId) return;
      report = interpret(primary, followUp);
      state.lastReport = { report, primary, followUp, followUpError };
      const elapsed = performance.now() - state.startedAt;
      renderReport(report, primary, followUp, elapsed, followUpError);
    } catch (error) {
      if (runId !== state.runId) return;
      if (error?.name === "AbortError") {
        errorText.textContent = "The analysis timed out. Check the server or try a smaller photograph.";
      } else {
        errorText.textContent = error?.message || "The model could not grade this photograph.";
      }
      setRead("error");
      copyJsonButton.hidden = true;
    } finally {
      window.clearTimeout(state.timeout);
      if (runId === state.runId) {
        state.loading = false;
        state.controller = null;
        stopTimer();
        setScanning(false);
        setGradeButtonLoading(false);
      }
    }
  }

  function fallbackCopy(text) {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.append(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    if (!copied) throw new Error("Copy failed");
  }

  async function copyJson() {
    if (!state.lastReport) return;
    const text = JSON.stringify({
      primary: state.lastReport.primary,
      followUp: state.lastReport.followUp,
    }, null, 2);
    const label = copyJsonButton.querySelector("span");
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
      else fallbackCopy(text);
      label.textContent = "Copied";
      window.setTimeout(() => { label.textContent = "Copy JSON"; }, 1600);
    } catch {
      label.textContent = "Copy failed";
      window.setTimeout(() => { label.textContent = "Copy JSON"; }, 1600);
    }
  }

  function openFilePicker() {
    fileInput.value = "";
    fileInput.click();
  }

  // Initial state -----------------------------------------------------------
  $("#endpointText").textContent = maskServer(SERVER_URL);
  $("#errorServer").textContent = maskServer(SERVER_URL);
  document.querySelector(".endpoint").title = SERVER_URL;
  serverStatus.setAttribute("aria-live", "polite");
  renderCheckList();
  checkServer();

  // Events ------------------------------------------------------------------
  dropzone.addEventListener("click", openFilePicker);
  dropzone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openFilePicker();
    }
  });
  fileInput.addEventListener("change", () => handleFiles(fileInput.files));
  replacePhotoButton.addEventListener("click", openFilePicker);
  removePhotoButton.addEventListener("click", clearPhoto);
  gradeAgainButton.addEventListener("click", startAnalysis);
  retryButton.addEventListener("click", startAnalysis);
  copyJsonButton.addEventListener("click", copyJson);
  serverStatus.addEventListener("click", checkServer);

  ["dragenter", "dragover"].forEach((type) => {
    dropzone.addEventListener(type, (event) => {
      event.preventDefault();
      event.stopPropagation();
      dropzone.classList.add("is-dragging");
    });
  });
  dropzone.addEventListener("dragleave", (event) => {
    if (!dropzone.contains(event.relatedTarget)) dropzone.classList.remove("is-dragging");
  });
  dropzone.addEventListener("drop", (event) => {
    event.preventDefault();
    event.stopPropagation();
    dropzone.classList.remove("is-dragging");
    handleFiles(event.dataTransfer?.files);
  });

  window.addEventListener("dragover", (event) => event.preventDefault());
  window.addEventListener("drop", (event) => {
    if (!dropzone.contains(event.target)) event.preventDefault();
  });

  document.addEventListener("paste", (event) => {
    const item = [...(event.clipboardData?.items || [])].find((entry) => entry.type.startsWith("image/"));
    if (!item) return;
    const file = item.getAsFile();
    if (file) {
      event.preventDefault();
      acceptPhoto(file);
    }
  });
})();
