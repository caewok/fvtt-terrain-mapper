/* globals
CONFIG,
foundry,
fromUuid,
game,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { ICONS, MODULE_ID, FLAGS } from "./const.js";
import { loadDefaultTerrainJSONs } from "./default_terrains.js";
import { createDocument } from "./unique_effects/documents.js";

/**
 * A mixin which extends the UniqueEffect with specialized terrain behaviors
 * @category - Mixins
 * @param {AbstractUniqueEffect} Base         The base class mixed with terrain features
 * @returns {Terrain}                         The mixed Terrain class definition
 */
export function TerrainMixin(Base) {
  return class Terrain extends Base {
    /**
     * Initialize an item to store flags related to terrains and the Terrain Book.
     * May be the same item used to store active effect terrains.
     */
    static async _initializeStorageMap() {
      await super._initializeStorageMap();
      await this._initializeFlagStorage();
    }

    static _flagStorageDocument;

    static async _initializeFlagStorage() {
      if ( this._storageMap.model instanceof foundry.documents.Item ) this._flagStorageDocument = this._storageMap.model;
      else {
        const data = {
          name: "Unique Active Effects",
          img: "icons/svg/ruins.svg",
          type: "base",
        };
        let item = game.items.find(item => item.name === data.name);
        if ( !item ) {
          const uuid = await createDocument("CONFIG.Item.documentClass", undefined, data);
          if ( uuid ) item = await fromUuid(uuid);
        }
        this._flagStorageDocument = item;
      }
    }

    // ----- NOTE: Folder management ----- //

    static _folders = new Map();

    static get folders() {
      const folderArray = this._flagStorageDocument.getFlag(MODULE_ID, FLAGS.TERRAIN_BOOK.FOLDERS) || [];
      this._folders.clear();
      folderArray.forEach(folder => this._folders.set(folder.id, folder));
      return this._folders;
    }

    static async setFolders(value) {
      if ( value instanceof Map ) value = [...value.values()];
      await this._flagStorageDocument.setFlag(MODULE_ID, FLAGS.TERRAIN_BOOK.FOLDERS, value);
    }

    static async _saveFolders() {
      return this._flagStorageDocument.setFlag(MODULE_ID, FLAGS.TERRAIN_BOOK.FOLDERS, [...this._folders.values()]);
    }

    static getFolderById(id) { return this.folders.get(id); }

    /**
     * Add a folder if not yet present. Update otherwise.
     */
    static async addFolder(data = {}) {
      data.id ??= foundry.utils.randomID();
      const folders = this.folders;
      if ( folders.has(data.id) ) {
        const folder = folders.get(data.id);
        if ( data.effects ) folder.effects = [...(new Set(folder.effects)).union(new Set(data.effects ?? []))]; // Combine the effects set.
        delete data.effects;
        foundry.utils.mergeObject(folders.get(data.id), data);
      }
      else {
        data.name ??= game.i18n.localize("FOLDER.ExportNewFolder");
        data.color ??= "black";
        data.effects ??= [];
        folders.set(data.id, data);
      }
      return this._saveFolders();
    }

    static async deleteFolder(id) {
      const folders = this.folders;
      folders.delete(id);
      return this._saveFolders();
    }

    static async addEffectToFolder(folderId, effectId) {
      const folders = this.folders;
      if ( !folders.has(folderId) ) this.addFolder({ id: folderId });
      const folder = folders.get(folderId);
      if ( folder.effects.includes(effectId) ) return;
      folder.effects.push(effectId);
      return this._saveFolders();
    }

    static async removeEffectFromFolder(folderId, effectId) {
      const folders = this.folders;
      if ( !folders.has(folderId) ) return;
      const folder = folders.get(folderId);
      const idx = folder.effects.findIndex(effectId);
      if ( !~idx ) return;
      folder.effects.splice(idx, 1);
      return this._saveFolders;
    }

    static async removeEffectFromAllFolders(effectId) {
      const folders = this.folders;
      let needsSave = false;
      for ( const folder of folders.values() ) {
        const idx = folder.effects.findIndex(effectId);
        if ( !~idx ) continue;
        folder.effects.splice(idx, 1);
        needsSave ||= true;
      }
      if ( needsSave ) await this._saveFolders;
    }

    static findFoldersForEffect(effectId) {
      const out = new Set();
      this.folders.forEach(folder => {
        if ( folder.effects.include(effectId) ) out.add(folder);
      });
      return out;
    }


    /**
     * Alias
     * Test if a token has this terrain already.
     * @param {Token} token
     * @returns {boolean}
     */
    tokenHasTerrain(token) { return this.isOnToken(token); }

    /** @type {string} */
    static type = "Terrain";

    /** @type {object} */
    static get _storageMapData() {
      return {
        name: "Terrains",
        img: ICONS.MODULE,
        type: "base",
      };
    }

    /**
     * Default data required to be present in the base effect document.
     * @param {string} [activeEffectId]   The id to use
     * @returns {object}
     */
    static newDocumentData(activeEffectId) {
      const data = Base.newDocumentData.call(this, activeEffectId);
      data.name = game.i18n.localize(`${MODULE_ID}.phrases.new-terrain`);
      data.img = "icons/svg/hazard.svg";
      return data;
    }

    /**
     * Initialize default effects by adding the document(s) to the storage map.
     */
    static async _initializeDefaultEffects() {
      if ( !CONFIG[MODULE_ID].defaultTerrainJSONs.length ) return;
      const defaultMap = await loadDefaultTerrainJSONs(CONFIG[MODULE_ID].defaultTerrainJSONs);
      const promises = [];
      defaultMap.forEach(data => {
        data.name = game.i18n.localize(data.name);
        promises.push(this._createNewDocument(data));
      });
      await Promise.allSettled(promises);

      // Re-create the terrains as necessary.
      for ( const key of defaultMap.keys() ) { await CONFIG[MODULE_ID].Terrain.create(key); }

      // Add a default terrain folder to the Terrain Book.
      await this.addFolder({
        name: game.i18n.localize(`${MODULE_ID}.terrainbook.default-terrain-folder`),
        id: `${MODULE_ID}.defaults`,
        effects: [...defaultMap.keys()],
      });
    }

    /**
     * Reset default effects by removing the existing ids and re-adding.
     */
    static async _resetDefaultEffects() {
      if ( !CONFIG[MODULE_ID].defaultTerrainJSONs.length ) return;
      const defaultMap = await loadDefaultTerrainJSONs(CONFIG[MODULE_ID].defaultTerrainJSONs);

      // Delete existing.
      for ( const key of defaultMap.keys() ) {
        const terrain = this._instances.get(key);
        if ( !terrain ) continue;
        await terrain._deleteDocument();
      }

      // Recreate the default effects.
      await this._initializeDefaultEffects();
    }

    /**
     * Remove this terrain from any folders.
     */
    async destroy() {
      await this.constructor.removeEffectFromAllFolders(this.uniqueEffectId);
      return super.destroy();
    }
  };
}
