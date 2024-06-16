/* globals
CONST,
foundry,
game

*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { AbstractUniqueEffect } from "./AbstractUniqueEffect.js";
import {
  createDocument,
  createEmbeddedDocuments,
  updateEmbeddedDocuments,
  deleteEmbeddedDocuments } from "./sockets.js";


/**
 * Represent a unique effect that is applied to tokens. E.g., cover, terrain.
 * Applied via active effects on the token actor.
 */
export class UniqueActiveEffect extends AbstractUniqueEffect {
  // Alias
  /** @type {ActiveEffect} */
  get activeEffect() { return this.document; }

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
   * Data used when dragging an effect to an actor sheet.
   */
  get dragData() {
    const data = super.dragData;
    data.type = "ActiveEffect";
    return data;
  }

  // ----- NOTE: Token-related methods ----- //

  /**
   * The token storage for this class
   * @param {Token} token
   * @returns {DocumentCollection|Map} The collection for this token
   */
  static getTokenStorage(token) { return token.actor?.effects; }

  /**
   * Method implemented by child class to add 1+ effects to the token.
   * Does not consider whether the effect is already present.
   * @param {Token } token      Token to remove the effect from.
   * @param {AbstractUniqueEffect[]} effects   Effects to add; effects already on token may be duplicated
   * @returns {boolean} True if change was made
   */
  static async _addToToken(token, effects) {
    if ( !token.actor ) return false;
    await createEmbeddedDocuments(token.actor.uuid, "ActiveEffect", effects.map(e => e.effectData));
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
    const ids = this._allUniqueEffectDocumentsOnToken(token).map(doc => doc.id);
    if ( !ids.length ) return false;
    await deleteEmbeddedDocuments(token.actor.uuid, "ActiveEffect", ids);
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
    const ids = this._allUniqueEffectDocumentsOnToken(token).map(doc => doc.id);
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
    data.origin = this._storageMap.model.id;
    data.transfer = false;
    return data;
  }

  /**
   * Create an effect document from scratch.
   * @returns {Document|object}
   */
  async _createNewDocument(uniqueEffectId) {
    const data = await this.constructor.dataForId(uniqueEffectId);
    return createEmbeddedDocuments(this.constructor._storageMap.model.uuid, "ActiveEffect", [data])[0];
  }

  /**
   * Update the document for this effect.
   * Typically when importing from JSON.
   * @param {object[]} [data]    Data used to update the document
   */
  async updateDocument(data) {
    data._id = this.document.id;
    return updateEmbeddedDocuments(this.constructor._storageMap.model.uuid, "ActiveEffect", [data]);
  }

  /**
   * Delete the underlying stored document.
   */
  async _deleteDocument() {
    return deleteEmbeddedDocuments(this.constructor._storageMap.model.uuid, "ActiveEffect", [this.document.id]);
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
    const item = game.items.find(item => item.name === data.name)
      ?? (await createDocument("CONFIG.Item.documentClass", data));
    return item.effects;
  }

  // ----- NOTE: Static default data handling ----- //


  // ----- NOTE: Other methods specific to AEs ----- //


  /**
   * Apply this ActiveEffect to a provided Actor temporarily.
   * Same as ActiveEffect.prototype.apply but does not change the actor.
   * @param {Actor} actor                   The Actor to whom this effect should be applied
   * @param {EffectChangeData} change       The change data being applied
   */
  applyEffectTemporarily(actor, change) {
    const ae = this.activeEffect;
    // Determine the data type of the target field
    const current = foundry.utils.getProperty(actor, change.key) ?? null;
    let target = current;
    if ( current === null ) {
      const model = game.model.Actor[actor.type] || {};
      target = foundry.utils.getProperty(model, change.key) ?? null;
    }
    let targetType = foundry.utils.getType(target);

    // Cast the effect change value to the correct type
    let delta;
    try {
      if ( targetType === "Array" ) {
        const innerType = target.length ? foundry.utils.getType(target[0]) : "string";
        delta = ae._castArray(change.value, innerType);
      }
      else delta = ae._castDelta(change.value, targetType);
    } catch(_err) { // eslint-disable-line no-unused-vars
      console.warn(`Actor [${actor.id}] | Unable to parse active effect change for ${change.key}: "${change.value}"`);
      return;
    }

    // Apply the change depending on the application mode
    const modes = CONST.ACTIVE_EFFECT_MODES;
    const changes = {};
    switch ( change.mode ) {
      case modes.ADD:
        ae._applyAdd(actor, change, current, delta, changes);
        break;
      case modes.MULTIPLY:
        ae._applyMultiply(actor, change, current, delta, changes);
        break;
      case modes.OVERRIDE:
        ae._applyOverride(actor, change, current, delta, changes);
        break;
      case modes.UPGRADE:
      case modes.DOWNGRADE:
        ae._applyUpgrade(actor, change, current, delta, changes);
        break;
      default:
        ae._applyCustom(actor, change, current, delta, changes);
        break;
    }
    return changes;
  }
}

// ----- NOTE: Helper functions ----- //

