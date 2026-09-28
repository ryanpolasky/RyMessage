export function AppIcon({ size }: { size: number }) {
  return (
    <svg
      className="app-icon"
      width={size}
      height={size}
      viewBox="0 0 120 120"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="app-icon-bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#6BE36F" />
          <stop offset="1" stopColor="#0CBC2C" />
        </linearGradient>
      </defs>
      <rect width="120" height="120" rx="27" fill="url(#app-icon-bg)" />
      <path
        d="M60 24c-23.2 0-42 14.9-42 33.4 0 11.8 7.7 22.2 19.4 28.1-.8 4.5-3.1 8.6-6.5 11.6-.7.6-.2 1.8.7 1.7 6.6-.6 12.7-3.2 17.5-7.2 3.5.8 7.1 1.2 10.9 1.2 23.2 0 42-14.9 42-33.4S83.2 24 60 24z"
        fill="#ffffff"
      />
    </svg>
  );
}
