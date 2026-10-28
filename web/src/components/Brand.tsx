import { useState } from "react";
import { TutorAvatar } from "./TutorAvatar";

const asset = (path: string) => `${import.meta.env.BASE_URL}${path}`;

/** Mr. Jones school logo (web/public/brand/mj-logo.png), with a drawn fallback until the file is added. */
export function SchoolLogo({ size = 36 }: { size?: number }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <svg className="school-logo" width={size} height={size} viewBox="0 0 40 40" aria-label="ミスタージョーンズ">
        <defs>
          <radialGradient id="mj-g" cx="35%" cy="30%" r="75%">
            <stop offset="0" stopColor="#d4344d" />
            <stop offset=".65" stopColor="#9c0f27" />
            <stop offset="1" stopColor="#5c0715" />
          </radialGradient>
        </defs>
        <circle cx="20" cy="20" r="19" fill="#e9edf5" />
        <circle cx="20" cy="20" r="17" fill="url(#mj-g)" />
        <text x="20" y="23.5" textAnchor="middle" fontFamily="Georgia, serif" fontSize="15" fill="#fff">MJ</text>
      </svg>
    );
  }
  return (
    <img
      className="school-logo"
      src={asset("brand/mj-logo.png")}
      width={size}
      height={size}
      alt="ミスタージョーンズ"
      onError={() => setFailed(true)}
    />
  );
}

/** The school is the primary brand; "AI先生" is shown as the tool inside it. */
export function Brand({ compact }: { compact?: boolean }) {
  return (
    <div className="brand">
      <SchoolLogo size={compact ? 38 : 42} />
      <div className="brand-words">
        <span className="brand-school">
          ミスタージョーンズ<b>金町校</b>
        </span>
        <span className="brand-sub latin">PC &amp; English School</span>
      </div>
      <span className="brand-divider" aria-hidden />
      <span className="brand-product">
        <TutorAvatar size={26} />
        AI先生
      </span>
    </div>
  );
}
