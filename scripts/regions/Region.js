/* globals
foundry,
Region
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";


/*
Methods and hooks related to tokens.
Hook token movement to add/remove terrain effects and pause tokens dependent on settings.
*/

import { MODULE_ID, FLAGS } from "../const.js";

export const PATCHES = {};
PATCHES.REGIONS = {};

/* Modify Region#segmentizeMovement to handle elevation options.

1. Plateau
--> Move token from any elevation w/in region to defined elevation.
- If token enters the region, redo waypoints.
- If token exits the region, redo waypoints if reset is true.


2. Ramp / Steps
--> In a user-defined direction, the region increases elevation from a defined min to a defined max.
--> Any token moving in the region has elevation adjusted accordingly
--> User can define the step size

2. Stairs
--> Define halfway point between two elevations. Tokens below halfway point go up to set upper elevation.
    Tokens above halfway point go down to set lower elevation.

Options:
• Teleport. Ignore other regions. Elevation movement is a teleport that will not trigger overlapping regions.
  Acts as exit for other regions at start, followed by enter for other regions at end.
• Ignore Other Elevations. Ignore tokens not at top/bottom elevation points when entering.

Ignores tokens within the region already that may be at a different elevation.
For ramp, tokens not at the defined elevation are not moved to the next up/down step.

When exiting, moves back to the scene elevation

(No dialog option; use levels stairs/elevator for that region behavior.)


*/

/**
 * Wrap Region#segmentizeMovement to handle plateau/ramp/stairs/elevator
 * @param {RegionMovementWaypoint[]} waypoints    The waypoints of movement.
 * @param {Point[]} samples                       The points relative to the waypoints that are tested.
 *                                                Whenever one of them is inside the region, the moved object
 *                                                is considered to be inside the region.
 * @param {object} [options]                      Additional options
 * @param {boolean} [options.teleport=false]      Is it teleportation?
 * @returns {RegionMovementSegment[]}             The movement split into its segments.
 */
function segmentizeMovement(wrapper, waypoints, samples, opts) {
  const segments = wrapper(waypoints, samples, opts);
  const numSegments = segments.length;
  if ( !numSegments ) return segments;

  // Determine if the region has a setElevation behavior.
  // For each behavior, adjust the segments to reflect the behavior.
  // TODO: Better handling if multiple behaviors found.
  for ( const behavior of this.document.behaviors ) {
    modifySegmentsForPlateau(segments, behavior);
  }
  return segments;
}

PATCHES.REGIONS.WRAPS = { segmentizeMovement };


// ----- NOTE: Helper functions ----- //

/* Plateau
Treat the plateau as mostly a hard obstacle.
Entry from top: stay at the plateau elevation.
Entry from side: stay at the plateau elevation.

Only way to be "inside" the plateau is to enter from the bottom or do a move once on top.

Track whether we are outside or inside the region.
Every time we move from outside --> in,
  - Add vertical move up.
  - change all subsequent inside ("move") points to the elevation.
Every time we move inside --> out
  - If reset, add drop to ground unless the segment has elevation; do not adjust subsequent points.
  - If not reset and at plateau elevation, adjust subsequent points.

Technically, it may be possible for a change in plateau to require a re-do of the segmentized path.
But not practically at the moment b/c all region shapes have the same shape as they move up in elevation.
*/


/**
 * Adjust region movement segments for the setElevation plateau behavior.
 * @param {RegionMovementSegment[]} segments
 * @param {RegionBehavior} behavior
 */
function modifySegmentsForPlateau(segments, behavior) {
  if ( behavior.type !== `${MODULE_ID}.setElevation` || behavior.disabled || behavior.system.algorithm !== FLAGS.REGION.CHOICES.PLATEAU ) return segments;
  const { elevation, floor, reset } = behavior.system;
  const { ENTER, MOVE, EXIT } = Region.MOVEMENT_SEGMENT_TYPES;

  let enteredPlateau = false;
  let exitDelta = 0;
  for ( let i = 0, n = segments.length; i < n; i += 1 ) {
    const segment = segments[i];
    switch ( segment.type ) {
      case ENTER: {
        enteredPlateau = true;
        segment.from.elevation += exitDelta;
        segment.to.elevation += exitDelta;

        // If already at elevation, we are finished.
        if ( elevation === segment.to.elevation ) break;

        // Add a vertical move up after the enter.
        const vSegment = constructVerticalMoveSegment(segment.to, elevation);
        segments.splice(i + 1, 0, vSegment);
        i += 1;
        n += 1;
        break;
      }
      case MOVE: {
        if ( !enteredPlateau ) break;
        segment.from.elevation = Math.max(elevation, segment.from.elevation);
        segment.to.elevation = Math.max(elevation, segment.to.elevation);
        break;
      }
      case EXIT: {
        enteredPlateau = false;
        if ( reset ) {
          // If the previous segment is not at reset elevation, add vertical move (down)
          const prevSegment = segments[i - 1] ?? { to: segment.from }; // Use this segment's from if no previous segment.
          if ( prevSegment.to.elevation !== floor ) {
            const vSegment = constructVerticalMoveSegment(prevSegment.to, floor);
            segments.splice(i, 0, vSegment);
            i += 1;
            n += 1;
          }
          segment.from.elevation = floor;
          segment.to.elevation = floor;
          exitDelta = 0;
          break;
        }

        // Subsequent points shifted by the plateau delta from this exit location.
        exitDelta = elevation - segment.to.elevation;
        segment.from.elevation += exitDelta;
        segment.to.elevation += exitDelta;
        break;
      }
    }
  }
  return segments;
}

/**
 * Construct a vertical move segment.
 * @param {RegionWaypoint} waypoint
 * @param {number} targetElevation
 * @returns {RegionMoveSegment}
 */
function constructVerticalMoveSegment(waypoint, targetElevation) {
  return {
    from: {
      x: waypoint.x,
      y: waypoint.y,
      elevation: waypoint.elevation
    },
    to: {
      x: waypoint.x,
      y: waypoint.y,
      elevation: targetElevation
    },
    type: Region.MOVEMENT_SEGMENT_TYPES.MOVE
  };
}
