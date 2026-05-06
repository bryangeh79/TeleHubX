interface BrandLogoProps {
  size?: number;
  glow?: boolean;
}

export default function BrandLogo({ size = 28, glow = true }: BrandLogoProps) {
  const id = 'tx-logo-grad';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: 'block', filter: glow ? 'drop-shadow(0 0 8px rgba(64, 224, 255, 0.55))' : undefined }}
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#3ddcff" />
          <stop offset="55%" stopColor="#5b8def" />
          <stop offset="100%" stopColor="#a855f7" />
        </linearGradient>
      </defs>
      <rect x="4" y="4" width="56" height="56" rx="14" fill={`url(#${id})`} />
      <path
        d="M20 20 L44 44 M44 20 L20 44"
        stroke="#fff"
        strokeWidth="6"
        strokeLinecap="round"
      />
    </svg>
  );
}
