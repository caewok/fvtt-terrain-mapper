/* globals
foundry,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "../const.js";

/**
 * Allows the GM to identify regions that should have a parallax visual effect applied to them.
 */
export class ParallaxRegionBehaviorType extends foundry.data.regionBehaviors.RegionBehaviorType {
  static defineSchema() {
    return {
      strength: new foundry.data.fields.NumberField({
        label: `${MODULE_ID}.behavior.types.parallax.fields.strength.name`,
        hint: `${MODULE_ID}.behavior.types.parallax.fields.strength.hint`,
        initial: 0.1,
        // What range?
        // min: -1, // 0 disables; negative would flip?
        // max: 1,
      }),
    };
  }
}
