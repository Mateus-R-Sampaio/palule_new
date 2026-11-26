// Teclado virtual para totens touch (tablets/telas grandes — não aparece em smartphones).

const ALPHA = [
  ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
  ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
  ["a", "s", "d", "f", "g", "h", "j", "k", "l", "ç"],
  ["{shift}", "z", "x", "c", "v", "b", "n", "m", "{bksp}"],
  ["{accents}", "@", ".", "-", "_", "{space}", ".com", "{done}"],
];
const ACCENTS = [
  ["á", "à", "â", "ã", "é", "ê", "í", "ó", "ô", "õ"],
  ["ú", "ü", "ç", "ñ", "!", "?", "&", "'", "#", "+"],
  ["{shift}", "(", ")", "/", ",", ":", ";", "*", "{bksp}"],
  ["{abc}", "@", ".", "-", "_", "{space}", "{done}"],
];
const NUMERIC = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
  ["{bksp}", "0", "{done}"],
];
const LABELS = {
  "{shift}": "⇧",
  "{bksp}": "⌫",
  "{space}": "espaço",
  "{done}": "OK",
  "{accents}": "áé?",
  "{abc}": "abc",
};

export function setupVirtualKeyboard(isEnabled) {
  const host = document.getElementById("virtualKeyboard");
  if (!host) return;

  const eligible = () =>
    isEnabled() &&
    window.matchMedia("(pointer: coarse)").matches &&
    Math.min(window.screen.width, window.screen.height) >= 700;

  let target = null;
  let layout = "alpha";
  let shift = false;

  const isTextual = (input) =>
    input instanceof HTMLInputElement &&
    ["text", "tel", "email", "search"].includes(input.type) &&
    !input.hasAttribute("data-no-vk");

  const prepareInputs = () => {
    if (!eligible()) return;
    document.querySelectorAll("input").forEach((input) => {
      if (!isTextual(input) || input.dataset.vkReady) return;
      input.dataset.vkReady = "1";
      input.dataset.vkLayout =
        input.type === "tel" || input.inputMode === "numeric" || input.dataset.vk === "numeric" ? "numeric" : "alpha";
      input.setAttribute("inputmode", "none");
    });
  };

  const render = () => {
    const rows = layout === "numeric" ? NUMERIC : layout === "accents" ? ACCENTS : ALPHA;
    host.className = `virtual-keyboard layout-${layout}`;
    host.innerHTML = rows
      .map(
        (row) =>
          `<div class="vk-row">${row
            .map((key) => {
              const special = key.startsWith("{");
              const label = special ? LABELS[key] : shift ? key.toUpperCase() : key;
              const cls = special ? `vk-key vk-${key.slice(1, -1)}` : "vk-key";
              return `<button type="button" class="${cls}${key === "{shift}" && shift ? " is-active" : ""}" data-key="${key}">${label}</button>`;
            })
            .join("")}</div>`
      )
      .join("");
  };

  const show = () => {
    render();
    host.hidden = false;
    document.body.classList.add("has-virtual-keyboard");
    target?.scrollIntoView({ block: "center", behavior: "smooth" });
  };
  const hide = () => {
    host.hidden = true;
    document.body.classList.remove("has-virtual-keyboard");
  };

  const insert = (text) => {
    if (!target) return;
    const max = target.maxLength > 0 ? target.maxLength : Infinity;
    if (target.value.length >= max) return;
    try {
      const start = target.selectionStart ?? target.value.length;
      const end = target.selectionEnd ?? target.value.length;
      target.setRangeText(text, start, end, "end");
    } catch {
      target.value += text; // e-mail não suporta seleção
    }
    if (target.value.length > max) target.value = target.value.slice(0, max);
    target.dispatchEvent(new Event("input", { bubbles: true }));
  };

  const backspace = () => {
    if (!target) return;
    try {
      const start = target.selectionStart;
      const end = target.selectionEnd;
      if (start === end && start > 0) target.setRangeText("", start - 1, end, "end");
      else if (start !== end) target.setRangeText("", start, end, "end");
    } catch {
      target.value = target.value.slice(0, -1);
    }
    target.dispatchEvent(new Event("input", { bubbles: true }));
  };

  host.addEventListener("pointerdown", (e) => {
    e.preventDefault(); // mantém o foco no campo
    const key = e.target.closest("[data-key]")?.dataset.key;
    if (!key) return;
    switch (key) {
      case "{shift}":
        shift = !shift;
        render();
        break;
      case "{bksp}":
        backspace();
        break;
      case "{space}":
        insert(" ");
        break;
      case "{accents}":
        layout = "accents";
        render();
        break;
      case "{abc}":
        layout = "alpha";
        render();
        break;
      case "{done}": {
        const form = target?.form;
        target?.blur();
        hide();
        if (form && target?.enterKeyHint === "next") form.requestSubmit?.();
        break;
      }
      default:
        insert(shift ? key.toUpperCase() : key);
        if (shift) {
          shift = false;
          render();
        }
    }
  });

  document.addEventListener("focusin", (e) => {
    if (!eligible() || !isTextual(e.target)) return;
    prepareInputs();
    target = e.target;
    layout = target.dataset.vkLayout || "alpha";
    shift = false;
    show();
  });

  document.addEventListener("focusout", () => {
    setTimeout(() => {
      if (!isTextual(document.activeElement)) {
        target = null;
        hide();
      }
    }, 120);
  });

  prepareInputs();
  return { prepareInputs, hide };
}
