"use client";

import { useEffect, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";

type Sculpture = ReturnType<typeof import("./brand-scene").createBrandScene>;

export function BrandSculpture() {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<Sculpture | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const fail = () => { scene.current?.dispose(); scene.current = null; if (!cancelled) setReady(false); };
    import("./brand-scene").then(({ createBrandScene }) => {
      if (cancelled || !host.current) return;
      try { scene.current = createBrandScene(host.current, fail); setReady(true); }
      catch { host.current?.querySelector("canvas")?.remove(); fail(); }
    }).catch(fail);
    return () => { cancelled = true; scene.current?.dispose(); scene.current = null; };
  }, []);
  return <div className="brand-art">
    <div ref={host} className="brand-art-stage" role="img" aria-label="开放的银色 C 形缎带，象征对开源创作的照料">
      {!ready && <div className="brand-art-fallback" aria-hidden="true">C</div>}
    </div>
    <div className="brand-art-caption"><span>Open source. With care.</span>{ready && <div><span>拖动，换个角度</span><button type="button" aria-label="复位品牌雕塑" title="复位视角" onClick={() => scene.current?.reset()}><RotateCcw size={15}/></button></div>}</div>
  </div>;
}
