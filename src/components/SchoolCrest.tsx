import { useEffect, useState } from 'react';

interface SchoolCrestProps {
  className?: string;
  logoUrl?: string;
  alt?: string;
}

export function SchoolCrest({
  className = 'w-9 h-9',
  logoUrl = '',
  alt = 'Logo SMP Negeri 2 Girimulyo',
}: SchoolCrestProps) {
  const [imgFailed, setImgFailed] = useState(false);

  useEffect(() => {
    setImgFailed(false);
  }, [logoUrl]);

  if (logoUrl && !imgFailed) {
    return (
      <img
        src={logoUrl}
        alt={alt}
        referrerPolicy="no-referrer"
        onError={() => setImgFailed(true)}
        className={`${className} object-contain rounded`}
      />
    );
  }

  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label={alt}
    >
      <path
        d="M32 4L56 12V31C56 45.2 45.6 55.4 32 60C18.4 55.4 8 45.2 8 31V12L32 4Z"
        fill="#1E3A5F"
        stroke="#0F172A"
        strokeWidth="2.5"
      />
      <path
        d="M32 9.5L50.5 15.8V30.8C50.5 41.9 42.3 50 32 54.1C21.7 50 13.5 41.9 13.5 30.8V15.8L32 9.5Z"
        stroke="#E2E8F0"
        strokeWidth="1.5"
      />
      <path
        d="M21 24.5C24.5 22.8 28.5 22.8 32 24.8C35.5 22.8 39.5 22.8 43 24.5V40.5C39.5 38.8 35.5 38.8 32 40.8C28.5 38.8 24.5 38.8 21 40.5V24.5Z"
        fill="#FFFFFF"
      />
      <path d="M32 24.8V40.8" stroke="#1E3A5F" strokeWidth="1.8" />
      <path
        d="M32 14L33.8 18.2L38.3 18.6L34.9 21.5L36 25.9L32 23.5L28 25.9L29.1 21.5L25.7 18.6L30.2 18.2L32 14Z"
        fill="#FBBF24"
      />
    </svg>
  );
}
