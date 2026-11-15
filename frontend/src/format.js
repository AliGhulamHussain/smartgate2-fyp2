// How values are shown on screen: words, times, durations.

// "early_leave" -> "Early leave"
export const label = (value) =>
  String(value ?? "").replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

// "09:25 AM"
export const fmtTime = (value) =>
  value ? new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—";

// "Nov 15, 09:25 AM"
export const fmtDateTime = (value) =>
  value
    ? new Date(value).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : "—";

// 95 -> "1h 35m", 25 -> "25m"
export const fmtMinutes = (minutes) => {
  if (!minutes) return "—";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
};

// "just now", "5 min ago", "3 h ago", then the date
export const timeAgo = (value) => {
  const seconds = Math.max(0, (Date.now() - new Date(value).getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
  return fmtDateTime(value);
};
