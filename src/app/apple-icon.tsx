import { ImageResponse } from "next/og";

// Apple-Touch-Icon (iPhone-Startbildschirm). Next verlinkt es automatisch.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg,#3b82f6,#1e40af)",
        }}
      >
        <svg width="112" height="112" viewBox="0 0 512 512">
          <path d="M286 72 L150 296 H236 L210 440 L372 204 H276 Z" fill="#ffffff" />
        </svg>
      </div>
    ),
    { ...size }
  );
}
