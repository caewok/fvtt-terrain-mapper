/* globals
CONFIG,
CONST,
foundry,
game,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "../const.js";
import { GEOMETRY_LIB_ID } from "../geometry/const.js";
import { pixelsToGridUnits } from "../geometry/util.js";

export const PATCHES = {};
PATCHES.REGIONS = {};


/**
 * Region behavior to set token to specific top/bottom elevation.
 * @property {number} elevation       The elevation at which to set the token
 * @property {number} floor           The elevation at which to reset the token when leaving the region
 *                                    Defaults to scene elevation
 * @property {number} rampStepHeight  The vertical size, in grid units, of ramp elevation increments
 * @property {number} rampDirection   The direction of incline for the ramp, in degrees
 * @property {boolean} reset          When enabled, elevation will be reset to floor on exit
 * @property {FLAGS.REGION.TERRAIN.CHOICES} algorithm       How elevation change should be handled. plateau, ramp, stairs
 */
export class RampTerrainRegionBehaviorType extends foundry.data.regionBehaviors.RegionBehaviorType {
  static defineSchema() {
    return {
      direction: new foundry.data.fields.NumberField({
        label: `${MODULE_ID}.region-config.rampDirection.name`,
        hint: `${MODULE_ID}.region-config.rampDirection.hint`,
        initial: 0,
        min: 0,
        max: 359,
        step: 1,
      }),

      dialog: new foundry.data.fields.BooleanField({
        label: `${MODULE_ID}.behavior.types.stairs.fields.dialog.name`,
        hint: `${MODULE_ID}.behavior.types.stairs.fields.dialog.hint`,
        initial: false
      }),
    };
  }


}

/*

tokenD = _token.document



waypoints = [
  { x: tokenD.x + 500, y: tokenD.y, elevation: 10 },
]

tokenD.getCompleteMovementPath(waypoints)

await tokenD.move(waypoints)


*/