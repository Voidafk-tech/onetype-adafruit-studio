// Stable request fingerprint (FNV-1a, 32-bit) used to find a pre-computed run on the static site.
export function requestKey(request) {
  const text = JSON.stringify(request);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${hash.toString(16).padStart(8, '0')}-${text.length}`;
}
