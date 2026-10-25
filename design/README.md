# Logo

- `logo-source.webp`: the original full-colour logo.
- Chosen colour: **all Cerulean blue (#2A52BE)**, mark and wordmark. The site uses:
  - `dist/studio/assets/logo-on-light.png` on light backgrounds
  - `dist/studio/assets/logo-on-dark.png` on dark backgrounds
  - `dist/studio/assets/mark.png` / `favicon.png` for the browser-tab icon
- `logo-options.html`, `logo-cerulean.html` and `logo-cerulean-both.html` are the colour previews that led to the choice.
- `tools/recolor.swift` cuts the logo from its background and repaints it while keeping the fold shading. To rebuild from a higher-resolution original:

```sh
swiftc -O design/tools/recolor.swift -o /tmp/recolor
/tmp/recolor design/logo-source.webp dist/studio/assets/logo-on-light.png "#1b3580" "#6f8fe0" "#2a52be" "#2a52be"
/tmp/recolor design/logo-source.webp dist/studio/assets/logo-on-dark.png "#22449e" "#a9bcf2" "#7f9ce8" "#7f9ce8"
/tmp/recolor design/logo-source.webp dist/studio/assets/mark.png "#1b3580" "#7f9ce8" "#2a52be" "#2a52be" mark
```

The sparkle removal and mark/wordmark split use pixel positions for the 1052×322 source. Adjust `markEnd` and the sparkle box if the source size changes.
