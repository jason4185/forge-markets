export function ForgeMark({ className = "" }: { className?: string }) {
  return (
    <span
      className={`relative inline-flex h-8 w-8 items-center justify-center ${className}`}
      aria-hidden
    >
      <svg viewBox="0 0 32 32" className="h-8 w-8">
        <path
          d="M16 2.5 28 9.25v13.5L16 29.5 4 22.75V9.25z"
          fill="none"
          stroke="var(--ember)"
          strokeWidth="1.4"
          opacity="0.65"
        />
        <path
          d="M16 8.5c3.4 3.2 5.2 5.9 5.2 8.7A5.2 5.2 0 0 1 16 22.4a5.2 5.2 0 0 1-5.2-5.2c0-2.8 1.8-5.5 5.2-8.7Z"
          fill="var(--ember)"
        />
        <path
          d="M16 14.2c1.5 1.6 2.3 2.8 2.3 4.1A2.3 2.3 0 0 1 16 20.6a2.3 2.3 0 0 1-2.3-2.3c0-1.3.8-2.5 2.3-4.1Z"
          fill="var(--background)"
          opacity="0.85"
        />
      </svg>
    </span>
  );
}

export function ForgeWordmark() {
  return (
    <span className="flex items-center gap-2">
      <ForgeMark />
      <span className="font-display text-lg font-semibold tracking-[0.2em] text-foreground">
        FORGE
      </span>
    </span>
  );
}
