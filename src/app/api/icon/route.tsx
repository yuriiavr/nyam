import { ImageResponse } from "next/og";
import { iconArt } from "@/lib/appIcon";

export const dynamic = "force-static";

const ALLOWED = [192, 256, 384, 512];

export function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const requested = Number(searchParams.get("size") ?? 512);
  const size = ALLOWED.includes(requested) ? requested : 512;
  const maskable = searchParams.get("maskable") === "1";

  return new ImageResponse(iconArt(size, maskable), {
    width: size,
    height: size,
    headers: {
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
