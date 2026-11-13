// Shows an unknown-face snapshot. The image endpoint needs the bearer
// token, so it is fetched with api() and displayed through an object URL.
import { useEffect, useState } from "react";
import { ImageOff } from "lucide-react";
import { api } from "./api";
import { cx } from "./ui";

export default function Snapshot({ url, alt, className }) {
  const [src, setSrc] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let objectUrl = null;
    let alive = true;
    api(url, { raw: true })
      .then((response) => response.blob())
      .then((blob) => {
        if (!alive) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url]);

  return (
    <div className={cx("relative overflow-hidden bg-white/[0.04]", className)}>
      {src ? (
        <img src={src} alt={alt} className="size-full object-cover transition-transform duration-700 ease-out group-hover:scale-105" />
      ) : (
        <div className={cx("grid size-full place-items-center", !failed && "animate-pulse")}>
          {failed && <ImageOff className="size-5 text-fg-3" aria-label="Snapshot unavailable" />}
        </div>
      )}
    </div>
  );
}
