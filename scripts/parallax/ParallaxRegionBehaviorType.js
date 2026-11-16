/* globals
foundry,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "../const.js";

export const PATCHES = {};
PATCHES.REGIONS = {};


/* Move In vs Enter
https://ptb.discord.com/channels/170995199584108546/1184176344276406292/1243510660550361138

Move In/Out: Triggers only if the token enters or exits the region by movement (changes of x, y, or elevation).

Enter/Exit: Triggers when moved in/out and ...
when the region boundary changes such that it now contains/no longer contains the token,
when the token is created/deleted within the area of the region
when a behavior becomes active/inactive, in which case the event is triggered only for this behavior and not others.

Tokens Move In: You'll find a couple of new behaviors for Scene Regions that differ slightly from Token Enter
and Token Exit, providing subtle but important differences. Token Enter or Exit should be used in cases where
you want your behavior to triggerregardless of how a token entered or left the region. Token Move In or
Token Move Out should be used in cases where you want the assigned behavior to trigger explicitly as a result
of a user dragging, using their arrow keys, or moving their token along a path to get into the region.
"Why is this necessary?" You might ask. Do you like infinitely looping teleportation?
Because that is how you get infinitely looping teleportation.

Token Animate: Animation in and out

Token outside, moves through a region to another point outside:
Enter -> MoveIn -> MoveWithin -> Exit -> MoveOut -> AnimateIn -> AnimateOut

Token outside, moves to point within region:
Enter -> MoveIn -> MoveWithin -> AnimateIn

Token inside, moves to point outside region:
MoveWithin -> Exit -> MoveOut -> AnimateOut

Token inside, moves to point within region:
MoveWithin


Token above, moves into region via elevation change (same as outside --> inside)
Enter -> MoveIn -> MoveWithin

Token within, moves above region via elevation change
MoveWithin -> Exit -> MoveOut  (No animation!)

Things about these events that the design below depends on (all verified in foundry.mjs):

1. Movement is split into segments at region boundaries. Events fire after each segment, with the token
   already at the end of that segment (`movement.passed.waypoints.at(-1)`) and the rest of the path in
   `movement.pending.waypoints`.

2. MOVE_WITHIN is *also* sent at the position where a token leaves the region
   (see TokenDocument.#onUpdateHandleMoveWithinRegionEvents). At that moment `token.regions` no longer
   contains the region, so MOVE_WITHIN and MOVE_OUT both fire for the same segment.

3. `token.move()` starts a brand new, unchained movement, which stops the paused one.
   It does not "modify" the paused movement; the new path must contain everything still to be walked.

4. The event handlers are not awaited by the movement workflow. The movement only stays put if
   `pauseMovement()` is called synchronously, before the first `await`.
*/


/**
 * @typedef RegionPathWaypoint extends RegionMovementWaypoint
 * RegionMovementWaypoint with added features to describe its position along a segment and the regions encountered
 * @prop {object} regions
 *   - @prop {Set<Region>} enter    All regions entered at this location;
 *                                  the region contains this point but not the previous
 *   - @prop {Set<Region>} exit     All regions exited at this location;
 *                                  the region contains this point but not the next
 *   - @prop {Set<Region>} move     All regions were already entered at the start
 * @prop {number} dist2             Distance squared to the start
 * @prop {RegionMovementWaypoint} start   Starting waypoint
 */

// TokenMovementData: https://foundryvtt.com/api/interfaces/foundry.documents.types.TokenMovementData.html
// TokenMovementOptions: https://foundryvtt.com/api/interfaces/foundry.documents.types.TokenMovementOptions.html
// TokenMovementSegmentData: https://foundryvtt.com/api/interfaces/foundry.documents.types.TokenMovementSegmentData.html
// TokenMovementWaypoint: https://foundryvtt.com/api/interfaces/foundry.documents.types.TokenMovementWaypoint.html
// TokenProcessedMovementWaypoint: https://foundryvtt.com/api/interfaces/foundry.documents.types.TokenProcessedMovementWaypoint.html

/**
 * Region behavior that makes a region act as plateau terrain for walking tokens.
 * - Entering (moving in): the token climbs to the top of the region.
 * - Moving within: the token stays at the top of the region.
 * - Leaving (moving out): the token drops to the ground (base elevation of its level).
 * Flying and burrowing tokens are exempt (see CONFIG[MODULE_ID].terrain*Actions).
 *
 * The three events all funnel into one handler. That handler:
 *   1. Synchronously decides whether the remaining path needs any change (pure function of the event data).
 *      If not, it does nothing at all, so it never pauses movement unnecessarily.
 *   2. If a change is needed, pauses the movement (synchronously) using a keyed pause.
 *   3. Waits for the animation, then re-validates that the world still looks the way it did at (1).
 *   4. Issues exactly one `move()` with the fully corrected remaining path.
 *   5. If it did not replace the paused movement for any reason, resumes it.
 *
 * @property {boolean} dialog   Ask before changing elevation when entering/leaving. When enabled,
 *                              MOVE_WITHIN no longer corrects elevation on its own.
 */
export class ParallaxRegionBehaviorType extends foundry.data.regionBehaviors.RegionBehaviorType {
  static defineSchema() {
    return {
      strength: new foundry.data.fields.NumberField({
        label: `${MODULE_ID}.behavior.types.parallax.fields.strength.name`,
        hint: `${MODULE_ID}.behavior.types.parallax.fields.strength.hint`,
        initial: 1,
        // What range?
        // min: -100, // 0 disables; negative would flip?
        // max: 100,
      }),
    };
  }
}
