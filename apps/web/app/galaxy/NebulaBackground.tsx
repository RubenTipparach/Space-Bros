"use client";

/**
 * CSS-only nebula wash. Multiple blurred radial gradients at different
 * offsets + colors layered under the canvas. Runs everywhere (no WebGL),
 * looks decent, costs zero frame time.
 */
export function NebulaBackground() {
  return (
    <div className="nebula-bg" aria-hidden>
      <div className="nebula-layer layer-a" />
      <div className="nebula-layer layer-b" />
      <div className="nebula-layer layer-c" />
      <div className="nebula-layer layer-d" />
      <div className="nebula-grain" />
    </div>
  );
}
