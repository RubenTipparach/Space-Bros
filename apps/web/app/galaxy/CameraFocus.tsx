"use client";

import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

interface OrbitLike {
  target: THREE.Vector3;
  update(): void;
  minDistance?: number;
  maxDistance?: number;
}

interface Props {
  /** Target point on the galactic plane. Null means "leave it alone". */
  target: THREE.Vector3 | null;
  /** Desired camera distance from the target. */
  distance: number | null;
  /** Pitch angle (rad) above the plane; clamped by OrbitControls anyway. */
  pitch?: number;
}

/**
 * Lerps the OrbitControls target + camera distance toward the props'
 * values every frame. Used to animate a smooth "focus on sector" when
 * the user clicks a territory.
 */
export function CameraFocus({ target, distance, pitch = 0.55 }: Props) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls as unknown as OrbitLike | null);
  const prevTarget = useRef(target);

  useEffect(() => {
    prevTarget.current = target;
  }, [target]);

  useFrame(() => {
    if (!controls || !target || distance == null) return;
    // Snappier than before (was 0.09). Snap to target when within
    // epsilon so the animation finishes cleanly.
    const lerpFactor = 0.22;

    controls.target.lerp(target, lerpFactor);
    if (controls.target.distanceToSquared(target) < 0.25) {
      controls.target.copy(target);
    }

    // Compute the desired camera position: keep the current azimuth
    // (x/z direction from target) but pitch it up and scale to the
    // target distance.
    const curOffset = camera.position.clone().sub(controls.target);
    const curDist = Math.max(0.0001, curOffset.length());
    const newDist = curDist + (distance - curDist) * lerpFactor;

    // Project current offset into horizontal plane, preserve its
    // direction, re-add the pitched height.
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
    if (camera.position.distanceToSquared(desired) < 0.25) {
      camera.position.copy(desired);
    }
    controls.update();
  });

  return null;
}
