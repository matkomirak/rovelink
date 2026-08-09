import { cn } from "@/lib/utils";

type BrandLogoProps = {
  surface?: "light" | "dark" | "inherit";
  className?: string;
};

export function BrandLogo({ surface = "inherit", className }: BrandLogoProps) {
  const isDark = surface === "dark";
  const colorClass =
    surface === "inherit" ? undefined : isDark ? "text-white" : "text-[#1A1916]";

  return (
    <div
      className={cn(
        "inline-flex items-center gap-2.5 select-none",
        colorClass,
        className
      )}
      aria-label="Rovelink"
      role="img"
    >
      <span
        className={cn(
          "grid h-[1.65em] w-[1.65em] place-items-center rounded-[0.32em] bg-[#2674dc] text-white",
          isDark ? "shadow-[0_0_28px_rgba(49,134,255,0.28)]" : "shadow-[0_10px_24px_rgba(38,116,220,0.2)]"
        )}
        aria-hidden="true"
      >
        <svg
          viewBox="0 0 14 14"
          className="h-[0.88em] w-[0.88em]"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M2 7h10M7 2l5 5-5 5" />
        </svg>
      </span>
      <span className="font-mono text-[1em] font-medium leading-none tracking-[-0.02em]">
        rovelink
      </span>
    </div>
  );
}
