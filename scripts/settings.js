/* globals
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { SETTINGS } from "./const.js";
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
  static KEYS = SETTINGS;

  /**
   * Register all settings
   */
  static registerAll() {
    const { KEYS, registerWorld } = this;

    registerWorld(KEYS.PARALLAX.ENABLE, {
      type: Boolean,
      default: false,
    });

    registerWorld(KEYS.PARALLAX.ENABLE_SHADOWS, {
      type: Boolean,
      default: true,
    });

    registerWorld(KEYS.PARALLAX.ENABLE_TOKEN_SIZING, {
      type: Boolean,
      default: true,
    });
  }
}
