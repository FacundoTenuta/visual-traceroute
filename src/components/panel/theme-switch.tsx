"use client";

import type { ThemePreference } from "../use-theme";

const OPTIONS: Array<{ value: ThemePreference; label: string; icon: React.ReactNode }> = [
  {
    value: "system",
    label: "Match system",
    icon: (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <rect x="2" y="3" width="12" height="8" rx="1.5" />
        <path d="M6 14h4M8 11v3" />
      </svg>
    ),
  },
  {
    value: "light",
    label: "Light",
    icon: (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="8" cy="8" r="3" />
        <path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1" />
      </svg>
    ),
  },
  {
    value: "dark",
    label: "Dark",
    icon: (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M13 9.5A5.5 5.5 0 0 1 6.5 3a5.5 5.5 0 1 0 6.5 6.5Z" />
      </svg>
    ),
  },
];

export function ThemeSwitch({ value, onChange }: { value: ThemePreference; onChange(v: ThemePreference): void }) {
  return (
    <div className="theme-switch" role="radiogroup" aria-label="Color theme">
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          aria-label={option.label}
          title={option.label}
          className="theme-switch__option"
          onClick={() => onChange(option.value)}
        >
          {option.icon}
        </button>
      ))}
    </div>
  );
}
