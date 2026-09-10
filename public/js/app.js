const body = document.body;
const menuButton = document.querySelector("[data-menu-toggle]");
const menuOverlay = document.querySelector("[data-menu-overlay]");

function closeMenu() {
  body.classList.remove("menu-open");
  menuButton?.setAttribute("aria-expanded", "false");
}

menuButton?.addEventListener("click", () => {
  const open = body.classList.toggle("menu-open");
  menuButton.setAttribute("aria-expanded", String(open));
});
menuOverlay?.addEventListener("click", closeMenu);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeMenu();
});

document.querySelectorAll("[data-dismiss-flash]").forEach((button) => {
  button.addEventListener("click", () => button.closest(".flash")?.remove());
});

document.querySelectorAll("[data-password-toggle]").forEach((button) => {
  button.addEventListener("click", () => {
    const input = button.parentElement?.querySelector("input");
    if (!input) return;
    const showing = input.type === "text";
    input.type = showing ? "password" : "text";
    button.textContent = showing ? "Lihat" : "Sembunyi";
    button.setAttribute(
      "aria-label",
      showing ? "Tampilkan kata sandi" : "Sembunyikan kata sandi",
    );
  });
});

function readableSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

document.querySelectorAll("[data-file-input]").forEach((input) => {
  const form = input.closest("form");
  const list = form?.querySelector("[data-file-list]");
  const count = form?.querySelector("[data-file-count]");
  const zone = input.closest(".upload-zone");

  function updateFiles() {
    const files = [...input.files];
    if (count) count.textContent = `${files.length} file dipilih`;
    if (list) {
      list.replaceChildren(
        ...files.map((file) => {
          const item = document.createElement("li");
          const name = document.createElement("span");
          const size = document.createElement("span");
          name.textContent = file.name;
          size.textContent = readableSize(file.size);
          item.append(name, size);
          return item;
        }),
      );
    }
  }

  input.addEventListener("change", updateFiles);
  ["dragenter", "dragover"].forEach((eventName) => {
    zone?.addEventListener(eventName, () => zone.classList.add("dragging"));
  });
  ["dragleave", "drop"].forEach((eventName) => {
    zone?.addEventListener(eventName, () => zone.classList.remove("dragging"));
  });
});

document.querySelectorAll('a[href^="#"]').forEach((link) => {
  link.addEventListener("click", () => {
    const id = link.getAttribute("href")?.slice(1);
    const section = id && document.getElementById(id);
    if (section) {
      window.setTimeout(() => section.querySelector("input, select")?.focus(), 350);
    }
  });
});
