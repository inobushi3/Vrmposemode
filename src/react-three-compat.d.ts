import type { JSX as ReactJSX } from 'react';
import type { Event } from 'three';
import type { TransformControls as TransformControlsClass } from 'three/addons/controls/TransformControls.js';

declare global {
  namespace JSX {
    type Element = ReactJSX.Element;
  }
}

declare module 'three/addons/controls/TransformControls.js' {
  interface TransformControls {
    addEventListener(
      type: 'dragging-changed',
      listener: (event: Event<'dragging-changed', TransformControlsClass> & { value: boolean }) => void,
    ): void;
  }
}

export {};
