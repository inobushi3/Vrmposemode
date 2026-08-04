/// <reference types="vite/client" />

declare global {
  interface Window {
    desktop?: {
      minimize: () => void;
      maximize: () => void;
      close: () => void;
    };
  }
}

export {};
