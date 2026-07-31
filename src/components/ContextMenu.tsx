import { useEffect, useState } from "react";

interface MenuItem {
  label: string;
  action: () => void;
  danger?: boolean;
}

interface MenuState {
  x: number;
  y: number;
  items: MenuItem[];
}

async function readClipboard(): Promise<string> {
  try {
    return await navigator.clipboard.readText();
  } catch {
    return "";
  }
}

function insertIntoField(el: HTMLInputElement | HTMLTextAreaElement, text: string) {
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  el.value = el.value.slice(0, start) + text + el.value.slice(end);
  const pos = start + text.length;
  el.setSelectionRange(pos, pos);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

export function ContextMenu() {
  const [menu, setMenu] = useState<MenuState | null>(null);

  useEffect(() => {
    const onContext = (e: MouseEvent) => {
      e.preventDefault();
      const target = e.target as HTMLElement;
      const field = target.closest("input, textarea") as HTMLInputElement | HTMLTextAreaElement | null;
      const selection = window.getSelection()?.toString() ?? "";
      const items: MenuItem[] = [];

      if (field && (field.tagName === "TEXTAREA" || field.type === "text" || field.type === "search" || field.type === "password" || !field.type)) {
        const hasSel = field.selectionStart !== field.selectionEnd;
        items.push({
          label: "Cut",
          action: async () => {
            const sel = field.value.slice(field.selectionStart ?? 0, field.selectionEnd ?? 0);
            if (sel) {
              await navigator.clipboard.writeText(sel).catch(() => {});
              insertIntoField(field, "");
            }
          },
        });
        items.push({
          label: "Copy",
          action: () => {
            const sel = field.value.slice(field.selectionStart ?? 0, field.selectionEnd ?? 0);
            if (sel) void navigator.clipboard.writeText(sel).catch(() => {});
          },
        });
        items.push({
          label: "Paste",
          action: async () => {
            field.focus();
            const text = await readClipboard();
            if (text) insertIntoField(field, text);
          },
        });
        items.push({
          label: "Select all",
          action: () => {
            field.focus();
            field.select();
          },
        });
        if (!hasSel) items[0].danger = false;
      } else if (selection) {
        items.push({
          label: "Copy",
          action: () => void navigator.clipboard.writeText(selection).catch(() => {}),
        });
      }

      if (!items.length) {
        setMenu(null);
        return;
      }
      // clamp to viewport
      const x = Math.min(e.clientX, window.innerWidth - 180);
      const y = Math.min(e.clientY, window.innerHeight - items.length * 34 - 12);
      setMenu({ x, y, items });
    };

    const onClick = () => setMenu(null);
    window.addEventListener("contextmenu", onContext);
    window.addEventListener("click", onClick);
    window.addEventListener("blur", onClick);
    return () => {
      window.removeEventListener("contextmenu", onContext);
      window.removeEventListener("click", onClick);
      window.removeEventListener("blur", onClick);
    };
  }, []);

  if (!menu) return null;
  return (
    <div className="ctx-menu" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
      {menu.items.map((it, i) => (
        <button
          key={i}
          className={it.danger ? "danger-item" : ""}
          onClick={() => {
            it.action();
            setMenu(null);
          }}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}
