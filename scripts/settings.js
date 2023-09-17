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
    TERRAINS_ITEM: "terrains_item", // Stores terrain effects
    FAVORITES: "favorites", // Array of favorite terrains, by effect id.

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
   * Retrieve a specific setting by using the key name.
   * @param {string} key
   * @returns {*}
   */
  static getByName(keyName) {
    const key = getProperty(this.KEYS, keyName);
    if ( !key ) console.warn(`Key ${keyName} does not exist.`);
    return this.get(key);
  }

  /**
   * Set a specific setting.
   * @param {string} key
   * @param {*} value
   * @returns {Promise<boolean>}
   */
  static async set(key, value) { return game.settings.set(MODULE_ID, key, value); }

  /**
   * Set a specific setting by using the key name.
   * @param {string} key
   * @param {*} value
   * @returns {Promise<boolean>}
   */
  static async setByName(keyName, value) {
    const key = getProperty(this.KEYS, keyName);
    if ( !key ) console.warn(`Key ${keyName} does not exist.`);
    return this.set(key, value);
  }

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

    this.register(KEYS.FAVORITES, {
      name: "Favorites",
      scope: "client",
      config: false,
      default: [],
      type: Array
    });

    this.register(KEYS.TERRAINS_ITEM, {
      scope: "world",
      config: false,
      default: undefined // TODO: Should be stored per-system / world
    });

    this.register(KEYS.CONTROL_APP.EXPANDED_FOLDERS, {
      name: "Expanded Folders",
      scope: "client",
      config: false,
      default: [],
      type: Array
    });
  }

  /**
   * Register the item used to store terrain effects.
   */
  static async initializeTerrainsItem() {
    if ( this.terrainEffectsItem ) return;
    const item = await CONFIG.Item.documentClass.create({
      name: "Terrains",
      img: "icons/svg/mountain.svg",
      type: "base"
    });
    await this.setByName("TERRAINS_ITEM", item.id);
  }

  static get terrainEffectsItem() {
    return game.items.get(this.getByName("TERRAINS_ITEM"));
  }

  /** @type {string[]} */
  static get expandedFolders() { return this.getByName("CONTROL_APP.EXPANDED_FOLDERS"); }

  /**
   * Add a given folder id to the saved expanded folders.
   * @param {string} folderId
   * @returns {Promise} A promise that resolves when the setting update completes.
   */
  static async addExpandedFolder(folderId) {
    let folderArr = this.expandedFolders;
    folderArr.push(folderId);
    folderArr = [...new Set(folderArr)]; // Remove duplicates.
    this.setByName("CONTROL_APP.EXPANDED_FOLDERS", folderArr);
  }

  /**
   * Remove a given folder name from the expanded folders array.
   * @param {string} id   Id of the folder to remove from the saved expanded folders list.
   * @returns {Promise} A promise that resolves when the setting update completes.
   */
  static async removeExpandedFolder(id) {
    const expandedFolderArray = this.expandedFolders.filter(expandedFolder => expandedFolder !== id);
    return this.setByName("CONTROL_APP.EXPANDED_FOLDERS", expandedFolderArray);
  }

  /**
   * Remove all saved expanded folders.
   * @returns {Promise} Promise that resolves when the settings update complete.
   */
  static async clearExpandedFolders() { this.setByName("CONTROL_APP.EXPANDED_FOLDERS", []); }

  /**
   * Check if given folder nae is expanded.
   * @param {string} id   Folder id for which to search
   * @returns {boolean} True if the folder is in the saved expanded list.
   */
  static isFolderExpanded(id) { return this.expandedFolders.includes(id); }

  /**
   * Check if a given effect id is in the favorites set.
   * @param {string} id     Active effect id
   * @returns {boolean}
   */
  static isFavorite(id) {
    const favorites = new Set(this.getByName("FAVORITES"));
    return favorites.has(id);
  }

  /**
   * Add effect id to favorites.
   * @param {string} id     Active effect id
   */
  static async addToFavorites(id) {
    const favorites = new Set(this.getByName("FAVORITES"));
    favorites.add(id); // Avoids duplicates.
    return this.setByName("FAVORITES", [...favorites]);
  }

  /**
   * Remove effect id from favorites.
   * @param {string} id
   */
  static async removeFromFavorites(id) {
    const favorites = new Set(this.getByName("FAVORITES"));
    favorites.delete(id); // Avoids duplicates.
    return this.setByName("FAVORITES", [...favorites]);
  }

}
