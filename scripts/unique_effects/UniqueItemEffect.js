/* globals
game
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { AbstractUniqueEffect } from "./AbstractUniqueEffect.js";
import {
  createEmbeddedDocuments,
  updateEmbeddedDocuments,
  deleteEmbeddedDocuments } from "./sockets.js";

/**
 * Represent a unique effect that is applied to tokens. E.g., cover, terrain.
 * Applied via active effects on the token actor.
 */
export class UniqueItemEffect extends AbstractUniqueEffect {
  // Alias
  /** @type {ActiveEffect} */
  get item() { return this.document; }

  /**
   * Data to construct an effect.
   * @type {object}
   */
  get effectData() {
    const data = super.effectData;
    data.origin = this._storageItem.id;
    return data;
  }

  /**
   * Data used when dragging an effect to an actor sheet.
   */
  get dragData() {
    const data = super.dragData;
    data.type = "Item";
    return data;
  }

  // ----- NOTE: Token-related methods ----- //

  /**
   * Method implemented by child class to add 1+ effects to the token.
   * Does not consider whether the effect is already present.
   * @param {Token } token      Token to remove the effect from.
   * @param {AbstractUniqueEffect[]} effects   Effects to add; effects already on token may be duplicated
   * @returns {boolean} True if change was made
   */
  static async _addToToken(token, effects) {
    if ( !token.actor ) return false;
    await createEmbeddedDocuments(token.actor.uuid, "Item", effects.map(e => e.effectData));
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
      const ae = token.actor.effects.createDocument(effect.localEffectData);
      token.actor.effects.set(ae.id, ae);
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
  static async _removeFromToken(token, effects, removeAll = false) {
    if ( !token.actor ) return false;
    const ids = this._tokenEffectIdsForUniqueEffects(token, effects, removeAll);
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
  static _removeFromTokenLocally(token, effects, removeAll = false) {
    const ids = this._tokenEffectIdsForUniqueEffects(token, effects, removeAll);
    if ( !ids.length ) return false;
    for ( const id of ids ) token.actor.effects.delete(id);
    return true;
  }

  // ----- NOTE: Static document handling ----- //

  /**
   * Data to construct a new effect
   */
  static get newEffectData() {
    const data = super.newEffectData;
    data.origin = this._storageItem.id;
    data.transfer = false;
    return data;
  }

  /**
   * Create an effect document from scratch.
   * @returns {Document|object}
   */
  async _createNewDocument(uniqueEffectId) {
    if ( !this._storageItem ) await this.initialize();
    const data = await this.dataForId(uniqueEffectId);
    return createEmbeddedDocuments(this._storageItem.uuid, "Item", [data]);
  }

  /**
   * Update the document for this effect.
   * Typically when importing from JSON.
   * @param {object[]} [data]    Data used to update the document
   */
  async updateDocument(data) {
    data._id = this.document.id;
    return updateEmbeddedDocuments(this._storageItem.uuid, "Item", [data]);
  }

  /**
   * Delete the underlying stored document.
   */
  async _deleteDocument() {
    return deleteEmbeddedDocuments(this._storageItem.uuid, "Item", [this.document.id]);
  }

  // ----- NOTE: Static multiple document handling ---- //

  /** @type {object} */
  static get _storageItemData() {
    return {
      name: "Unique Item Effects",
      img: "icons/svg/ruins.svg",
      type: "base",
    };
  }

  /**
   * Initialize item used to store active effects.
   * Once created, it will be stored in the world and becomes the method by which cover effects
   * are saved.
   */
  static async _initializeStorageItem() {
    if ( this._storageItem ) return;
    this._storageItem = game.items;
  }
}

// ----- NOTE: Helper functions ----- //

