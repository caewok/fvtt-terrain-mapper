/* globals
CONFIG,
game,
ItemDirectory
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID, FLAGS } from "./const.js";
import { ModuleSettingsAbstract } from "./ModuleSettingsAbstract.js";

export const PATCHES_SidebarTab = {};
export const PATCHES_ItemDirectory = {};
PATCHES_SidebarTab.BASIC = {};
PATCHES_ItemDirectory.BASIC = {};

/**
 * Remove the terrains item from sidebar so it does not display.
 * From https://github.com/DFreds/dfreds-convenient-effects/blob/main/scripts/ui/remove-custom-item-from-sidebar.js#L3
 * @param {ItemDirectory} dir
 */
function removeTerrainsItemFromSidebar(dir) {
  if ( !(dir instanceof ItemDirectory) ) return;
  if ( !game.items ) return;
  for ( const item of game.items ) {
    if ( !(item.name === "Terrains" || item.getFlag(MODULE_ID, FLAGS.UNIQUE_EFFECT.ID)) ) continue;
    const li = dir.element.find(`li[data-document-id="${item.id}"]`);
    li.remove();
  }
}

/**
 * Hooks for changeSidebarTab and renderItemDirectory to remove the terrains item from the directory.
 */
function removeTerrainItemHook(directory) {
  removeTerrainsItemFromSidebar(directory);
}

PATCHES_SidebarTab.BASIC.HOOKS = { changeSidebarTab: removeTerrainItemHook };
PATCHES_ItemDirectory.BASIC.HOOKS = { renderItemDirectory: removeTerrainItemHook };


export class Settings extends ModuleSettingsAbstract {

  /**
   * Keys for all the settings used in this module.
   * @type {object}
   */
  static KEYS = {
    // Configuration of the application that controls the terrain listings.
    CONTROL_APP: {
      FAVORITES: "favorites", // Array of favorite terrains, by effect id.
      EXPANDED_FOLDERS: "app_expanded_folders"
    },

    UNIQUE_EFFECTS_FLAGS_DATA: "uniqueEffectsFlagsData",

    // Dialog with announcements re major updates.
    CHANGELOG: "changelog"
  };

  /**
   * Register all settings
   */
  static registerAll() {
    const KEYS = this.KEYS;
    const localize = key => game.i18n.localize(`${MODULE_ID}.settings.${key}`);

    // ----- NOTE: Hidden settings ----- //
    this.register(KEYS.UNIQUE_EFFECTS_FLAGS_DATA, {
      scope: "world",
      config: false,
      default: {}
    });

    this.register(KEYS.CONTROL_APP.FAVORITES, {
      name: "Favorites",
      scope: "client",
      config: false,
      default: [],
      type: Array
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
   * Retrieve the item before game.items or settings are set up.
   */
  static get terrainEffectsDataItem() {
    const id = this._getStorageValue(this.KEYS.TERRAINS_ITEM);
    return game.data.items.find(item => item._id === id);
  }

  static get terrainEffectsItem() {
    if ( !game.items ) return this.terrainEffectsDataItem;
    return game.items.get(this.get(this.KEYS.TERRAINS_ITEM));
  }

  /** @type {string[]} */
  static get expandedFolders() { return this.get(this.KEYS.CONTROL_APP.EXPANDED_FOLDERS); }

  /**
   * Add a given folder id to the saved expanded folders.
   * @param {string} folderId
   * @returns {Promise} A promise that resolves when the setting update completes.
   */
  static async addExpandedFolder(folderId) {
    let folderArr = this.expandedFolders;
    folderArr.push(folderId);
    folderArr = [...new Set(folderArr)]; // Remove duplicates.
    this.set(this.KEYS.CONTROL_APP.EXPANDED_FOLDERS, folderArr);
  }

  /**
   * Remove a given folder name from the expanded folders array.
   * @param {string} id   Id of the folder to remove from the saved expanded folders list.
   * @returns {Promise} A promise that resolves when the setting update completes.
   */
  static async removeExpandedFolder(id) {
    const expandedFolderArray = this.expandedFolders.filter(expandedFolder => expandedFolder !== id);
    return this.set(this.KEYS.CONTROL_APP.EXPANDED_FOLDERS, expandedFolderArray);
  }

  /**
   * Remove all saved expanded folders.
   * @returns {Promise} Promise that resolves when the settings update complete.
   */
  static async clearExpandedFolders() { this.set(this.KEYS.CONTROL_APP.EXPANDED_FOLDERS, []); }

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
    const favorites = new Set(this.get(this.KEYS.CONTROL_APP.FAVORITES));
    return favorites.has(id);
  }

  /**
   * Add effect id to favorites.
   * @param {string} id     Active effect id
   */
  static async addToFavorites(id) {
    const key = this.KEYS.CONTROL_APP.FAVORITES;
    const favorites = new Set(this.get(key));
    favorites.add(id); // Avoids duplicates.
    await this.set(key, [...favorites]);
  }

  /**
   * Remove effect id from favorites.
   * @param {string} id
   */
  static async removeFromFavorites(id) {
    const key = this.KEYS.CONTROL_APP.FAVORITES;
    const favorites = new Set(this.get(key));
    favorites.delete(id); // Avoids duplicates.
    await this.set(key, [...favorites]);
  }

}
