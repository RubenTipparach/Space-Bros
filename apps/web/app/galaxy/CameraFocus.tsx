"use client";

import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

interface OrbitLike {
  target: THREE.Vector3;
  update(): void;
  addEventListener?(e: string, fn: () => void): void;
  removeEventListener?(e: string, fn: () => void): void;
}

interface Props {
  /** Target point on the galactic plane. */
  target: THREE.Vector3 | null;
  /** Desired camera distance from the target. */
  distance: number | null;
  /** Pitch angle (rad) above the plane; clamped by OrbitControls anyway. */
  pitch?: number;
}

/**
 * ONE-SHOT animated camera move. When `target` or `distance` change,
 * start lerping; once we've converged (or the user starts dragging/
 * scrolling), stop — OrbitControls gets full control back so the user
 * can freely zoom/pan without the camera yanking them back.
 *
 * Earlier revisions ran the lerp every frame forever which fought
 * every user input. That's the "rubber-band" the user called out.
 */
export function CameraFocus({ target, distance, pitch = 0.55 }: Props) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls as unknown as OrbitLike | null);

  const animating = useRef(false);
  const goalTarget = useRef<THREE.Vector3 | null>(null);
  const goalDistance = useRef<number | null>(null);

  // Kick off a new animation whenever the intended target or distance
  // changes. We compare by coordinates, not reference, so stable
  // useMemo outputs don't re-trigger.
  const tx = target?.x ?? 0;
  const ty = target?.y ?? 0;
  const tz = target?.z ?? 0;
  useEffect(() => {
    if (!target || distance == null) return;
    goalTarget.current = target.clone();
    goalDistance.current = distance;
    animating.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tx, ty, tz, distance]);

  // User starts dragging/scrolling → abort animation immediately.
  useEffect(() => {
    if (!controls || !controls.addEventListener) return;
    const onStart = () => {
      animating.current = false;
    };
    controls.addEventListener("start", onStart);
    return () => {
      controls.removeEventListener?.("start", onStart);
    };
  }, [controls]);

  useFrame(() => {
    if (!animating.current) return;
    if (!controls || !goalTarget.current || goalDistance.current == null) return;

    const lerpFactor = 0.22;
    controls.target.lerp(goalTarget.current, lerpFactor);

    const curOffset = camera.position.clone().sub(controls.target);
    const curDist = Math.max(0.0001, curOffset.length());
    const newDist = curDist + (goalDistance.current - curDist) * lerpFactor;

    const horiz = new THREE.Vector2(curOffset.x, curOffset.z);
    if (horiz.lengthSq() < 1e-6) horiz.set(0, 1);
    horiz.normalize();
    const horizontalLen = Math.cos(pitch) * newDist;
    const verticalLen = Math.sin(pitch) * newDist;

    const desired = new THREE.Vector3(
      horiz.x * horizontalLen,
      verticalLen,
      horiz.y * horizontalLen,
    ).add(controls.target);

    camera.position.lerp(desired, lerpFactor);
    controls.update();

    const targetClose =
      controls.target.distanceToSquared(goalTarget.current) < 0.5;
    const posClose = camera.position.distanceToSquared(desired) < 0.5;
    if (targetClose && posClose) {
      controls.target.copy(goalTarget.current);
      camera.position.copy(desired);
      controls.update();
      animating.current = false;
    }
  });

  return null;
}
