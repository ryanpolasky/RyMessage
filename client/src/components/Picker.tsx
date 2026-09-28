import { useEffect, useRef, useState } from "react";

export interface PickerOption<T> {
  value: T;
  label: string;
}

interface PickerProps<T> {
  label: string;
  value: T;
  options: PickerOption<T>[];
  disabled?: boolean;
  onChange: (value: T) => void;
}

const ITEM_HEIGHT = 24;
const EDGE = 8;

export function Picker<T extends string | number>({ label, value, options, disabled, onChange }: PickerProps<T>) {
  const [menu, setMenu] = useState<{ top: number; right: number; minWidth: number } | null>(null);
  const [active, setActive] = useState(0);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value);

  function open() {
    const rect = buttonRef.current!.getBoundingClientRect();
    const height = options.length * ITEM_HEIGHT + 10;
    const below = rect.bottom + 4 + height <= window.innerHeight - EDGE;
    setMenu({
      top: below ? rect.bottom + 4 : Math.max(EDGE, rect.top - 4 - height),
      right: window.innerWidth - rect.right,
      minWidth: rect.width,
    });
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
  }

  function close() {
    setMenu(null);
    buttonRef.current?.focus();
  }

  function choose(option: PickerOption<T>) {
    close();
    if (option.value !== value) onChange(option.value);
  }

  const isOpen = menu !== null;
  useEffect(() => {
    if (!isOpen) return;
    menuRef.current?.focus();
    const dismiss = () => setMenu(null);
    window.addEventListener("resize", dismiss);
    document.addEventListener("scroll", dismiss, true);
    return () => {
      window.removeEventListener("resize", dismiss);
      document.removeEventListener("scroll", dismiss, true);
    };
  }, [isOpen]);

  return (
    <>
      <button
        ref={buttonRef}
        className="picker-button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        disabled={disabled}
        onClick={() => (isOpen ? close() : open())}
        onKeyDown={(e) => {
          if (!isOpen && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
            e.preventDefault();
            open();
          }
        }}
      >
        <span className="picker-value">{current?.label ?? ""}</span>
        <svg viewBox="0 0 10 14" width="7" height="10" fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M2 5l3-3 3 3M2 9l3 3 3-3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {menu && (
        <div className="picker-overlay" onMouseDown={() => setMenu(null)}>
          <div
            ref={menuRef}
            className="context-menu picker-menu"
            role="listbox"
            aria-label={label}
            tabIndex={-1}
            style={{ top: menu.top, right: menu.right, minWidth: menu.minWidth }}
            onMouseDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Escape") close();
              else if (e.key === "ArrowDown") setActive((i) => (i + 1) % options.length);
              else if (e.key === "ArrowUp") setActive((i) => (i - 1 + options.length) % options.length);
              else if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                choose(options[active]);
              }
            }}
          >
            {options.map((option, i) => (
              <button
                key={String(option.value)}
                role="option"
                aria-selected={option.value === value}
                className={`context-item picker-item ${i === active ? "active" : ""}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(option)}
              >
                <span className="picker-check">
                  {option.value === value && (
                    <svg viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <path d="M2 6.5l2.5 2.5L10 3.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </span>
                {option.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
