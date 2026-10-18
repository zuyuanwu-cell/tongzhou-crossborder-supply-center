import React, { useEffect, useState } from "react";
import { Boxes } from "lucide-react";

type Props = {
  src?: string;
  name?: string;
  size?: number;
};

export function StockupProductImage({ src, name = "产品", size = 18 }: Props) {
  const [failed, setFailed] = useState(false);

  useEffect(() => setFailed(false), [src]);

  if (!src || failed) {
    return <span className="sc-image-fallback" aria-label={`${name}暂无图片`}><Boxes size={size} /></span>;
  }

  return <img src={src} alt={name} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
}
