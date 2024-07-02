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
 * @param {number} [options.levelIncrement=0]     Override the level increment to move this number of levels and direction
 * @param {boolean} [options.skipDialog=false]    Ignore the user/gm dialog. Instead, use automatic
 * @returns {RegionMovementSegment[]}             The movement split into its segments.
 */
function segmentizeMovement(wrapper, waypoints, samples, { levelIncrement = 0, skipDialog = false, ...opts } = {}) {
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

/**
 * Adjust region movement segments for the setElevation plateau behavior.
 * @param {RegionMovementSegment[]} segments
 * @param {RegionBehavior} behavior
 */
function modifySegmentsForPlateau(segments, behavior) {
  if ( behavior.type !== `${MODULE_ID}.setElevation` || behavior.disabled || behavior.system.algorithm !== FLAGS.REGION.CHOICES.PLATEAU ) return segments;

  // Entry: increase elevation.
  // Exit: restore elevation to floor.
  // Move: keep the elevation we set.
  // Affects elevation at future segments until there is a distinct elevation move.

  const duplicate = foundry.utils.duplicate;
  const { elevation, floor, reset } = behavior.system;
  const { ENTER, MOVE, EXIT } = Region.MOVEMENT_SEGMENT_TYPES;
  let currE = null;
  for ( let i = 0, n = segments.length; i < n; i += 1 ) {
    const segment = segments[i];
    switch ( segment.type ) {
      case ENTER: {
        if ( currE !== null ) {
          segment.from.elevation = currE;
          segment.to.elevation = currE;
        }
        currE = elevation;
        if ( segment.to.elevation !== elevation ) {
          // Add a vertical move up after the enter.
          const from = duplicate(segment.to)
          const to = duplicate(segment.to);
          to.elevation = elevation;
          const vSegment = { type: MOVE, from, to };
          segments.splice(i + 1, 0, vSegment);
          i += 1;
          n += 1;
        }
        break;
      }
      case MOVE: {
        if ( currE === null ) break;
        // If elevation changes with this move, no longer lock to max elevation.
        if ( segment.from.elevation !== segment.to.elevation ) {
          segment.from.elevation = currE;
          currE = undefined;
          break;
        }
        segment.from.elevation = currE;
        segment.to.elevation = currE;
        break;
      }
      case EXIT: {
        const prevSegment = segments[i - 1];
        if ( reset && prevSegment && prevSegment.to.elevation !== floor ) {
          // Insert a vertical move down before the exit.
          const from = duplicate(prevSegment.to)
          const to = duplicate(segment.from);
          from.elevation = prevSegment.to.elevation;
          to.elevation = floor;
          const vSegment = { type: MOVE, from, to };
          segments.splice(i, 0, vSegment);
          i += 1;
          n += 1;
        }

        if ( reset ) currE = floor;
        if ( currE === null ) break;
        if ( segment.from.elevation !== segment.to.elevation ) {
          segment.from.elevation = currE;
          currE = undefined;
          break;
        }
        segment.from.elevation = currE;
        segment.to.elevation = currE;
        break;
      }
    }
  }
  return segments;
}
