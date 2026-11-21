/// <reference types="vite/client" />

declare module '*.vue' {
  import Vue from 'vue';
  export default Vue;
}

declare module '@novnc/novnc/core/rfb.js' {
  export default class RFB {
    constructor(
      target: HTMLElement,
      urlOrChannel: string,
      options?: {
        shared?: boolean;
        credentials?: { username?: string; password?: string; target?: string };
        repeaterID?: string;
        wsProtocols?: string[];
      },
    );
    scaleViewport: boolean;
    resizeSession: boolean;
    clipViewport: boolean;
    viewOnly: boolean;
    background: string;
    qualityLevel: number;
    compressionLevel: number;
    addEventListener(type: string, listener: (e: any) => void): void;
    removeEventListener(type: string, listener: (e: any) => void): void;
    disconnect(): void;
    focus(): void;
    blur(): void;
    sendKey(keysym: number, code?: string | null, down?: boolean): void;
    sendCtrlAltDel(): void;
    clipboardPasteFrom(text: string): void;
  }
}
