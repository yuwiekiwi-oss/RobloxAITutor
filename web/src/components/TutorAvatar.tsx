import { useState } from "react";

const ROBOT_SRC = `${import.meta.env.BASE_URL}brand/ai-sensei.png`;

/** Drawn stand-in for the AI先生 robot, used until web/public/brand/ai-sensei.png exists. */
function RobotSvg({ full }: { full?: boolean }) {
  return (
    <svg className="robot-svg" viewBox={full ? "0 0 120 150" : "8 6 104 92"} aria-hidden>
      <defs>
        <linearGradient id="rb-shell" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#dfe7f3" />
        </linearGradient>
        <linearGradient id="rb-blue" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#4c8dff" />
          <stop offset="1" stopColor="#1d5be0" />
        </linearGradient>
      </defs>
      {full && (
        <g>
          <ellipse cx="60" cy="122" rx="24" ry="22" fill="url(#rb-shell)" />
          <circle cx="60" cy="118" r="6" fill="#56e3ff" />
          <circle cx="60" cy="118" r="3.4" fill="#c8f6ff" />
          <rect x="28" y="104" width="12" height="20" rx="6" fill="url(#rb-shell)" transform="rotate(20 34 114)" />
          <g className="robot-wave">
            <rect x="82" y="92" width="12" height="20" rx="6" fill="url(#rb-shell)" transform="rotate(-35 88 102)" />
            <circle cx="96" cy="86" r="7" fill="url(#rb-blue)" />
          </g>
        </g>
      )}
      <line x1="60" y1="18" x2="60" y2="8" stroke="#1d3a6e" strokeWidth="3" strokeLinecap="round" />
      <circle cx="60" cy="8" r="6" fill="url(#rb-blue)" />
      <circle cx="58" cy="6" r="2" fill="#fff" opacity=".7" />
      <rect x="14" y="44" width="12" height="26" rx="6" fill="url(#rb-blue)" />
      <rect x="94" y="44" width="12" height="26" rx="6" fill="url(#rb-blue)" />
      <rect x="20" y="18" width="80" height="74" rx="34" fill="url(#rb-shell)" />
      <rect x="28" y="30" width="64" height="48" rx="20" fill="#0f2148" />
      <path d="M38 52q6-8 12 0M70 52q6-8 12 0" stroke="#56e3ff" strokeWidth="4.2" fill="none" strokeLinecap="round" />
      <path d="M52 61q8 9 16 0z" fill="#56e3ff" />
      <ellipse cx="44" cy="37" rx="8" ry="3.5" fill="#fff" opacity=".18" />
    </svg>
  );
}

/** Round avatar: the robot's head. */
export function TutorAvatar({ size = 40, thinking }: { size?: number; thinking?: boolean }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className={`tutor-avatar ${thinking ? "is-thinking" : ""}`} style={{ width: size, height: size }} aria-hidden>
      {failed ? <RobotSvg /> : <img src={ROBOT_SRC} alt="" onError={() => setFailed(true)} />}
    </span>
  );
}

/** Full-body robot for welcome / login / celebration. */
export function RobotHero({ className, celebrate }: { className?: string; celebrate?: boolean }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className={`robot-hero ${celebrate ? "is-celebrating" : ""} ${className ?? ""}`} aria-hidden>
      <div className="robot-halo" />
      {failed ? <RobotSvg full /> : <img src={ROBOT_SRC} alt="" onError={() => setFailed(true)} />}
    </div>
  );
}
