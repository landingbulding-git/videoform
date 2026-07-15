# Performance Patterns — Apply Proactively

These patterns come from a real PageSpeed/Lighthouse remediation pass on this site (July 2026).
Each represents a measurable fix to a production issue: oversized images, an eager third-party
embed pulling ~1 MB of unused JS, and a janky carousel that re-fetched images mid-animation.
**Apply these from the start when building new pages or components, rather than retrofitting them later.**

---

## Architecture defaults

### Astro + React islands

The site runs **Astro** (static HTML) with **React** for interactive islands, not a full client SPA.
This means:

- HTML ships first; the visitor sees content immediately.
- JavaScript only bundles for islands that need it.
- By default, a new component is **static** (HTML only). Add interactivity only where needed.

See `src/pages/*.astro` for the pattern in practice.

### Hydration directives: client:load vs client:visible

Use the right directive for each component so JavaScript doesn't load before it's useful:

- **`client:load`** (above the fold, immediately needed): `Navbar`, `Hero`, `FloatingCTA`.
  These appear on first view and need to be interactive right away.
- **`client:visible`** (below the fold): Everything else — testimonials, galleries, pricing tables, footers.
  These load their JavaScript only when scrolled into view.

Never default to `client:load` on a new component. Assume `client:visible` unless the visitor
sees and interacts with it before scrolling.

See `src/pages/index.astro` for examples of both.

### Self-hosted fonts (avoid render-blocking requests)

Use `@fontsource` packages and import them in your layout—don't link to Google Fonts.

```tsx
// src/layouts/Layout.astro
import '@fontsource/cormorant-garamond/300.css';
import '@fontsource/inter/400.css';
// ...
```

A `<link>` to a third-party font service is a render-blocking request on first load.
Self-hosting bundles the font into your CSS and eliminates the delay.

See `src/layouts/Layout.astro`.

---

## Images

### Route through the image optimizer helper

Never drop a raw `<img src="https://blob.example.com/photo.jpg">` into a component.
Always use the `imgProps()` helper from `src/lib/imageOpt.ts`:

```tsx
import { imgProps } from '../lib/imageOpt';

export default function MyComponent() {
  return (
    <img
      {...imgProps(
        'https://bgumoxbjyuzc6ytp.public.blob.vercel-storage.com/photo.jpg',
        '(min-width: 1024px) 50vw, 100vw'
      )}
      alt="Description"
    />
  );
}
```

This helper:

- Serves the correct file size for the visitor's screen width (via Vercel's `/_vercel/image` optimizer).
- Generates a `srcSet` + `sizes` pair so browsers download only what they need, not the full-resolution original.
- Falls back to the raw URL in local dev (where the optimizer isn't available).

**If you add new image widths or breakpoints,** update the `WIDTHS` array in `imageOpt.ts` and the
`images.sizes` array in `vercel.json` to match.

See `src/lib/imageOpt.ts`, `src/components/home/HomeHero.tsx` (see commit `61fc891`).

### Prioritize above-fold images; lazy-load the rest

```tsx
// Above the fold — fetch immediately
<img
  {...imgProps(url, sizes)}
  fetchPriority="high"
  alt="..."
/>

// Below the fold — lazy load
<img
  {...imgProps(url, sizes)}
  loading="lazy"
  decoding="async"
  alt="..."
/>
```

A page's hero image or first visible call-to-action photo should load eagerly. Images that
appear after scrolling should be `loading="lazy"` and `decoding="async"` so the browser doesn't
waste bandwidth on them until the visitor scrolls close.

### Carousel/multi-image pattern: visible images first, rest deferred

If a component shows N images but only K are visible at once (e.g., a carousel showing 5 of 12 photos),
don't load all 12 immediately.  Instead:

1. Render only the visible ones with a real `src`.
2. Defer the rest with `src={undefined}` until `requestIdleCallback` fires (use `setTimeout` as a fallback for older browsers).
3. Mark the center/primary image `fetchPriority="high"` and hidden ones `fetchPriority="low"`.

This prevents hidden images from competing with visible ones for bandwidth on first paint.

```tsx
const [preloadRest, setPreloadRest] = useState(false);

useEffect(() => {
  const idle = (window as any).requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 1500));
  const handle = idle(() => setPreloadRest(true));
  return () => {
    const cancel = (window as any).cancelIdleCallback ?? clearTimeout;
    cancel(handle);
  };
}, []);

// Later, in the image render:
<img
  src={isVisible || preloadRest ? imageSrc : undefined}
  fetchPriority={isCenter ? 'high' : isVisible ? 'auto' : 'low'}
  loading="lazy"
  decoding="async"
/>
```

See `src/components/home/HomeGallery.tsx` (see commits `5d74511`, `b1ad0cf`).

---

## Third-party embeds (YouTube, maps, widgets, etc.)

### Don't embed raw iframes — use a click-to-play facade

A raw YouTube iframe loads ~1 MB of player JavaScript whether or not the visitor clicks play.
Maps, chat widgets, and other third-party embeds often do the same.

Instead, render a **click-to-play facade**: show a static thumbnail + a play button, then swap in
the real iframe only when clicked.

```tsx
function LiteYouTube({ id }: { id: string }) {
  const [playing, setPlaying] = useState(false);

  if (playing) {
    return (
      <iframe
        src={`https://www.youtube.com/embed/${id}?autoplay=1`}
        // ... rest of props
      />
    );
  }

  return (
    <button onClick={() => setPlaying(true)}>
      <img
        src={`https://i.ytimg.com/vi/${id}/hqdefault.jpg`}
        loading="lazy"
        decoding="async"
      />
      {/* YouTube-style play button SVG */}
    </button>
  );
}
```

The thumbnail is ~20 KB; the real player loads only on interaction. Set `autoplay=1` on the
deferred embed so the click still feels instant.

See `src/components/home/HomeMedia.tsx` (see commit `52f0158`).

---

## Animation

### Animate GPU-compositable properties only

Animate **only** `transform` (`scale`, `translate`, `rotate`) and `opacity`.
Never animate `height`, `width`, `top`, `left`, or other layout-affecting properties in a loop or drag interaction.

❌ **Bad:** Animating `height` forces the browser to reflow + repaint every frame.
```tsx
// DON'T do this
animate={{ height: '200px' }}
```

✅ **Good:** Animating `scale` is GPU-composited; no reflow.
```tsx
// DO this instead
animate={{ scale: 1.2 }}
```

### For carousels and cyclic layouts: keep images mounted, animate transforms

When a carousel or tab strip cycles through a fixed set of items, keep every item mounted
permanently and move/hide them via `transform` and `opacity` instead of mounting/unmounting per click.

❌ **Bad:** Using `AnimatePresence` to remount on each click causes the browser to re-fetch and re-decode images mid-animation.

✅ **Good:** All images stay mounted, just scaled and translated off-screen:
```tsx
const SLOT_BY_OFFSET = {
  0: { scale: 1, left: '50%', z: 30 },
  1: { scale: 0.82, left: '72%', z: 20 },
  // ...
};

{galleryImages.map((image, i) => {
  const offset = (i - currentIndex + count) % count;
  const target = SLOT_BY_OFFSET[offset] ?? { scale: 0.5, left: '-20%', z: 0 };
  return (
    <motion.div
      animate={{
        scale: target.scale,
        left: target.left,
        zIndex: target.z,
        opacity: offset in SLOT_BY_OFFSET ? 1 : 0,
      }}
    >
      <img src={image.src} />
    </motion.div>
  );
})}
```

This preserves smooth navigation—hidden images are still decoded before the user reaches them—while
avoiding costly fetches/decodes when the carousel moves.

See `src/components/home/HomeGallery.tsx` (see commits `5d74511`, `b1ad0cf`).

---

## Pre-launch checklist for new components

Before marking a new section or page as complete:

- [ ] **Hydration directive chosen deliberately**: `client:load` only if above-the-fold and immediately interactive; everything else is `client:visible` or static.
- [ ] **All remote/blob images** use `imgProps()` helper with appropriate `loading`, `decoding`, and `fetchPriority` attributes.
- [ ] **Third-party embeds** (YouTube, maps, etc.) are click-to-play facades, not eager iframes.
- [ ] **Animations** (if any) use `transform` and `opacity` only. Layout-affecting property animations removed or replaced.
- [ ] **Below-fold images and assets** are lazy-loaded.
- [ ] **Multi-image component** (carousel, gallery, grid): visible images load first; off-screen deferred via `requestIdleCallback`.

---

## Resources

- `src/lib/imageOpt.ts` — Image optimizer helper (always use this).
- `vercel.json` — Image optimizer configuration and whitelist. Update `images.sizes` when adding new breakpoints.
- `src/layouts/Layout.astro` — Font imports and head setup.
- `src/pages/index.astro` — Example of `client:load` vs `client:visible` in practice.
- `src/components/home/HomeGallery.tsx` — Reference carousel with intelligent image loading + GPU animation.
- `src/components/home/HomeMedia.tsx` — Reference click-to-play facade for YouTube embeds.
