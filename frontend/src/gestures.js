// Mouse wheel vs touchpad, told apart from the wheel events themselves (pure, unit tested).
//
//   pinch (touchpad) / ctrl + wheel  -> 'zoom'   (browsers send these as wheel events with ctrlKey)
//   mouse-wheel notch                -> 'zoom'   (one fixed step, see wheelZoomDelta)
//   two-finger swipe on a touchpad   -> 'pan'
//
// A notch is a whole, large vertical delta with no horizontal part (or a line/page based delta).
// Touchpads send small, fractional or two-dimensional deltas; a big whole-number delta that comes right
// after touchpad events is still treated as touchpad (the start of a fast flick), so a swipe never zooms.

const PAD_GRACE_MS = 150;

export function createWheelClassifier() {
  let lastPad = -Infinity;
  const seen = new WeakMap();   // the zoom filter and the pan handler both ask about the same event
  return function classify(e) {
    if (e.ctrlKey) return 'zoom';
    if (seen.has(e)) return seen.get(e);
    let kind;
    const notch = e.deltaMode !== 0 || (e.deltaX === 0 && Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 50);
    if (notch && e.timeStamp - lastPad > PAD_GRACE_MS) kind = 'zoom';
    else { kind = 'pan'; lastPad = e.timeStamp; }
    seen.set(e, kind);
    return kind;
  };
}

/** Zoom amount (d3 wheelDelta units) of one wheel event: a notch is a gentle fixed step (~x1.15),
 *  touchpad pinch sends many small deltas and stays proportional. */
export function wheelZoomDelta(e) {
  const dy = e.deltaY * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1);
  const mag = Math.abs(dy);
  return -Math.sign(dy) * (mag >= 30 ? 0.2 : Math.min(mag * 0.02, 0.5));
}

/** Pan distance in pixels of a touchpad swipe event (lines/pages -> pixels). */
export function wheelPanDelta(e) {
  const f = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1;
  return [e.deltaX * f, e.deltaY * f];
}
