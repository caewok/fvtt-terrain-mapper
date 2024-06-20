/* globals
foundry
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID, FLAGS } from "../const.js";
import { Settings } from "../settings.js";
import { AbstractUniqueEffect } from "./AbstractUniqueEffect.js";

/**
 * Represent a unique effect that is applied to tokens. E.g., cover, terrain.
 * Applied via active effects on the token actor.
 */
export class UniqueFlagEffect extends AbstractUniqueEffect {

  // ----- NOTE: Document-related methods ----- //
  toDragData() {
    console.error("UniqueFlagEffect|toDragData not yet implemented.");
    return super.toDragData();
  }

  // ----- NOTE: Token-related methods ----- //

  /**
   * The token storage for this class
   * @param {Token} token
   * @returns {DocumentCollection|Map} The collection for this token
   */
  static getTokenStorage(token) {
    // Tokens do not have a map of effect docs, so this is effectively a map of flag documents "on" the token.
    return FlagDocument.allDocumentsOnToken(token);
  }


  /**
   * Method implemented by child class to add 1+ effects to the token.
   * Does not consider whether the effect is already present.
   * @param {Token } token      Token to remove the effect from.
   * @param {AbstractUniqueEffect[]} effects   Effects to add; effects already on token may be duplicated
   * @returns {boolean} True if change was made
   */
  static async _addToToken(token, effects) {
    const promises = [];
    for ( const effect of effects ) promises.push(effect.document.addToToken(token));
    await Promise.allSettled(promises);
    return true;
  }

  /**
   * Method implemented by child class to add 1+ effects to token locally.
   * @param {Token } token      Token to add the effect(s) to.
   * @param {AbstractUniqueEffect[]} effects   Effects to add; effects already on token may be duplicated
   * @returns {boolean} True if change was made
   */
  static _addToTokenLocally(token, effects) {
    for ( const effect of effects ) effect.document.addToTokenLocally(token);
    return true;
  }

  /**
   * Method implemented by child class to remove from token.
   * If duplicates, only the first effect present will be removed
   * @param {Token } token      Token to remove the effect from.
   * @param {AbstractUniqueEffect[]} effects
   * @param {boolean} [removeAll=false] If true, remove all effects that match, not just the first
   * @returns {boolean} True if change was made
   */
  static async _removeFromToken(token, effects, removeAllDuplicates = true) {
    const effectsSet = new Set([...effects]);
    const promises = [];
    for ( const effect of effects ) {
      promises.push(effect.document.removeFromToken(token));
      if ( !removeAllDuplicates ) effectsSet.delete(effect);
    }
    await Promise.allSettled(promises);
    return true;
  }

  /**
   * Method implemented by child class to remove from token.
   * @param {Token } token      Token to remove the effect from.
   * @param {AbstractUniqueEffect[]} effects
   * @param {boolean} [removeAll=false] If true, remove all effects that match, not just the first
   * @returns {boolean} True if change was made
   */
  static _removeFromTokenLocally(token, effects, removeAllDuplicates = true) {
    const effectsSet = new Set([...effects]);
    for ( const effect of effects ) {
      effect.document.removeFromTokenLocally(token);
      if ( !removeAllDuplicates ) effectsSet.delete(effect);
    }
    return true;
  }

  // ----- NOTE: Static document handling ----- //

  /**
   * Create an effect document from scratch.
   * @param {object} data   Data to use to construct the document
   * @returns {Document|object}
   */
  static async _createNewDocument(data) {
    data.id = data.flags[MODULE_ID][FLAGS.UNIQUE_EFFECT.ID];
    return FlagDocument.create([ data ])[0];
  }

  /**
   * Update the document for this effect.
   * Typically when importing from JSON.
   * @param {object[]} [data]    Data used to update the document
   */
  async updateDocument(data) {
    data.id = this.document.id;
    return this.document.update([data]);
  }

  /**
   * Delete the underlying stored document.
   */
  async _deleteDocument() { return this.document.delete([this.document.id]); }

  // ----- NOTE: Static multiple document handling ---- //


  /**
   * Initialize item used to store active effects.
   * Once created, it will be stored in the world and becomes the method by which cover effects
   * are saved.
   */
  static async _initializeStorageMap() {
    this._storageMap = FlagDocument.allDocuments;
  }
}

/**
 * Basic document representation for setting values using only flags.
 * Stored to a settings key
 */
class FlagDocument {

  /** @type {object} */
  id = "";

  constructor(id) {
    this.id = id;
    this.constructor.allDocuments.set(id, this);
  }


  /**
   * Update this document.
   */
  async update(data) {
    data.id = this.id;
    return this.constructor.update([data]);
  }

  /**
   * Delete this document.
   */
  async delete() { return this.constructor.delete([this.id]); }

  /**
   * Mimics the Foundry Document#getFlag method.
   * @param {string} scope    Module id
   * @param {string} key      Which flag to return
   * @returns {*}
   */
  getFlag(scope, key) {
    const settingsData = Settings.get(this.constructor.settingsKey);
    const doc = settingsData[this.id];
    return doc?.flags[scope]?.[key];
  }

  /**
   * Mimics the Foundry Document#getFlag method.
   * @param {string} scope    Module id
   * @param {string} key      Which flag to return
   * @returns {*}
   */
  async setFlag(scope, key, value) {
    const settingsData = Settings.get(this.constructor.settingsKey);
    const doc = settingsData[this.id] ??= {};
    doc[scope] ??= {};
    doc[scope][key] = value;
    return Settings.set(this.constructor.settingsKey, settingsData);
  }

  async unsetFlag(scope, key) {
    const settingsData = Settings.get(this.constructor.settingsKey);
    const doc = settingsData[this.id] ??= {};
    doc[scope] ??= {};
    delete doc[scope][key];
    return Settings.set(this.constructor.settingsKey, settingsData);
  }

  /**
   * Get all flag data for adding to token.
   * @type {object}
   */
  get _allFlagData() {
    const settingsData = Settings.get(this.constructor.settingsKey);
    return settingsData[this.id].flags;
  }

  /**
   * Add this to a token.
   * @param {Token} token
   */
  async addToToken(token) {
    return token.document.setFlag(MODULE_ID, this.id, this._allFlagData);
  }

  /**
   * Add this to a token locally.
   * @param {Token} token
   */
  addToTokenLocally(token) {
    return token.document.updateSource({
      flags: {
        [MODULE_ID]: {
          [this.id]: this._allFlagData,
          [FLAGS.UNIQUE_EFFECT.IS_LOCAL]: true
        }
      }
    });
  }

  /**
   * Remove this from a token.
   * @param {Token} token
   */
  async removeFromToken(token) { token.document.unsetFlag(MODULE_ID, this.id); }

  /**
   * Remove this from a token locally.
   * @param {Token} token
   */
  removeFromTokenLocally(token) {
    const flags = token.document.flags[MODULE_ID];
    if ( !flags ) return;
    delete flags[this.id];
  }

  /** @type {string} */
  static get settingsKey() { return Settings.KEYS.UNIQUE_EFFECTS_FLAGS_DATA; }

  /** @type {Map<id, FlagDocument>} */
  static #allDocuments;

  static get allDocuments() {
    if ( !this.#allDocuments ) {
      // Retrieve all documents from settings and initialize.
      this.#allDocuments = new Map();
      for ( const [key, value] of Object.entries(Settings.get(this.settingsKey)) ) this.#allDocuments.set(key, new this(key));
    }
    return this.#allDocuments;
  }

  /**
   * All flag documents on the token.document.
   * @param {Token} token
   * @returns {Map<id, FlagDocument>}
   */
  static allDocumentsOnToken(token) {
    const m = new Map();
    const flags = token.document.flags?.[MODULE_ID];
    if ( !flags ) return m;
    const allDocs = this.allDocuments;
    for ( const id of allDocs.keys() ) {
      if ( Object.hasOwn(flags, id) ) m.set(id, allDocs.get(id));
    }
    return m;
  }

  /**
   * Create document(s) in the settings.
   * @param {object[]} data     Each must have an id, optional flag property with data
   * @returns {FlagDocument}
   */
  static async create(data) {
    const settingsData = Settings.get(this.settingsKey) ?? {};
    const docs = [];
    for ( const datum of data ) {
      if ( !datum.id ) continue;
      settingsData[datum.id] ??= {};
      foundry.utils.mergeObject(settingsData[datum.id], datum);
      docs.push(new this(datum.id));
    }
    await Settings.set(this.settingsKey, settingsData);
    return docs;
  }

  /**
   * Update document in settings.
   */
  static async update(data) {
    const settingsData = Settings.get(this.settingKey);
    const docs = [];
    for ( const datum of data ) {
      if ( !datum.id ) continue;
      if ( !settingsData[datum.id] ) continue;
      foundry.utils.mergeObject(settingsData[datum.id], datum);
      docs.push(new this(datum.id));
    }
    await Settings.set(this.settingsKey, settingsData);
    return docs;
  }

  /**
   * Delete document(s) from settings.
   */
  static async delete(ids) {
    const settingsData = Settings.get(this.settingKey);
    for ( const id of ids ) {
      delete settingsData[id];
      this.allDocuments.delete(id);
    }
    await Settings.set(this.settingsKey, settingsData);
  }
}
