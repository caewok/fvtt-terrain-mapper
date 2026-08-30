/* globals
foundry,
game,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID, FLAGS } from "./const.js";
import { ModuleSettingsAbstract } from "./ModuleSettingsAbstract.js";

/**
 * @typedef {object} TMFolder
 * Data that describes a folder in the Terrain Book. Stored in settings.
 *
 * @param {string} id         Folder id
 * @param {string} name       Folder name or a localizable string
 * @param {string} color      Folder color
 * @param {string[]} effects  uniqueEffectId of effects stored in the folder.
 */

export class Settings extends ModuleSettingsAbstract {

  /**
   * Keys for all the settings used in this module.
   * @type {object}
   */
  static KEYS = {
    // Dialog with announcements re major updates.
    CHANGELOG: "changelog"
  };

  /**
   * Register all settings
   */
  static registerAll() {
    const KEYS = this.KEYS;




    // ----- NOTE: Hidden settings ----- //
  }

}
