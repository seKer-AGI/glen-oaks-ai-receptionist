"use client";

const HEIGHTS = [0.35, 0.55, 0.75, 0.45, 0.9, 0.6, 0.8, 0.5, 0.95, 0.4, 0.7, 0.55, 0.85, 0.45, 0.65, 0.5, 0.8, 0.6, 0.75, 0.4];

export function WaveformBars({ active }: { active: boolean }) {
  return (
    <div className="flex h-14 items-center justify-center gap-[3px]" aria-hidden>
      {HEIGHTS.map((h, i) => (
        <span
          key={i}
          className={`origin-bottom w-[3px] rounded-full bg-app-bar transition-colors duration-300 ${
            active ? "animate-wave bg-app-bar-active" : ""
          }`}
          style={{
            height: `${Math.round(h * 100)}%`,
            animationDelay: active ? `${i * 45}ms` : undefined,
          }}
        />
      ))}
    </div>
  );
}
