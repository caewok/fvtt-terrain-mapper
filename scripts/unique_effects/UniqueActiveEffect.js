/* globals
CONFIG,
CONST,
foundry,
fromUuid,
game
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { AbstractUniqueEffect } from "./AbstractUniqueEffect.js";
import {
  createDocument,
  createEmbeddedDocuments,
  updateEmbeddedDocuments,
  deleteEmbeddedDocuments } from "./documents.js";
import { log } from "../util.js";
import { MODULE_ID, FLAGS } from "../const.js";

/**
 * Represent a unique effect that is applied to tokens. E.g., cover, terrain.
 * Applied via active effects on the token actor.
 */
export class UniqueActiveEffect extends AbstractUniqueEffect {
  // Alias
  /** @type {ActiveEffect} */
  get activeEffect() { return this.document; }

  // ----- NOTE: Token-related methods ----- //

  /**
   * The token storage for this class
   * @param {Token} token
   * @returns {DocumentCollection|Map} The collection for this token
   */
  static getTokenStorage(token) { return token.actor?.effects; }

  /**
   * Data to construct an effect.
   * @type {object}
   */
  get effectData() {
    const data = super.effectData;
    data.origin = this.constructor._storageMap.model.id;
    if ( this.img ) data.statuses = [this.img]; // Force display of the terrain status
    return data;
  }

  /**
   * Method implemented by child class to add 1+ effects to the token.
   * Does not consider whether the effect is already present.
   * @param {Token } token      Token to remove the effect from.
   * @param {AbstractUniqueEffect[]} effects   Effects to add; effects already on token may be duplicated
   * @returns {boolean} True if change was made
   */
  static async _addToToken(token, effects, data = {}) {
    if ( !token.actor ) return false;
    const uuids = effects.map(e => e.document.uuid);

    let dataArray;
    if ( token.document.disposition !== CONST.TOKEN_DISPOSITIONS.SECRET ) {
      // Force display of the status icon
      dataArray = effects.map(e => {
        const datum = { ...data };
        datum.statuses ??= [];
        if ( e.img && e.displayStatusIcon ) datum.statuses.push(e.img);
        return datum;
      });
    } else if ( !foundry.utils.isEmpty(data) ) dataArray = effects.map(e => data);
    await createEmbeddedDocuments(token.actor.uuid, "ActiveEffect", uuids, dataArray);
    return true;
  }

  /**
   * Method implemented by child class to add 1+ effects to token locally.
   * @param {Token } token      Token to add the effect(s) to.
   * @param {AbstractUniqueEffect[]} effects   Effects to add; effects already on token may be duplicated
   * @returns {boolean} True if change was made
   */
  static _addToTokenLocally(token, effects, data = {}) {
    if ( !token.actor ) return false;

    for ( const effect of effects ) {
      const doc = effect.document.toObject();
      doc.flags[MODULE_ID][FLAGS.UNIQUE_EFFECT.IS_LOCAL] = true;
      foundry.utils.mergeObject(doc, data);
      // Force display of the status icon
      doc.statuses ??= [];
      if ( token.document.disposition !== CONST.TOKEN_DISPOSITIONS.SECRET
        && effect.img
        && effect.displayStatusIcon ) doc.statuses.push(effect.img);

      // Remove the _id b/c the property might be locked. See PR #44.
      // Have to define it manually b/c for local docs, foundry will not assign random id. See #46.
      delete doc._id;
      doc._id = foundry.utils.randomID();
      const ae = token.actor.effects.createDocument(doc);
      token.actor.effects.set(ae.id, ae);
    }
    return true;
  }

  /**
   * Method implemented by child class to remove from token.
   * If duplicates, only the first effect present will be removed
   * @param {Token } token      Token to remove the effect from.
   * @param {AbstractUniqueEffect[]} effects
   * @returns {boolean} True if change was made
   */
  static async _removeFromToken(token, effects, removeAllDuplicates = true, origin) {
    if ( !token.actor ) return false;
    let ids = this.tokenDocumentsForUniqueEffects(token, effects, removeAllDuplicates, origin).map(doc => doc.id);
    if ( !ids.length ) return false;
    await deleteEmbeddedDocuments(token.actor.uuid, "ActiveEffect", ids);
    return true;
  }

  /**
   * Method implemented by child class to remove from token.
   * @param {Token } token      Token to remove the effect from.
   * @param {AbstractUniqueEffect[]} effects
   * @returns {boolean} True if change was made
   */
  static _removeFromTokenLocally(token, effects, removeAllDuplicates = true, origin) {
    if ( !token.actor ) return false;
    const ids = this.tokenDocumentsForUniqueEffects(token, effects, removeAllDuplicates, origin).map(doc => doc.id);
    if ( !ids.length ) return false;
    for ( const id of ids ) token.actor.effects.delete(id);
    return true;
  }

  // ----- NOTE: Document-related methods ----- //

  /**
   * Process an attempt to add an effect to the effect book via drop.
   * @param {object} data     Data that was dropped
   */
  static async _processEffectDrop(data) {
    if ( !data.uuid ) return;
    const effect = await fromUuid(data.uuid);
    if ( !(effect instanceof ActiveEffect) ) return;
    const effectData = effect.toObject()
    const uniqueEffectId = effect.getFlag("dfreds-convenient-effects", "ceEffectId") ?? this.uniqueEffectId();
    // foundry.utils.setProperty(data, `flags.${MODULE_ID}.${FLAGS.UNIQUE_EFFECT.ID}`, uniqueEffectId);

    const obj = await this.create(uniqueEffectId);
    await obj.fromJSON(JSON.stringify(effectData));
  }

  /**
   * Data used when dragging an effect to an actor sheet or token.
   * @returns {object}
   */
  toDragData() {
    const data = super.toDragData();
    data.type = "ActiveEffect";
    return data;
  }

  /**
   * Create an effect document from scratch.
   * @param {object} data   Data to use to construct the document
   * @returns {Document|object}
   */
  static async _createNewDocument(data) {
    log("UniqueActiveEffect#_createNewDocument|Creating embedded document");

    const res = await createEmbeddedDocuments(this._storageMap.model.uuid, "ActiveEffect", undefined, [data]);
    log("UniqueActiveEffect#_createNewDocument|Finished creating embedded document");
    return await fromUuid(res[0]);
  }

  /**
   * Update the document for this effect.
   * Typically when importing from JSON.
   * @param {object[]} [data]    Data used to update the document
   */
  async updateDocument(data) {
    data._id = this.document.id;
    await updateEmbeddedDocuments(this.constructor._storageMap.model.uuid, "ActiveEffect", [data]);
    return true;
  }

  /**
   * Delete the underlying stored document.
   */
  async _deleteDocument() {
    await deleteEmbeddedDocuments(this.constructor._storageMap.model.uuid, "ActiveEffect", [this.document.id]);
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
    data.transfer = false;
    data.name = "UniqueActiveEffect";
    return data;
  }

  // ----- NOTE: Static multiple document handling ---- //

  /** @type {object} */
  static get _storageMapData() {
    return {
      name: "Unique Active Effects",
      img: "icons/svg/ruins.svg",
      type: "base",
    };
  }

  /**
   * Initialize item used to store active effects.
   * Once created, it will be stored in the world and becomes the method by which cover effects
   * are saved.
   * @returns {DocumentCollection|Map}
   */
  static async _initializeStorageMap() {
    const data = this._storageMapData;
    let item = game.items.find(item => item.name === data.name);
    if ( !item ) {
      const uuid = await createDocument("CONFIG.Item.documentClass", undefined, data);
      if ( uuid ) item = await fromUuid(uuid);
    }
    this._storageMap = item?.effects;
  }

  // ----- NOTE: Static default data handling ----- //

  /**
   * Search documents for all stored effects.
   * Child class may also include default effects not yet created.
   * This should not require anything to be loaded, so it can be run at canvas.init.
   * @returns {Object<string, string>} Effect id keyed to effect name
   */
  static _mapStoredEffectNames() {
    const map = {};
    const storageData = this._storageMapData;
    const items = game.items ?? game.data.items;
    const item = items.find(item => item.name === storageData.name);
    if ( !item ) return map;
    item.effects.forEach(effect => {
      const id = effect.flags?.[MODULE_ID]?.[FLAGS.UNIQUE_EFFECT.ID];
      if ( id ) map[id] = effect.name;
    });
    // Currently no default names, otherwise those would be valid as well.
    return map;
  }

  /**
   * Initialize default effects by adding the document(s) to the storage map.
   */
  static async _initializeDefaultEffects() {
    const defaultCoverJSONs = CONFIG[MODULE_ID].defaultCoverJSONs;
    if ( !defaultCoverJSONs ) return;
    const defaultMap = await this.loadDefaultJSONs(defaultCoverJSONs);
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
    const defaultCoverJSONs = CONFIG[MODULE_ID].defaultCoverJSONs;
    if ( !defaultCoverJSONs ) return;
    const defaultMap = await this.loadDefaultJSONs(defaultCoverJSONs);

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

