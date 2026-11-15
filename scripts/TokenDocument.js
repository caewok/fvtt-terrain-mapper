/* globals

*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

export const PATCHES = {};
PATCHES.ELEVATION = {};


/* Foundry code
let reachableWaypoints = 0;
for ( const waypoint of foundPath ) {
  const explicitWaypoint = explicitWaypoints[reachableWaypoints];          // undefined once the index == length
  if ( TokenDocument.arePositionsEqual(explicitWaypoint, waypoint) ) reachableWaypoints++;
}

The loop assumes the last explicit waypoint (the drag destination) is also the last point of foundPath.
Once every explicit waypoint has been matched, any further point in foundPath makes explicitWaypoint undefined.
arePositionsEqual(undefined, wp) then reads undefined.x and throws.
Triggered by terrain path creation: The match compares MOVEMENT_FIELDS (x, y, elevation, and so on)
against the explicit destination, which carries the elevation the drag asked for.
Terrain adds a vertical step at the end. When the destination is on or very near an edge,
your path looks like (edge, floor) → (edge, top). The first point equals the explicit destination
and counts as reached, and the second point follows it.
That would explain why you only see this “occasionally” and near terrain.
*/

/**
 * Guard against arePositionsEqual failing if either argument is missing.
 * If one is missing, return false, which will treat the extra trailing point as unmatched.
 */
function arePositionsEqual(wrapped, p1, p2) {
  if ( !(p1 && p2) ) return false;
  return wrapped(p1, p2);
}

PATCHES.ELEVATION.STATIC_METHODS = { arePositionsEqual };