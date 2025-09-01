// jello-title.js
// Self-contained jello title effect that does NOT touch your existing files.
// Usage in HTML:
//   <link rel="stylesheet" href="jello-title.css">
//   <h1 id="app-title" class="jello-title" data-text="Conga Trainer – Stage 4 Demo"></h1>
//   <script src="jello-title.js" defer></script>

(function () {
  // Dynamically load GSAP if it's not present
  function ensureGSAP(cb) {
    if (window.gsap) return cb();
    const s = document.createElement('script');
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js";
    s.onload = cb;
    document.head.appendChild(s);
  }

  function initJelloTitle() {
    const titles = Array.from(document.querySelectorAll('.jello-title'));
    if (!titles.length) return;

    titles.forEach((title) => {
      // Build characters from data-text or existing text
      const text = title.getAttribute('data-text') || title.textContent || '';
      title.textContent = '';
      const frag = document.createDocumentFragment();
      for (const ch of text) {
        const span = document.createElement('span');
        span.className = 'char';
        span.textContent = ch === ' ' ? '\u00A0' : ch;
        frag.appendChild(span);
      }
      title.appendChild(frag);

      const chars = Array.from(title.querySelectorAll('.char'));
      // Read CSS custom props
      const style = getComputedStyle(title);
      const weightInit   = parseFloat(style.getPropertyValue('--fw')) || 600;
      const weightTarget = 400;
      const weightDiff   = weightInit - weightTarget;

      const stretchInit   = parseFloat(style.getPropertyValue('--fs')) || 150;
      const stretchTarget = 80;
      const stretchDiff   = stretchInit - stretchTarget;

      const maxYScale = 2.5;
      const elasticDropOff = 0.8;

      let isMouseDown = false;
      let mouseInitialY = 0;
      let mouseFinalY = 0;
      let distY = 0;
      let dragYScale = 0;
      let charIndexSelected = 0;
      let charH = 0;

      function resize() { charH = title.offsetHeight || 60; }
      resize();
      window.addEventListener('resize', resize);

      // Entrance animation
      window.gsap.from(chars, {
        y: () => -(title.getBoundingClientRect().y + charH + 500),
        fontWeight: weightTarget,
        fontStretch: stretchTarget,
        onUpdate: function () {
          // Sync font-variation-settings for better cross-browser behavior
          chars.forEach(c => {
            const cs = getComputedStyle(c);
            c.style.fontVariationSettings =
              `"wght" ${cs.fontWeight}, "wdth" ${parseFloat(cs.fontStretch)}`;
          });
        },
        scaleY: 2,
        ease: "elastic(0.2, 0.1)",
        duration: 1.5,
        delay: 0.2,
        stagger: { each: 0.05, from: 'random' }
      });

      // Drag interactions
      chars.forEach((char, index) => {
        char.addEventListener('mousedown', (e) => {
          isMouseDown = true;
          mouseInitialY = e.clientY;
          charIndexSelected = index;
          title.classList.add('grab');
        });
      });

      document.addEventListener('mousemove', (e) => {
        if (!isMouseDown) return;
        mouseFinalY = e.clientY;
        calcDist();
        setFontDragDimensions();
      });

      document.addEventListener('mouseup', () => {
        if (!isMouseDown) return;
        isMouseDown = false;
        snapBackText();
        title.classList.remove('grab');
      });

      document.addEventListener('mouseleave', () => {
        if (!isMouseDown) return;
        isMouseDown = false;
        snapBackText();
        title.classList.remove('grab');
      });

      function calcDist() {
        const maxYDragDist = charH * (maxYScale - 1);
        distY = mouseInitialY - mouseFinalY;
        dragYScale = distY / maxYDragDist;
        if (dragYScale > (maxYScale - 1)) dragYScale = (maxYScale - 1);
        else if (dragYScale < -0.5) dragYScale = -0.5;
      }

      function fracDispersion(index) {
        const dispersion = 1 - (Math.abs(index - charIndexSelected) / (chars.length * elasticDropOff));
        return dispersion * dragYScale;
      }

      function setFontDragDimensions() {
        window.gsap.to(chars, {
          y: (i) => fracDispersion(i) * -50,
          fontWeight: (i) => weightInit - (fracDispersion(i) * weightDiff),
          fontStretch: (i) => stretchInit - (fracDispersion(i) * stretchDiff),
          onUpdate: function () {
            chars.forEach(c => {
              const cs = getComputedStyle(c);
              c.style.fontVariationSettings =
                `"wght" ${cs.fontWeight}, "wdth" ${parseFloat(cs.fontStretch)}`;
            });
          },
          scaleY: (i) => {
            const s = 1 + fracDispersion(i);
            return s < 0.5 ? 0.5 : s;
          },
          ease: "power4",
          duration: 0.6
        });
      }

      function snapBackText() {
        window.gsap.to(chars, {
          y: 0,
          fontWeight: weightInit,
          fontStretch: stretchInit,
          onUpdate: function () {
            chars.forEach(c => {
              const cs = getComputedStyle(c);
              c.style.fontVariationSettings =
                `"wght" ${cs.fontWeight}, "wdth" ${parseFloat(cs.fontStretch)}`;
            });
          },
          scale: 1,
          ease: "elastic(0.35, 0.1)",
          duration: 1,
          stagger: { each: 0.02, from: charIndexSelected }
        });
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => ensureGSAP(initJelloTitle));
  } else {
    ensureGSAP(initJelloTitle);
  }
})();