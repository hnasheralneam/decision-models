(() => {
  "use strict";

  const DEFAULT_SERVER = "http://10.0.0.143:8080";
  const MAX_IMAGE_EDGE = 1600;
  const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
  const REQUEST_TIMEOUT_MS = 120_000;
  const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

  const queryServer = new URLSearchParams(window.location.search).get("server");
  const SERVER_URL = normalizeServer(queryServer || DEFAULT_SERVER);

  const $ = (selector) => document.querySelector(selector);
  const form = $("#decisionForm");
  const questionsEl = $("#questions");
  const dropzone = $("#dropzone");
  const fileInput = $("#fileInput");
  const stateInput = $("#stateInput");
  const charCount = $("#charCount");
  const questionCount = $("#questionCount");
  const imagePreview = $("#imagePreview");
  const previewImg = $("#previewImg");
  const previewName = $("#previewName");
  const previewDetails = $("#previewDetails");
  const removeImageButton = $("#removeImage");
  const addQuestionButton = $("#addQuestion");
  const runButton = $("#runButton");
  const formError = $("#formError");
  const serverStatus = $("#serverStatus");
  const serverStatusText = $("#serverStatusText");
  const modelBadge = $("#modelBadge");
  const outputEmpty = $("#outputEmpty");
  const outputLoading = $("#outputLoading");
  const outputError = $("#outputError");
  const errorMessage = $("#errorMessage");
  const resultArea = $("#resultArea");
  const resultMeta = $("#resultMeta");
  const answersEl = $("#answers");
  const rawJson = $("#rawJson");
  const copyJsonButton = $("#copyJson");

  const state = {
    image: null,
    loading: false,
    lastResponse: null,
    imageToken: 0,
  };

  const X_ICON = `
    <svg viewBox="0 0 20 20" width="13" height="13" fill="none"
      stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
      <path d="m5 5 10 10M15 5 5 15"/>
    </svg>`;

  class ValidationError extends Error {
    constructor(message, target) {
      super(message);
      this.name = "ValidationError";
      this.target = target;
    }
  }

  function normalizeServer(value) {
    const trimmed = String(value || "").trim().replace(/\/+$/, "");
    if (!/^https?:\/\/.+/i.test(trimmed)) {
      return DEFAULT_SERVER;
    }
    return trimmed;
  }

  function makeElement(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function humanizeLabel(label) {
    const text = String(label ?? "").trim().replaceAll("_", " ").replaceAll("-", " ");
    if (!text) return "—";
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  function formatPercent(value, digits = 1) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return "—";
    return `${(numeric * 100).toFixed(digits)}%`;
  }

  function formatLatency(milliseconds) {
    if (!Number.isFinite(milliseconds)) return "—";
    if (milliseconds < 1000) return `${Math.round(milliseconds)} ms`;
    return `${(milliseconds / 1000).toFixed(2)} s`;
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
          const models = await modelsResponse.json();
          model = models?.data?.[0]?.id || models?.models?.[0]?.name || model;
        }
      } catch {
        // /health is enough to consider the server online.
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

  function updateCounts() {
    charCount.textContent = `${stateInput.value.length} / 8000`;
    const total = questionsEl.querySelectorAll(".question-card").length;
    questionCount.textContent = `${total} ${total === 1 ? "question" : "questions"}`;
  }

  function updateQuestionNumbers() {
    questionsEl.querySelectorAll(".question-card").forEach((card, index) => {
      card.querySelector(".question-number").textContent = String(index + 1).padStart(2, "0");
    });
    updateCounts();
  }

  function showFormError(message, target) {
    formError.textContent = message;
    formError.hidden = false;
    if (target && typeof target.focus === "function") {
      target.focus({ preventScroll: true });
      target.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  function clearFormError() {
    formError.hidden = true;
    formError.textContent = "";
  }

  function createChoiceRow(label = "", description = "") {
    const row = makeElement("div", "choice-row");
    const labelInput = document.createElement("input");
    labelInput.type = "text";
    labelInput.className = "option-label";
    labelInput.placeholder = "Option";
    labelInput.value = label;
    labelInput.setAttribute("aria-label", "Option label");

    const descriptionInput = document.createElement("input");
    descriptionInput.type = "text";
    descriptionInput.className = "option-desc";
    descriptionInput.placeholder = "Description (optional)";
    descriptionInput.value = description;
    descriptionInput.setAttribute("aria-label", "Option description");

    const remove = makeElement("button", "remove-row");
    remove.type = "button";
    remove.dataset.action = "remove-option";
    remove.setAttribute("aria-label", "Remove option");
    remove.innerHTML = X_ICON;

    row.append(labelInput, descriptionInput, remove);
    return row;
  }

  function createScoreRow(value = "") {
    const row = makeElement("div", "score-row");
    const number = makeElement("span", "score-number", "0");
    const input = document.createElement("input");
    input.type = "text";
    input.className = "score-input";
    input.placeholder = "Level description";
    input.value = value;
    input.setAttribute("aria-label", "Score level");

    const remove = makeElement("button", "remove-row");
    remove.type = "button";
    remove.dataset.action = "remove-level";
    remove.setAttribute("aria-label", "Remove level");
    remove.innerHTML = X_ICON;

    row.append(number, input, remove);
    return row;
  }

  function renumberScoreRows(list) {
    list.querySelectorAll(".score-number").forEach((number, index) => {
      number.textContent = String(index);
    });
  }

  function renderQuestionBody(card, type, data = {}) {
    const body = card.querySelector(".question-body");
    body.replaceChildren();

    if (type === "choice") {
      const list = makeElement("div", "option-list");
      const options = Array.isArray(data.options) && data.options.length
        ? data.options
        : [
            { label: "yes", description: "" },
            { label: "no", description: "" },
          ];

      options.forEach((option) => {
        list.append(createChoiceRow(option.label || "", option.description || ""));
      });

      const add = makeElement("button", "small-button", "+ Add option");
      add.type = "button";
      add.dataset.action = "add-option";

      const hint = makeElement("p", "hint", "Give each option a short label; descriptions help the model tell similar options apart.");
      body.append(list, add, hint);
      return;
    }

    if (type === "score") {
      const list = makeElement("div", "score-list");
      const levels = Array.isArray(data.levels) && data.levels.length
        ? data.levels
        : ["low", "high"];

      levels.forEach((level) => {
        list.append(createScoreRow(level));
      });
      renumberScoreRows(list);

      const add = makeElement("button", "small-button", "+ Add level");
      add.type = "button";
      add.dataset.action = "add-level";

      const hint = makeElement("p", "hint", "Ordered from lowest to highest · 2–10 levels.");
      body.append(list, add, hint);
      return;
    }

    const copy = makeElement("div", "noul-copy");
    const glyph = makeElement("span", "noul-glyph", "YES / NO");
    const text = makeElement("span");
    text.append("Returns the probability that the answer is ");
    text.append(makeElement("strong", null, "yes"));
    text.append(". Phrase the question as a yes/no decision.");
    copy.append(glyph, text);
    body.append(copy);
  }

  function createQuestion(options = {}) {
    const type = options.type || "noul";
    const card = makeElement("article", "question-card");

    const top = makeElement("div", "question-top");
    const number = makeElement("span", "question-number", "01");
    const select = document.createElement("select");
    select.className = "type-select";
    select.setAttribute("aria-label", "Question type");
    [
      ["choice", "Choice"],
      ["score", "Score"],
      ["noul", "Yes / no"],
    ].forEach(([value, label]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      select.append(option);
    });
    select.value = type;

    const remove = makeElement("button", "icon-button");
    remove.type = "button";
    remove.dataset.action = "remove-question";
    remove.setAttribute("aria-label", "Remove question");
    remove.title = "Remove question";
    remove.innerHTML = X_ICON;
    top.append(number, select, remove);

    const prompt = document.createElement("input");
    prompt.type = "text";
    prompt.className = "question-prompt";
    prompt.placeholder = type === "noul"
      ? "e.g. Is this document safe to process?"
      : "e.g. What is the best decision for this input?";
    prompt.value = options.prompt || "";
    prompt.setAttribute("aria-label", "Question");

    const body = makeElement("div", "question-body");
    card.append(top, prompt, body);

    select.addEventListener("change", () => {
      prompt.placeholder = select.value === "noul"
        ? "e.g. Is this document safe to process?"
        : "e.g. What is the best decision for this input?";
      renderQuestionBody(card, select.value);
    });

    renderQuestionBody(card, type, options);
    return card;
  }

  function addQuestion(options = {}) {
    const card = createQuestion(options);
    questionsEl.append(card);
    updateQuestionNumbers();
    return card;
  }

  function collectQuestions() {
    const cards = [...questionsEl.querySelectorAll(".question-card")];
    if (!cards.length) {
      throw new ValidationError("Add at least one question before running a decision.", addQuestionButton);
    }

    const questions = {};

    cards.forEach((card, index) => {
      const type = card.querySelector(".type-select").value;
      const promptInput = card.querySelector(".question-prompt");
      const instructions = promptInput.value.trim();
      const key = `q${index + 1}`;
      const label = `Question ${index + 1}`;

      if (!instructions) {
        throw new ValidationError(`${label} needs a question.`, promptInput);
      }

      if (type === "choice") {
        const rows = [...card.querySelectorAll(".choice-row")];
        if (rows.length < 2) {
          throw new ValidationError(`${label} needs at least two options.`, rows[0]?.querySelector(".option-label"));
        }

        const criteria = {};
        rows.forEach((row) => {
          const labelInput = row.querySelector(".option-label");
          const descriptionInput = row.querySelector(".option-desc");
          const optionLabel = labelInput.value.trim();
          if (!optionLabel) {
            throw new ValidationError(`${label} has an empty option label.`, labelInput);
          }
          if (Object.prototype.hasOwnProperty.call(criteria, optionLabel)) {
            throw new ValidationError(`${label} has a duplicate option: “${optionLabel}”.`, labelInput);
          }
          criteria[optionLabel] = descriptionInput.value.trim() || null;
        });

        questions[key] = { type, instructions, criteria };
        return;
      }

      if (type === "score") {
        const rows = [...card.querySelectorAll(".score-row")];
        if (rows.length < 2) {
          throw new ValidationError(`${label} needs at least two score levels.`, rows[0]?.querySelector(".score-input"));
        }
        if (rows.length > 10) {
          throw new ValidationError(`${label} supports at most ten score levels.`);
        }

        const criteria = rows.map((row) => {
          const input = row.querySelector(".score-input");
          const level = input.value.trim();
          if (!level) {
            throw new ValidationError(`${label} has an empty score level.`, input);
          }
          return level;
        });

        questions[key] = { type, instructions, criteria };
        return;
      }

      questions[key] = { type: "noul", instructions };
    });

    return questions;
  }

  function handleOptionAction(event) {
    const button = event.target.closest("[data-action]");
    if (!button) return;

    const action = button.dataset.action;

    if (action === "remove-question") {
      button.closest(".question-card").remove();
      updateQuestionNumbers();
      clearFormError();
      return;
    }

    if (action === "add-option") {
      const list = button.closest(".question-body").querySelector(".option-list");
      const row = createChoiceRow();
      list.append(row);
      row.querySelector(".option-label").focus();
      return;
    }

    if (action === "remove-option") {
      const row = button.closest(".choice-row");
      const list = row.parentElement;
      if (list.children.length <= 2) {
        showFormError("A choice question needs at least two options.", list.querySelector(".option-label"));
        return;
      }
      row.remove();
      return;
    }

    if (action === "add-level") {
      const list = button.closest(".question-body").querySelector(".score-list");
      if (list.children.length >= 10) {
        showFormError("A score question supports at most ten levels.");
        return;
      }
      const row = createScoreRow();
      list.append(row);
      renumberScoreRows(list);
      row.querySelector(".score-input").focus();
      return;
    }

    if (action === "remove-level") {
      const row = button.closest(".score-row");
      const list = row.parentElement;
      if (list.children.length <= 2) {
        showFormError("A score question needs at least two levels.", list.querySelector(".score-input"));
        return;
      }
      row.remove();
      renumberScoreRows(list);
    }
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("The image could not be read."));
      reader.readAsDataURL(file);
    });
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("The image could not be prepared."));
      }, type, quality);
    });
  }

  async function decodeWithFallback(file) {
    if ("createImageBitmap" in window) {
      try {
        return await createImageBitmap(file, { imageOrientation: "from-image" });
      } catch {
        // Fall through to an HTML image element.
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

  async function prepareImage(file) {
    if (!IMAGE_TYPES.has(file.type)) {
      throw new Error("Use a PNG, JPG, WEBP, or GIF image.");
    }
    if (file.size > MAX_IMAGE_BYTES) {
      throw new Error("That image is larger than 25 MB. Choose a smaller image.");
    }

    const bitmap = await decodeWithFallback(file);
    const width = bitmap.width;
    const height = bitmap.height;
    if (!width || !height) {
      throw new Error("The image dimensions could not be read.");
    }

    const needsResize = Math.max(width, height) > MAX_IMAGE_EDGE;
    const serverSafeOriginal = file.type === "image/jpeg" || file.type === "image/png";
    if (!needsResize && file.size <= 3.5 * 1024 * 1024 && serverSafeOriginal) {
      return {
        dataUrl: await readFileAsDataUrl(file),
        name: file.name || "pasted-image",
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
    if (!context) throw new Error("Your browser could not prepare the image.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, targetWidth, targetHeight);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
    if (typeof bitmap.close === "function") bitmap.close();

    const blob = await canvasToBlob(canvas, "image/jpeg", 0.9);
    return {
      dataUrl: await readFileAsDataUrl(blob),
      name: file.name || "pasted-image",
      width: targetWidth,
      height: targetHeight,
      bytes: blob.size,
    };
  }

  function showImage(image) {
    state.image = image;
    previewImg.src = image.dataUrl;
    previewName.textContent = image.name;
    previewDetails.textContent = `${image.width} × ${image.height} · ${formatBytes(image.bytes)}`;
    imagePreview.hidden = false;
    dropzone.hidden = true;
  }

  function clearImage() {
    state.imageToken += 1;
    state.image = null;
    fileInput.value = "";
    previewImg.removeAttribute("src");
    imagePreview.hidden = true;
    dropzone.hidden = false;
    clearFormError();
  }

  async function acceptImage(file) {
    if (!file) return;
    clearFormError();
    const token = ++state.imageToken;
    const originalName = file.name || "pasted-image";

    try {
      const image = await prepareImage(file);
      if (token !== state.imageToken) return;
      image.name = originalName;
      showImage(image);
    } catch (error) {
      if (token !== state.imageToken) return;
      showFormError(error.message || "The image could not be prepared.", fileInput);
    }
  }

  async function handleFiles(fileList) {
    const file = [...(fileList || [])].find((candidate) => candidate.type.startsWith("image/"));
    if (!file) {
      showFormError("Choose an image file to attach.");
      return;
    }
    await acceptImage(file);
  }

  function setLoading(isLoading) {
    state.loading = isLoading;
    runButton.disabled = isLoading;
    runButton.classList.toggle("is-loading", isLoading);
    runButton.querySelector(".button-label").textContent = isLoading ? "Deciding…" : "Run decision";
  }

  function showOutput(kind) {
    outputEmpty.hidden = kind !== "empty";
    outputLoading.hidden = kind !== "loading";
    outputError.hidden = kind !== "error";
    resultArea.hidden = kind !== "results";
  }

  function showOutputError(message) {
    errorMessage.textContent = message;
    copyJsonButton.hidden = true;
    showOutput("error");
  }

  function makeMetaChip(label, value) {
    const chip = makeElement("span", "meta-chip");
    chip.append(document.createTextNode(label), makeElement("strong", null, value));
    return chip;
  }

  function appendProbabilityRow(list, label, probability, isTop, delay = 0) {
    const row = makeElement("div", `prob-row${isTop ? " is-top" : ""}`);
    const name = makeElement("span", "prob-label", humanizeLabel(label));
    const value = makeElement("span", "prob-value", formatPercent(probability));
    const track = makeElement("span", "prob-track");
    const fill = makeElement("span", "prob-fill");
    track.append(fill);
    row.append(name, value, track);
    list.append(row);

    window.setTimeout(() => {
      fill.style.width = `${Math.max(0, Math.min(1, Number(probability) || 0)) * 100}%`;
    }, 30 + delay);
  }

  function appendAnswerHeading(card, type, prompt) {
    const kicker = makeElement("div", "answer-kicker");
    kicker.append(makeElement("span", "answer-type", type));
    if (prompt) {
      const promptEl = makeElement("span", "answer-prompt", prompt);
      promptEl.title = prompt;
      kicker.append(promptEl);
    }
    card.append(kicker);
  }

  function renderChoiceAnswer(answer, prompt) {
    const card = makeElement("article", "answer-card");
    appendAnswerHeading(card, "Choice", prompt);

    const probabilities = Object.entries(answer.probabilities || {})
      .map(([label, value]) => [label, Number(value)])
      .filter(([, value]) => Number.isFinite(value))
      .sort((a, b) => b[1] - a[1]);

    const topLabel = answer.choice ?? probabilities[0]?.[0] ?? "—";
    const topProbability = probabilities.find(([label]) => label === topLabel)?.[1] ?? probabilities[0]?.[1] ?? 0;

    const hero = makeElement("div", "answer-hero");
    hero.append(
      makeElement("span", "answer-value", humanizeLabel(topLabel)),
      makeElement("span", "answer-unit", formatPercent(topProbability)),
    );
    card.append(hero);

    const confidence = Number(answer.confidence);
    const sub = makeElement("p", "answer-sub");
    if (Number.isFinite(confidence)) {
      sub.append("Confidence ", makeElement("strong", null, formatPercent(confidence)));
    } else {
      sub.append("Top option probability");
    }
    card.append(sub);

    const list = makeElement("div", "prob-list");
    probabilities.forEach(([label, probability], index) => {
      appendProbabilityRow(list, label, probability, label === topLabel, index * 35);
    });
    card.append(list);
    return card;
  }

  function renderNoulAnswer(answer, prompt) {
    const card = makeElement("article", "answer-card");
    appendAnswerHeading(card, "Yes / no", prompt);

    const probability = Math.max(0, Math.min(1, Number(answer.noul) || 0));
    const hero = makeElement("div", "answer-hero");
    hero.append(
      makeElement("span", "answer-value", formatPercent(probability)),
      makeElement("span", "answer-unit", "probability of yes"),
    );
    card.append(hero);
    card.append(makeElement("p", "answer-sub", "The model's decision-head probability for the yes option."));

    const gauge = makeElement("div", "noul-gauge");
    const fill = makeElement("span", "noul-fill");
    gauge.append(fill);
    card.append(gauge);

    const scale = makeElement("div", "noul-scale");
    scale.append(makeElement("span", null, "YES"), makeElement("span", null, "NO"));
    card.append(scale);

    window.setTimeout(() => {
      fill.style.width = `${probability * 100}%`;
    }, 40);
    return card;
  }

  function renderScoreAnswer(answer, prompt, question) {
    const card = makeElement("article", "answer-card");
    appendAnswerHeading(card, "Score", prompt);

    const score = Number(answer.score);
    const legend = answer.legend && typeof answer.legend === "object" ? answer.legend : null;
    const fallbackLevels = Array.isArray(question?.criteria) ? question.criteria : [];
    const levelKeys = legend
      ? Object.keys(legend).sort((a, b) => Number(a) - Number(b))
      : fallbackLevels.map((_, index) => String(index));
    const maxLevel = Math.max(0, levelKeys.length - 1);

    const hero = makeElement("div", "answer-hero");
    hero.append(
      makeElement("span", "answer-value is-number", Number.isFinite(score) ? score.toFixed(2) : "—"),
      makeElement("span", "answer-unit", `/ ${maxLevel}`),
    );
    card.append(hero);

    const nearestIndex = Math.max(0, Math.min(maxLevel, Math.round(Number(score) || 0)));
    const nearestLabel = legend?.[String(nearestIndex)] ?? fallbackLevels[nearestIndex];
    if (nearestLabel !== undefined) {
      const nearest = makeElement("div", "score-nearest");
      nearest.append(makeElement("span", null, "nearest"), humanizeLabel(nearestLabel));
      card.append(nearest);
    }

    card.append(makeElement("p", "answer-sub", `Expected level across ${levelKeys.length} ordered levels.`));

    const probabilities = answer.probabilities && typeof answer.probabilities === "object"
      ? answer.probabilities
      : {};
    const numericProbabilities = levelKeys
      .map((key) => [key, Number(probabilities[key])])
      .filter(([, value]) => Number.isFinite(value));

    if (numericProbabilities.length) {
      const topKey = numericProbabilities.reduce((best, entry) => entry[1] > best[1] ? entry : best, numericProbabilities[0])[0];
      const list = makeElement("div", "prob-list");
      numericProbabilities.forEach(([key, probability], index) => {
        const label = legend?.[key] ?? fallbackLevels[Number(key)] ?? `Level ${key}`;
        appendProbabilityRow(list, label, probability, key === topKey, index * 35);
      });
      card.append(list);
    }

    return card;
  }

  function renderResults(data, elapsed, questionMap) {
    state.lastResponse = data;
    resultMeta.replaceChildren(
      makeMetaChip("model", data.model || modelBadge.textContent || "clef-flash"),
      makeMetaChip("latency", formatLatency(elapsed)),
      makeMetaChip("input", `${Number(data.usage?.input_tokens || 0).toLocaleString()} tok`),
    );

    answersEl.replaceChildren();
    const entries = Object.entries(data.answers || {});
    entries.forEach(([key, answer], index) => {
      const question = questionMap[key];
      const prompt = question?.instructions || "";
      let card;

      if (answer.type === "choice") {
        card = renderChoiceAnswer(answer, prompt);
      } else if (answer.type === "score") {
        card = renderScoreAnswer(answer, prompt, question);
      } else {
        card = renderNoulAnswer(answer, prompt);
      }

      card.style.animationDelay = `${index * 55}ms`;
      answersEl.append(card);
    });

    rawJson.textContent = JSON.stringify(data, null, 2);
    copyJsonButton.hidden = false;
    copyJsonButton.querySelector("span").textContent = "Copy JSON";
    showOutput("results");
  }

  async function runDecision(event) {
    event?.preventDefault();
    if (state.loading) return;

    clearFormError();

    try {
      const context = stateInput.value.trim();
      if (!context && !state.image) {
        throw new ValidationError("Add some context or attach an image before running a decision.", stateInput);
      }

      const questions = collectQuestions();
      const payload = {
        state: context || "An image was provided.",
        questions,
      };
      if (state.image) {
        payload.images = [state.image.dataUrl];
      }

      setLoading(true);
      showOutput("loading");

      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      const started = performance.now();

      try {
        const response = await fetch(`${SERVER_URL}/v1/systemone`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: controller.signal,
          credentials: "omit",
        });

        const responseText = await response.text();
        let data;
        try {
          data = JSON.parse(responseText);
        } catch {
          throw new Error(`The server returned an unreadable response (HTTP ${response.status}).`);
        }

        if (!response.ok) {
          const message = data?.error?.message || data?.message || `The server returned HTTP ${response.status}.`;
          throw new Error(message);
        }
        if (!data.answers || typeof data.answers !== "object") {
          throw new Error("The server response did not include any answers.");
        }

        const elapsed = performance.now() - started;
        renderResults(data, elapsed, questions);
      } catch (error) {
        if (error?.name === "AbortError") {
          throw new Error("The decision timed out after 120 seconds.");
        }
        if (error instanceof TypeError && /fetch|network/i.test(error.message)) {
          throw new Error(`Could not reach the llama server at ${SERVER_URL}. Check that it is online and allows this browser origin.`);
        }
        throw error;
      } finally {
        window.clearTimeout(timer);
      }
    } catch (error) {
      if (error instanceof ValidationError) {
        showFormError(error.message, error.target);
        showOutput(state.lastResponse ? "results" : "empty");
      } else {
        showOutputError(error?.message || "Something went wrong while running the decision.");
      }
    } finally {
      setLoading(false);
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
    if (!state.lastResponse) return;
    const text = JSON.stringify(state.lastResponse, null, 2);
    const label = copyJsonButton.querySelector("span");
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        fallbackCopy(text);
      }
      label.textContent = "Copied";
      window.setTimeout(() => {
        label.textContent = "Copy JSON";
      }, 1600);
    } catch {
      label.textContent = "Copy failed";
      window.setTimeout(() => {
        label.textContent = "Copy JSON";
      }, 1600);
    }
  }

  // Initial state -----------------------------------------------------------
  document.querySelector(".endpoint code").textContent = maskServer(SERVER_URL);
  document.querySelector(".endpoint").title = SERVER_URL;
  $("#errorServer").textContent = maskServer(SERVER_URL);
  serverStatus.setAttribute("aria-live", "polite");
  updateCounts();
  checkServer();

  addQuestion({
    type: "choice",
    prompt: "What is the best decision for this input?",
    options: [
      { label: "approve", description: "The input meets the criteria and can proceed." },
      { label: "reject", description: "The input has a clear problem and should not proceed." },
      { label: "review", description: "It is unclear or risky and needs a human to review it." },
    ],
  });

  // Events ------------------------------------------------------------------
  stateInput.addEventListener("input", updateCounts);
  addQuestionButton.addEventListener("click", () => {
    const card = addQuestion({ type: "noul", prompt: "" });
    card.querySelector(".question-prompt").focus();
  });
  questionsEl.addEventListener("click", handleOptionAction);

  form.addEventListener("submit", runDecision);
  form.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && event.target.matches("input")) {
      event.preventDefault();
    }
  });

  document.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      runDecision();
    }
  });

  copyJsonButton.addEventListener("click", copyJson);
  serverStatus.addEventListener("click", checkServer);

  dropzone.addEventListener("click", () => fileInput.click());
  dropzone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      fileInput.click();
    }
  });
  fileInput.addEventListener("change", () => {
    handleFiles(fileInput.files);
    fileInput.value = "";
  });

  ["dragenter", "dragover"].forEach((type) => {
    dropzone.addEventListener(type, (event) => {
      event.preventDefault();
      event.stopPropagation();
      dropzone.classList.add("is-dragging");
    });
  });
  dropzone.addEventListener("dragleave", (event) => {
    if (!dropzone.contains(event.relatedTarget)) {
      dropzone.classList.remove("is-dragging");
    }
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
      acceptImage(file);
    }
  });

  removeImageButton.addEventListener("click", clearImage);
})();
