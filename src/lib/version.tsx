// Tells people when a newer version of the app has been put online, so one click (or the next page
// open) brings it in. The page is never reloaded by itself while someone may be typing.
import { useEffect, useState } from "react";

const scriptOf = (html: string) => html.match(/\/assets\/index-[\w-]+\.js/)?.[0] ?? null;
const running = typeof document === "undefined" ? null
  : document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/index-"]')?.getAttribute("src") ?? null;

async function latest(): Promise<string | null> {
  try {
    const r = await fetch("/index.html", { cache: "no-store" });
    return r.ok ? scriptOf(await r.text()) : null;
  } catch { return null; }
}

export function NewVersionBanner() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!running) return; // local development
    let live = true;
    const check = async () => {
      const now = await latest();
      if (live && now && now !== running) setReady(true);
    };
    const onVisible = () => { if (document.visibilityState === "visible") check(); };
    const timer = window.setInterval(check, 2 * 60 * 1000);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", check);
    return () => { live = false; clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); window.removeEventListener("focus", check); };
  }, []);
  if (!ready) return null;
  return (
    <div className="update-banner" role="status">
      <span>A new version of the app is ready.</span>
      <button type="button" onClick={() => window.location.reload()}>Refresh now</button>
    </div>
  );
}
