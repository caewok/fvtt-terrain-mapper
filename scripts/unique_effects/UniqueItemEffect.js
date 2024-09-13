/* globals
CONFIG,
foundry,
fromUuid,
game
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID, FLAGS } from "../const.js";
import { AbstractUniqueEffect } from "./AbstractUniqueEffect.js";
import {
  createDocument,
  updateDocument,
  deleteDocument,
  createEmbeddedDocuments,
  deleteEmbeddedDocuments } from "./documents.js";

/**
 * Represent a unique effect that is applied to tokens. E.g., cover, terrain.
 * Applied via active effects on the token actor.
 */
export class UniqueItemEffect extends AbstractUniqueEffect {
  // Alias
  /** @type {ActiveEffect} */
  get item() { return this.document; }

  // ----- NOTE: Document-related methods ----- //

  /**
   * Data used when dragging an effect to an actor sheet.
   */
  toDragData() {
    const data = super.toDragData();
    data.type = "Item";
    return data;
  }

  // ----- NOTE: Static token-related methods ----- //

  /**
   * The token storage for this class
   * @param {Token} token
   * @returns {DocumentCollection|Map} The collection for this token
   */
  static getTokenStorage(token) { return token.actor?.items; }

  /**
   * Method implemented by child class to add 1+ effects to the token.
   * Does not consider whether the effect is already present.
   * @param {Token } token      Token to remove the effect from.
   * @param {AbstractUniqueEffect[]} effects   Effects to add; effects already on token may be duplicated
   * @returns {boolean} True if change was made
   */
  static async _addToToken(token, effects) {
    if ( !token.actor ) return false;
    const uuids = effects.map(e => e.document.uuid);
    await createEmbeddedDocuments(token.actor.uuid, "Item", uuids);
    return true;
  }

  /**
   * Method implemented by child class to add 1+ effects to token locally.
   * @param {Token } token      Token to add the effect(s) to.
   * @param {AbstractUniqueEffect[]} effects   Effects to add; effects already on token may be duplicated
   * @returns {boolean} True if change was made
   */
  static _addToTokenLocally(token, effects) {
    if ( !token.actor ) return false;
    for ( const effect of effects ) {
      const doc = effect.document.toObject();
      doc.flags[MODULE_ID][FLAGS.UNIQUE_EFFECT.IS_LOCAL] = true;

      effect.document._id = foundry.utils.randomID(); // So duplicate effects can be added.
      const ae = token.actor.items.createDocument(effect.document);
      token.actor.items.set(ae.id, ae);
    }
    return true;
  }

  /**
   * Method implemented by child class to add to token.
   * If duplicates, only the first effect present will be removed
   * @param {Token } token      Token to remove the effect from.
   * @param {AbstractUniqueEffect[]} effects
   * @param {boolean} [removeAll=false] If true, remove all effects that match, not just the first
   * @returns {boolean} True if change was made
   */
  static async _removeFromToken(token, effects, removeAllDuplicates = true) {
    if ( !token.actor ) return false;
    const ids = this.tokenDocumentsForUniqueEffects(token, effects, removeAllDuplicates).map(doc => doc.id);
    if ( !ids.length ) return false;
    await deleteEmbeddedDocuments(token.actor.uuid, "Item", ids);
    return true;
  }

  /**
   * Method implemented by child class to add to token.
   * @param {Token } token      Token to remove the effect from.
   * @param {AbstractUniqueEffect[]} effects
   * @param {boolean} [removeAll=false] If true, remove all effects that match, not just the first
   * @returns {boolean} True if change was made
   */
  static _removeFromTokenLocally(token, effects, removeAllDuplicates = true) {
    if ( !token.actor ) return false;
    const ids = this.tokenDocumentsForUniqueEffects(token, effects, removeAllDuplicates).map(doc => doc.id);
    if ( !ids.length ) return false;
    for ( const id of ids ) token.actor.items.delete(id);
    return true;
  }

  // ----- NOTE: Static document handling ----- //

  /**
   * Default data required to be present in the base effect document.
   * @param {string} [activeEffectId]   The id to use
   * @returns {object}
   */
  static newDocumentData(activeEffectId) {
    const data = AbstractUniqueEffect.newDocumentData.call(this, activeEffectId);
    data.name = "UniqueItemEffect";
    data.img = "icons/svg/ruins.svg";
    data.type = "base";
    return data;
  }

  /**
   * Process drop of item data to the effect book.
   */
  static async _processEffectDrop(data) {
    const newData = this.newDocumentData();
    if ( data.type !== "Item" || data.itemType !== newData.type ) return;

    // For safety, let's duplicate the item and then create the UniqueItemEffect instance.
    const item = await fromUuid(data.uuid);
    if ( !item ) return;
    const itemData = item.toObject();
    delete newData.name;
    delete newData.img;
    foundry.utils.mergeObject(itemData, newData);
    await this._createNewDocument(itemData);
    await this.create(newData.flags[MODULE_ID][FLAGS.UNIQUE_EFFECT.ID]);
  }

  /** @type {Document[]} */
  static get storageDocuments() {
    // Only those items that have the module flag.
    return [...this._storageMap.values()].filter(doc => Boolean(doc.flags?.[MODULE_ID]));
  }

  /**
   * Create an effect document from scratch.
   * @param {object} data   Data to use to construct the document
   * @returns {Document|object}
   */
  static async _createNewDocument(data) {
    const uuid = await createDocument("CONFIG.Item.documentClass", undefined, data);
    return await fromUuid(uuid);
  }

  /**
   * Update the document for this effect.
   * Typically when importing from JSON.
   * @param {object[]} [data]    Data used to update the document
   */
  async updateDocument(data) {
    return updateDocument(this.document.uuid, data);
  }

  /**
   * Delete the underlying stored document.
   */
  async _deleteDocument() {
    return deleteDocument(this.document.uuid);
  }

  /**
   * Search documents for all stored effects.
   * Child class may also include default effects not yet created.
   * This should not require anything to be loaded, so it can be run at canvas.init.
   * @returns {Object<string, string>} Effect id keyed to effect name
   */
  static _mapStoredEffectNames() {
    const map = {};
    const items = game.items ?? game.data.items;
    items.forEach(item => {
      const id = item.flags?.[MODULE_ID]?.[FLAGS.UNIQUE_EFFECT.ID];
      if ( id ) map[id] = item.name;
    });

    // Currently no default names, otherwise those would be valid as well.
    return map;
  }

  // ----- NOTE: Static multiple document handling ---- //

  /**
   * Initialize item used to store active effects.
   * Once created, it will be stored in the world and becomes the method by which cover effects
   * are saved.
   */
  static async _initializeStorageMap() { this._storageMap = game.items; }

  /**
   * Initialize default effects by adding the document(s) to the storage map.
   */
  static async _initializeDefaultEffects() {
    const defaultCompendiumIds = CONFIG[MODULE_ID].defaultCoverJSONs;
    if ( !defaultCompendiumIds ) return;
    const defaultMap = await this.loadDefaultCompendiumItems(defaultCompendiumIds);
    const promises = [];
    defaultMap.forEach(data => {
      data.name = game.i18n.localize(data.name);
      promises.push(this._createNewDocument(data));
    });
    await Promise.allSettled(promises);
  }

  /**
   * Reset default effects by removing the existing ids and re-adding.
   */
  static async _resetDefaultEffects() {
    const defaultCompendiumIds = CONFIG[MODULE_ID].defaultCoverJSONs;
    if ( !defaultCompendiumIds ) return;
    const defaultMap = await this.loadDefaultCompendiumItems(defaultCompendiumIds);

    // Delete existing.
    for ( const key of defaultMap.keys() ) {
      const effect = this._instances.get(key);
      if ( !effect ) continue;
      await effect._deleteDocument();
    }

    const promises = [];
    defaultMap.forEach(data => {
      data.name = game.i18n.localize(data.name);
      promises.push(this._createNewDocument(data));
    });
    await Promise.allSettled(promises);

    // Re-create the effects as necessary.
    for ( const key of defaultMap.keys() ) { await this.create(key); }
  }
}

// ----- NOTE: Helper functions ----- //

