/* globals
RegionBehaviorType
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "../const.js";
import { log } from "../util.js";

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
    const choices = {};
    CONFIG[MODULE_ID].Terrain._instances.forEach(t => choices[t.id] = t.name);
    return choices;
  }
}
