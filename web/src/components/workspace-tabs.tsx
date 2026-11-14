"use client";
import { useId, useRef, type ReactNode } from "react";
import styles from "./workspace-tabs.module.css";

export function WorkspaceTabs<T extends string>({
  label,
  value,
  onChange,
  options,
  children,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: readonly { value: T; label: string }[];
  children: ReactNode;
}) {
  const id = useId(),
    buttons = useRef<(HTMLButtonElement | null)[]>([]);
  return (
    <div className={styles.tabs}>
      <div className={styles.tabList} role="tablist" aria-label={label}>
        {options.map((option, index) => (
          <button
            key={option.value}
            ref={(node) => {
              buttons.current[index] = node;
            }}
            type="button"
            role="tab"
            id={`${id}-${option.value}`}
            aria-selected={value === option.value}
            aria-controls={`${id}-panel`}
            tabIndex={value === option.value ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => {
              let next = index;
              if (event.key === "ArrowRight")
                next = (index + 1) % options.length;
              else if (event.key === "ArrowLeft")
                next = (index - 1 + options.length) % options.length;
              else if (event.key === "Home") next = 0;
              else if (event.key === "End") next = options.length - 1;
              else return;
              event.preventDefault();
              onChange(options[next].value);
              buttons.current[next]?.focus();
            }}
          >
            {option.label}
          </button>
        ))}
      </div>
      <section
        id={`${id}-panel`}
        role="tabpanel"
        aria-labelledby={`${id}-${value}`}
        className={styles.content}
      >
        {children}
      </section>
    </div>
  );
}
