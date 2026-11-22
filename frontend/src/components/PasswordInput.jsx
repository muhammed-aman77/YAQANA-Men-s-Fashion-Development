import React, { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

export default function PasswordInput({ className = '', id, ...inputProps }) {
  const [isVisible, setIsVisible] = useState(false);
  const VisibilityIcon = isVisible ? EyeOff : Eye;

  return (
    <span className="relative block">
      <input
        {...inputProps}
        id={id}
        type={isVisible ? 'text' : 'password'}
        className={`${className} pr-11`}
      />
      <button
        type="button"
        aria-label={isVisible ? 'Hide password' : 'Show password'}
        aria-pressed={isVisible}
        aria-controls={id}
        onClick={() => setIsVisible((visible) => !visible)}
        className="absolute inset-y-0 right-1 inline-flex w-9 items-center justify-center text-xora-taupe-dark transition-colors hover:text-xora-brown focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-xora-brown"
      >
        <VisibilityIcon aria-hidden="true" className="h-4 w-4" />
      </button>
    </span>
  );
}
