/** Small formatting helpers used across the workspace. */

const dateFormatter = new Intl.DateTimeFormat("en", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

const timeFormatter = new Intl.DateTimeFormat("en", {
  hour: "numeric",
  minute: "2-digit",
});

export function formatDate(value: string | null): string {
  if (!value) return "Not dated";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "Not dated";
  return dateFormatter.format(date);
}

export function formatActivityTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return timeFormatter.format(date);
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

export function initialsFor(title: string): string {
  const words = title
    .replace(/[^a-zA-Z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const pick = words
    .slice(0, 3)
    .map((word) => word[0] ?? "")
    .join("");
  return pick.toUpperCase() || "PP";
}

export function exampleQueries(): string[] {
  return [
    "metformin type 2 diabetes HbA1c",
    "SGLT2 inhibitors cardiovascular outcomes",
    "semaglutide weight loss randomized",
  ];
}
