// inplace.js - keeps looping animations in place.
//
// UniMate's "walk" (and some dances) move the hips forward through the clip. The room already moves the character
// itself, so when the clip loops the hips jump back to the start: she walks a straight bit, then teleports back.
// inPlace() takes the steady drift (start -> end) out of every bone position in a looping clip, so the last frame
// meets the first one again. The small sway and bounce inside each step stay.

// clips that play once: their move from start to end is the point (sitting down, a jump), so they're left alone
const ONCE = /^(sit|jump|lie|lounge|crouch|book_take|book_put|cheer|stretch|yawn|shrug|bow|nod|shake|point)$/i;

/** Remove the start -> end drift from the bone positions of every looping clip. Returns how many tracks changed. */
export function inPlace(clips) {
  let changed = 0;
  for (const clip of clips || []) {
    if (ONCE.test(clip.name || "")) continue;
    for (const t of clip.tracks) {
      if (!t.name.endsWith(".position") || t.times.length < 3 || t.getValueSize() !== 3) continue;
      const v = t.values;
      const n = t.times.length;
      const drift = [0, 1, 2].map((k) => v[(n - 1) * 3 + k] - v[k]);
      const size = Math.hypot(...drift);
      let reach = 0;                                       // how far it moves at most (idle breathing barely moves)
      for (let i = 1; i < n; i++) reach = Math.max(reach, Math.hypot(v[i * 3] - v[0], v[i * 3 + 1] - v[1], v[i * 3 + 2] - v[2]));
      if (size < 1e-5 || size < reach * 0.2) continue;     // already loops (it comes back to where it started)
      const t0 = t.times[0];
      const span = t.times[n - 1] - t0 || 1;
      for (let i = 0; i < n; i++) {
        const f = (t.times[i] - t0) / span;
        for (let k = 0; k < 3; k++) v[i * 3 + k] -= drift[k] * f;
      }
      changed++;
    }
  }
  return changed;
}
