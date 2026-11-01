import Image from "next/image";
import markPng from "@/assets/logo-mark.png";
import wordDark from "@/assets/logo-wordmark-dark.png";
import wordLight from "@/assets/logo-wordmark-light.png";
import { cn } from "@/lib/utils";

/** The Synqonix mark alone. */
export function LogoMark({ size = 32, className }: { size?: number; className?: string }) {
  return <Image src={markPng} alt="" aria-hidden width={size} height={Math.round((size * markPng.height) / markPng.width)} className={className} priority />;
}

/** Mark plus wordmark; the wordmark switches colour with the theme. */
export function Logo({ height = 32, className }: { height?: number; className?: string }) {
  const wordHeight = Math.round(height * 0.5);
  const wordWidth = Math.round((wordHeight * wordDark.width) / wordDark.height);
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark size={Math.round(height * 1.05)} />
      <Image src={wordDark} alt="Synqonix" width={wordWidth} height={wordHeight} className="dark:hidden" priority />
      <Image src={wordLight} alt="Synqonix" width={wordWidth} height={wordHeight} className="hidden dark:block" priority />
    </span>
  );
}
