import { useState } from "react";

// A boolean UI preference remembered in this browser (e.g. which panels are
// shown). Storage can be unavailable (private window, blocked site data):
// then it just isn't remembered.
export function usePersistentFlag(key: string, initial: boolean): [boolean, (v: boolean) => void] {
  const [value, setValue] = useState<boolean>(() => {
    try {
      const v = window.localStorage.getItem(key);
      return v === null ? initial : v === "1";
    } catch {
      return initial;
    }
  });
  const set = (v: boolean) => {
    setValue(v);
    try {
      window.localStorage.setItem(key, v ? "1" : "0");
    } catch {
      /* not remembered */
    }
  };
  return [value, set];
}
