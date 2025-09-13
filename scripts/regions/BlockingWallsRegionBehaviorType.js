/* globals
CONST,
foundry,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "../const.js";
import { updateRegionEdgeRestrictions, removeEdgesForRegionId } from "./Region.js";

/**
 * Region behavior to set token to specific top/bottom elevation.
 * @property {number} elevation       The elevation at which to set the token
 * @property {number} floor           The elevation at which to reset the token when leaving the region
 *                                    Defaults to scene elevation
 * @property {number} rampStepHeight  The vertical size, in grid units, of ramp elevation increments
 * @property {number} rampDirection   The direction of incline for the ramp, in degrees
 * @property {boolean} reset          When enabled, elevation will be reset to floor on exit
 * @property {FLAGS.REGION.CHOICES} algorithm       How elevation change should be handled. plateau, ramp, stairs
 */
export class BlockingWallsRegionBehaviorType extends foundry.data.regionBehaviors.RegionBehaviorType {
  static defineSchema() {
    const fields = foundry.data.fields;
    const schemaFieldOptions = {
      label: `${MODULE_ID}.region-config.wallRestrictions.name`,
      hint: `${MODULE_ID}.region-config.wallRestrictions.hint`
    };

    // Limit wall types to none, limited, or full for now.
    const senseTypes = {};
    const moveTypes = {};
    Object.entries(CONST.WALL_SENSE_TYPES).forEach(([key,value]) => { if ( value <= CONST.WALL_SENSE_TYPES.NORMAL ) senseTypes[value] = `WALL.SenseTypes.${key}`; });
    Object.entries(CONST.WALL_MOVEMENT_TYPES).forEach(([key,value]) => moveTypes[value] = `WALL.SenseTypes.${key}`);

    return {
      types: new fields.SchemaField({
        light: new fields.NumberField({required: true, choices: senseTypes,
          initial: CONST.WALL_SENSE_TYPES.NONE,
          validationError: "must be a value in CONST.WALL_SENSE_TYPES",
          label: "Light",
        }),
        move: new fields.NumberField({required: true, choices: moveTypes,
          initial: CONST.WALL_MOVEMENT_TYPES.NONE,
          validationError: "must be a value in CONST.WALL_MOVEMENT_TYPES",
          label: "Move",
        }),
        sight: new fields.NumberField({required: true, choices: senseTypes,
          initial: CONST.WALL_SENSE_TYPES.NONE,
          validationError: "must be a value in CONST.WALL_SENSE_TYPES",
          label: "Sight",
        }),
        sound: new fields.NumberField({required: true, choices: senseTypes,
          initial: CONST.WALL_SENSE_TYPES.NONE,
          validationError: "must be a value in CONST.WALL_SENSE_TYPES",
          label: "Sound",
        }),
        cover: new fields.BooleanField({
          label: `${MODULE_ID}.behavior.types.blockingWalls.fields.types.cover.name`,
          hint: `${MODULE_ID}.region-config.wallRestrictions.hint`,
          required: true,
          initial: false,
        }),
      }, schemaFieldOptions),
    };
  }

  // Don't need _onCreate b/c none of the blocking options are enabled on create.
  // Handled by _onUpdate.

  _onUpdate(changed, options, userId) {
    super._onUpdate(changed, options, userId);
    if ( !changed.system?.types ) return;
    updateRegionEdgeRestrictions(this.region.object);
  }

  _onDelete(options, userId) {
    super._onDelete(options, userId);
    removeEdgesForRegionId(this.region.object.id);
  }
}
