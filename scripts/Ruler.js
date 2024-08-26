/* globals
CanvasAnimation,
game,
ui
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

import { hasCollisionAlongPath, calculatePathForCenterPoints } from "./Token.js";
import { RegionMovementWaypoint3d } from "./geometry/3d/RegionMovementWaypoint3d.js";

// Patches for the Ruler class
export const PATCHES = {};
PATCHES.RULER = {};

/**
 * Wrap Ruler.prototype._animateSegment
 * Construct the path for the segment and update token accordingly.
 * (Patching will turn off if Elevation Ruler is present)
 */
async function _animateSegment(wrapped, token, segment, destination, updateOptions) {
  const aCentered = RegionMovementWaypoint3d.fromObject(segment.ray.A);
  aCentered.z = token.elevationZ;
  const bCentered = RegionMovementWaypoint3d.fromObject(segment.ray.B);
  bCentered.z = aCentered.z;
  const path = calculatePathForCenterPoints(token, aCentered, bCentered);

  // Test for collisions; if any collision along the path, don't move.
  if ( !game.user.isGM && hasCollisionAlongPath(path, token) ) {
      ui.notifications.error("RULER.MovementCollision", {localize: true, console: false});
      return;
  }

  // Move each piece of the path in turn.
  const delta = PIXI.Point.fromObject(destination).subtract(segment.ray.B);
  let prev = path[0];
  for ( let i = 1, n = path.length; i < n; i += 1 ) {
    const curr = path[i];
    segment.ray.A = prev;
    segment.ray.B = curr;
    const newDest = curr.add(delta, RegionMovementWaypoint3d._tmp);  // Set the path to the top left so token updating works.
    await wrapped(token, segment, { x: newDest.x, y: newDest.y, elevation: newDest.elevation }, updateOptions);
    prev = curr;
  }
}

PATCHES.RULER.WRAPS = { _animateSegment };
