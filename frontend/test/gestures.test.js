import test from 'node:test';
import assert from 'node:assert/strict';
import { createWheelClassifier, wheelZoomDelta, wheelPanDelta } from '../src/gestures.js';
import { pushAside, ringSlots, pullAround, FOCUS_SCALE } from '../src/focus.js';

const wheel = (o) => ({ ctrlKey: false, deltaMode: 0, deltaX: 0, deltaY: 0, timeStamp: 0, ...o });

test('pinch and ctrl+wheel zoom', () => {
  assert.equal(createWheelClassifier()(wheel({ ctrlKey: true, deltaY: 3.5 })), 'zoom');
});
test('a mouse-wheel notch zooms, line-based notches too', () => {
  const c = createWheelClassifier();
  assert.equal(c(wheel({ deltaY: 100 })), 'zoom');
  assert.equal(c(wheel({ deltaMode: 1, deltaY: 3, timeStamp: 10 })), 'zoom');
});
test('touchpad swipes pan: small, fractional or horizontal deltas', () => {
  const c = createWheelClassifier();
  assert.equal(c(wheel({ deltaY: 7 })), 'pan');
  assert.equal(c(wheel({ deltaY: 120.5, timeStamp: 5 })), 'pan');
  assert.equal(c(wheel({ deltaX: 40, deltaY: 100, timeStamp: 10 })), 'pan');
});
test('a big whole delta right after touchpad events is still a swipe; later it is a notch again', () => {
  const c = createWheelClassifier();
  assert.equal(c(wheel({ deltaY: 5, timeStamp: 1000 })), 'pan');
  assert.equal(c(wheel({ deltaY: 100, timeStamp: 1050 })), 'pan');
  assert.equal(c(wheel({ deltaY: 100, timeStamp: 1500 })), 'zoom');
});
test('the same event always gets the same answer', () => {
  const c = createWheelClassifier(), e = wheel({ deltaY: 100, timeStamp: 2000 });
  assert.equal(c(e), 'zoom');
  assert.equal(c(e), 'zoom');
});
test('scroll-to-zoom sensitivity is unchanged', () => {
  assert.equal(wheelZoomDelta(wheel({ deltaY: 100 })), -0.2);
  assert.equal(wheelZoomDelta(wheel({ deltaY: -100 })), 0.2);
  assert.ok(Math.abs(wheelZoomDelta(wheel({ deltaY: 5 })) + 0.1) < 1e-9);
  assert.deepEqual(wheelPanDelta(wheel({ deltaX: 2, deltaY: 3 })), [2, 3]);
});

test('a growing gene pushes its neighbours aside and leaves distant ones alone', () => {
  const R = 12.5;
  const centre = { x: 0, y: 0, r: R };
  const near = { x: 20, y: 0, r: R }, far = { x: 400, y: 0, r: R };
  const moved = pushAside([centre, near, far], centre, R * FOCUS_SCALE);
  assert.ok(moved.has(near) && !moved.has(far) && !moved.has(centre));
  assert.ok(Math.hypot(moved.get(near).x, moved.get(near).y) >= R * FOCUS_SCALE + R);   // no overlap any more
});

test('pulled genes sit on rings around the selected gene without overlapping each other', () => {
  const R = 12.5, c = { x: 100, y: 50, r: R };
  const around = Array.from({ length: 40 }, (_, i) => ({ x: i * 37 % 500, y: i * 91 % 400, r: R }));
  const out = pullAround(c, around, R);
  assert.equal(out.size, 40);
  const pts = [...out.values()];
  for (const p of pts) assert.ok(Math.hypot(p.x - c.x, p.y - c.y) >= 2 * R);          // clear of the centre
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++)
    assert.ok(Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y) >= 2 * R, `overlap ${i}/${j}`);
  // the strongest (first) genes take the innermost ring
  const d = (n) => Math.hypot(out.get(n).x - c.x, out.get(n).y - c.y);
  assert.ok(d(around[0]) <= d(around[39]));
});
test('ring slots: no genes, one gene, many genes', () => {
  assert.equal(ringSlots({ x: 0, y: 0 }, 0, 12.5).length, 0);
  assert.equal(ringSlots({ x: 0, y: 0 }, 1, 12.5).length, 1);
  assert.equal(ringSlots({ x: 0, y: 0 }, 300, 12.5).length, 300);
});

import { clampOffset } from '../src/dom.js';
test('a moved pop-up always keeps part of itself on screen', () => {
  const rect = { left: 100, top: 50, width: 600, height: 300 }, win = { width: 1000, height: 700 };
  assert.deepEqual(clampOffset(10, 20, rect, win), [10, 20]);
  assert.deepEqual(clampOffset(5000, 5000, rect, win), [1000 - 48 - 100, 700 - 48 - 50]);
  assert.deepEqual(clampOffset(-5000, -5000, rect, win), [48 - 700, -50]);   // never above the window, 48px of it stay on the left
});
