/* globals
game
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { AbstractUniqueEffect } from "./AbstractUniqueEffect.js";
import {
  createDocument,
  updateDocument,
  deleteDocument,
  createEmbeddedDocuments,
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
    data.origin = this.document.id;
    return data;
  }



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
  static async _removeFromToken(token, effects) {
    if ( !token.actor ) return false;
    const ids = effects.map(doc => doc.id);
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
    if ( !token.actor ) return false;
    const ids = effects.map(doc => doc.id);
    if ( !ids.length ) return false;
    for ( const id of ids ) token.actor.effects.delete(id);
    return true;
  }

  // ----- NOTE: Static document handling ----- //

  /**
   * Create an effect document from scratch.
   * @returns {Document|object}
   */
  async _createNewDocument(uniqueEffectId) {
    const data = await this.constructor.newDocumentData(uniqueEffectId);
    return createDocument("CONFIG.Item.documentClass", undefined, data);
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

  // ----- NOTE: Static multiple document handling ---- //

  /**
   * Initialize item used to store active effects.
   * Once created, it will be stored in the world and becomes the method by which cover effects
   * are saved.
   */
  static async _initializeStorageMap() { return game.items; }
}

// ----- NOTE: Helper functions ----- //

