// ---- Android 4.4 KitKat (Chromium 30) DOM Shims ----
(function () {
  if (typeof window === 'undefined') return;
  const w = window as any;

  if (!w.MutationObserver && w.WebKitMutationObserver) {
    w.MutationObserver = w.WebKitMutationObserver;
  }

  if (!w.requestAnimationFrame) {
    w.requestAnimationFrame =
      w.webkitRequestAnimationFrame ||
      function (cb: (t: number) => void) {
        return window.setTimeout(function () {
          cb(Date.now());
        }, 16);
      };
  }

  // Constructible CustomEvent & Event for Chromium 30 / Android 4.4 WebView
  try {
    new w.CustomEvent('test');
  } catch {
    const CustomEventPolyfill = function (event: string, params?: { bubbles?: boolean; cancelable?: boolean; detail?: any }) {
      const p = params || { bubbles: false, cancelable: false, detail: undefined };
      const evt = document.createEvent('CustomEvent');
      evt.initCustomEvent(event, Boolean(p.bubbles), Boolean(p.cancelable), p.detail);
      return evt;
    };
    CustomEventPolyfill.prototype = (w.Event && w.Event.prototype) || {};
    w.CustomEvent = CustomEventPolyfill;
  }

  // Constructible ImageData for Chromium 30 (used by @novnc/novnc display renderer)
  try {
    new w.ImageData(1, 1);
  } catch {
    let helperCtx: CanvasRenderingContext2D | null = null;
    w.ImageData = function (dataOrWidth: any, widthOrHeight: number, maybeHeight?: number) {
      if (!helperCtx) {
        helperCtx = document.createElement('canvas').getContext('2d');
      }
      if (typeof dataOrWidth === 'number') {
        return helperCtx!.createImageData(dataOrWidth, widthOrHeight);
      }
      const wPx = widthOrHeight;
      const hPx = maybeHeight || Math.floor(dataOrWidth.length / (wPx * 4));
      const img = helperCtx!.createImageData(wPx, hPx);
      img.data.set(dataOrWidth);
      return img;
    };
  }
})();

import 'whatwg-fetch';
import Vue from 'vue';
import App from './App.vue';
import router from './router';
import './styles/main.css';

Vue.config.productionTip = false;

new Vue({
  router,
  render: (h) => h(App),
}).$mount('#app');
