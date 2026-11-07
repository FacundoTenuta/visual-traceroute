"use client";

import { useState, type FormEvent } from "react";

interface SearchFormProps {
  running: boolean;
  initialValue?: string;
  onTrace(target: string): void;
  onStop(): void;
}

export function SearchForm({ running, initialValue = "", onTrace, onStop }: SearchFormProps) {
  const [value, setValue] = useState(initialValue);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (running) onStop();
    else if (value.trim()) onTrace(value.trim());
  };

  return (
    <form className="search" onSubmit={submit} role="search">
      <label className="visually-hidden" htmlFor="target">
        Host or IP address
      </label>
      <input
        id="target"
        className="search__input"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="cloudflare.com or 1.1.1.1"
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        inputMode="url"
        disabled={running}
      />
      <button className="search__button" type="submit" data-running={running || undefined}>
        {running ? "Stop" : "Trace"}
      </button>
    </form>
  );
}
