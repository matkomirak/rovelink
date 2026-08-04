import wordmarkDark from "@assets/rovelink-wordmark-dark.png";
import wordmarkLight from "@assets/rovelink-wordmark-light.png";

type BrandLogoProps = {
  surface?: "light" | "dark";
  className?: string;
};

export function BrandLogo({ surface = "light", className }: BrandLogoProps) {
  return (
    <img
      src={surface === "dark" ? wordmarkDark : wordmarkLight}
      alt="Rovelink"
      className={className}
      decoding="async"
      draggable={false}
    />
  );
}
