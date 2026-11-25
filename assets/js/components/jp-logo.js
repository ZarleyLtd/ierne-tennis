/* JP logo: a button showing the JP logo. Tapping it plays the logo animation backwards to the
   separate J and P, then forwards again to the logo.
   Canonical copy: cursor-sites-shared/jp-logo/jp-logo.js (spec: jp-logo/JP_LOGO.md).
   Apps get a synced copy from scripts/sync-ui.ps1. Edit the canonical file, never the app copy.

   Markup (the PNG is the fallback if the SVG cannot be loaded):
     <button type="button" class="jp-logo" aria-label="JP logo: tap to replay its animation">
       <img src="assets/icons/jpLogo-white-rotated-2000.png" alt="JP" width="37" height="22">
     </button>
   Every .jp-logo on the page is wired up on load. For markup added later, call JpLogo.init(rootEl).
   data-src on the button overrides the SVG path (for pages that are not at the site root). */
(function () {
  const DEFAULT_SRC = 'assets/icons/jpLogo-animated.svg';
  const DUR = 3.6;   // seconds: length of the SVG's timeline (see jp-logo/source/jpLogo-animate.py)
  const SPEED = 1.5; // 3.6 s each way plays in 2.4 s

  const texts = new Map();
  function load(src) {
    if (!texts.has(src)) {
      texts.set(src, fetch(src).then(r => (r.ok ? r.text() : Promise.reject(r.status))));
    }
    return texts.get(src);
  }

  function reducedMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function attach(btn) {
    if (btn.dataset.jpLogoReady) return;
    btn.dataset.jpLogoReady = '1';
    load(btn.dataset.src || DEFAULT_SRC).then(text => {
      const holder = document.createElement('div');
      holder.innerHTML = text;
      const svg = holder.querySelector('svg');
      if (!svg || !svg.pauseAnimations) return;
      svg.pauseAnimations();
      svg.setCurrentTime(DUR); // rest on the finished logo, same as the PNG
      // The SVG file says 2000x1186. jp-logo.css sizes it, but if that stylesheet is missing or
      // stale the logo would fill the page, so take the fallback size from the PNG it replaces
      // (or 37x22). CSS still wins over these attributes whenever jp-logo.css is loaded.
      const img = btn.querySelector('img');
      svg.setAttribute('width', (img && img.getAttribute('width')) || '37');
      svg.setAttribute('height', (img && img.getAttribute('height')) || '22');
      btn.replaceChildren(svg);

      let busy = false;
      btn.addEventListener('click', () => {
        if (busy || reducedMotion()) return;
        busy = true;
        const t0 = performance.now();
        const step = now => {
          const e = (now - t0) / 1000 * SPEED;
          svg.setCurrentTime(e < DUR ? DUR - e : Math.min(e - DUR, DUR)); // reverse, then forward
          if (e < 2 * DUR) requestAnimationFrame(step);
          else busy = false;
        };
        requestAnimationFrame(step);
      });
    }).catch(() => { /* keep the PNG */ });
  }

  function init(root) {
    (root || document).querySelectorAll('.jp-logo').forEach(attach);
  }

  window.JpLogo = { init };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => init());
  else init();
})();
