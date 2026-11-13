// A tiny hash router: "#/employees" -> ["employees"]. Hash URLs work on any
// static host without server rewrites, and back/forward just work.
import { useEffect, useState } from "react";

function read() {
  return window.location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
}

export function useRoute() {
  const [parts, setParts] = useState(read);

  useEffect(() => {
    const update = () => setParts(read());
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);

  return parts;
}

export function navigate(path) {
  window.location.hash = path.startsWith("/") ? path : `/${path}`;
}
