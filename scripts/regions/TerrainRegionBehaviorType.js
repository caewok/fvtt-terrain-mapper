/* globals
CONFIG,
foundry,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "../const.js";

/**
 * Abstract Region behavior re terrains
 */
export class TerrainRegionBehaviorType extends foundry.data.regionBehaviors.RegionBehaviorType {

  static _createTerrainsField(hint = "") {
    const fields = foundry.data.fields;
    const setFieldOptions = {
      label: `${MODULE_ID}.phrases.terrains`,
      hint,
    };

    return new fields.SetField(new fields.StringField({
      choices: this.terrainChoices,
      blank: false
    }), setFieldOptions);
  }

  static terrainChoices() {
    return CONFIG[MODULE_ID].Terrain._mapStoredEffectNames()
  }
}
