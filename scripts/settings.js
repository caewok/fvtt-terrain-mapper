/* globals
game
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "./const.js";
import { TerrainSettingsMenu } from "./TerrainSettingsMenu.js";

export class TerrainSettings {

  /**
   * Keys for all the settings used in this module.
   * @type {object}
   */
  static KEYS = {
    MENU: "menu",
    TERRAINS: "terrains",

    // Configuration of the application that controls the terrain listings.
    CONTROL_APP: {
      EXPANDED_FOLDERS: "app_expanded_folders"
    }
  };

  /**
   * Retrive a specific setting.
   * @param {string} key
   * @returns {*}
   */
  static get(key) { return game.settings.get(MODULE_ID, key); }

  /**
   * Set a specific setting.
   * @param {string} key
   * @param {*} value
   * @returns {Promise<boolean>}
   */
  static set(key, value) { return game.settings.set(MODULE_ID, key, value); }

  /**
   * Register a specific setting.
   * @param {string} key        Passed to registerMenu
   * @param {object} options    Passed to registerMenu
   */
  static register(key, options) { game.settings.register(MODULE_ID, key, options); }

  /**
   * Register a submenu.
   * @param {string} key        Passed to registerMenu
   * @param {object} options    Passed to registerMenu
   */
  static registerMenu(key, options) { game.settings.registerMenu(MODULE_ID, key, options); }

  /**
   * Register all settings
   */
  static registerAll() {
    const KEYS = this.KEYS;

    this.registerMenu(KEYS.MENU, {
      name: "Terrain Settings Menu",
      label: `${MODULE_ID}.settings.menu.title`,
      icon: "fas fa-cog",
      type: TerrainSettingsMenu,
      restricted: true
    });

    this.register(KEYS.TERRAINS, {
      scope: "world",
      config: false,
      default: {} // TODO: Should be stored per-system / world
    });

    this.register(KEYS.CONTROL_APP.EXPANDED_FOLDERS, {
      name: "Expanded Folders",
      scope: "client",
      config: false,
      default: [],
      type: Array
    });
  }

  /** @type {string[]} */
  get expandedFolders() { return TerrainSettings.get(TerrainSettings.KEYS.CONTROL_APP.EXPANDED_FOLDERS); }

  /**
   * Add a given folder id to the saved expanded folders.
   * @param {string} folderId
   * @returns {Promise} A promise that resolves when the setting update completes.
   */
  async addExpandedFolder(folderId) {
    let folderArr = this.expandedFolders;
    folderArr.push(folderId);
    folderArr = [...new Set(folderArr)]; // Remove duplicates.
    TerrainSettings.set(TerrainSettings.KEYS.CONTROL_APP.EXPANDED_FOLDERS, folderArr);
  }

  /**
   * Remove a given folder name from the expanded folders array.
   * @param {string} id   Id of the folder to remove from the saved expanded folders list.
   * @returns {Promise} A promise that resolves when the setting update completes.
   */
  async removeExpandedFolder(id) {
    const expandedFolderArray = this.expandedFolders.filter(expandedFolder => expandedFolder !== id);
    return TerrainSettings.set(TerrainSettings.KEYS.CONTROL_APP.EXPANDED_FOLDERS, expandedFolderArray);
  }

  /**
   * Remove all saved expanded folders.
   * @returns {Promise} Promise that resolves when the settings update complete.
   */
  async clearExpandedFolders() { TerrainSettings.set(TerrainSettings.KEYS.CONTROL_APP.EXPANDED_FOLDERS, []); }

  /**
   * Check if given folder nae is expanded.
   * @param {string} id   Folder id for which to search
   * @returns {boolean} True if the folder is in the saved expanded list.
   */
  isFolderExpanded(id) { return this.expandedFolders.includes(id); }
}
