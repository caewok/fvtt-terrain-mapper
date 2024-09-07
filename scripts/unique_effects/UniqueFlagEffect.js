/* globals
CONFIG,
CONST,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID, FLAGS } from "../const.js";
import { log } from "../util.js";
import { UniqueActiveEffect } from "./UniqueActiveEffect.js";

/**
 * Represent a unique effect that is applied to tokens. E.g., cover, terrain.
 * Applied via active effects on the token actor.
 * The base document is the active effect stored in the item, which governs the rules.
 * The token flag stores the id of the base document and any post-doc creation flags, such as the local flag.
 * To mimic the token.actor.effect map, a map is generated for the given ids.
 * The token document also handles displaying the icon on the token.
 */
export class UniqueFlagEffect extends UniqueActiveEffect {

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
    return TokenFlagUniqueEffectDocument.allDocumentsOnToken(token);
  }

  /**
   * Method implemented by child class to add 1+ effects to the token.
   * Does not consider whether the effect is already present.
   * @param {Token } token      Token to remove the effect from.
   * @param {AbstractUniqueEffect[]} effects   Effects to add; effects already on token may be duplicated
   * @returns {boolean} True if change was made
   */
  static async _addToToken(token, effects) {
    const docs = effects.map(effect => new TokenFlagUniqueEffectDocument(token, effect));
    const promises = [];
    for ( const doc of docs ) promises.push(doc.addToToken());
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
    const docs = effects.map(effect => new TokenFlagUniqueEffectDocument(token, effect));
    for ( const doc of docs ) doc.addToTokenLocally();
    return true;
  }

  /**
   * Method implemented by child class to remove from token.
   * If duplicates, only the first effect present will be removed
   * @param {Token } token      Token to remove the effect from.
   * @param {AbstractUniqueEffect[]} effects
   * @returns {boolean} True if change was made
   */
  static async _removeFromToken(token, effects) {
    const docs = effects.map(effect => new TokenFlagUniqueEffectDocument(token, effect));
    const promises = [];
    for ( const doc of docs ) promises.push(doc.removeFromToken());
    await Promise.allSettled(promises);
    return true;
  }

  /**
   * Method implemented by child class to remove from token.
   * @param {Token } token      Token to remove the effect from.
   * @param {AbstractUniqueEffect[]} effects
   * @returns {boolean} True if change was made
   */
  static _removeFromTokenLocally(token, effects) {
    const docs = effects.map(effect => new TokenFlagUniqueEffectDocument(token, effect));
    for ( const doc of docs ) doc.removeFromTokenLocally();
    return true;
  }

  /**
   * Refresh the token display and sheet when adding a local effect.
   * @param {Token} token
   */
  static refreshTokenDisplay(token) {
    // Drop refreshing the actor sheet as there is none for cover flags.
    // Also don't need to reset the actor as no effects applied.
    token.renderFlags.set({ redrawEffects: true });
  }
}

/**
 * Represents a unique effect document stored on a token flag.
 * Flags passed through to the token, but changes to the underlying document flags store at the token level.
 * Handles display of token icons.
 */
class TokenFlagUniqueEffectDocument {

  /** @type {Token} */
  token;

  /** @type {AbstractUniqueEffect} */
  uniqueEffect;

  constructor(token, uniqueEffect) {
    this.token = token;
    this.uniqueEffect = uniqueEffect;
  }

  /** @type {string} */
  get img() { return this.uniqueEffect.img; }

  /** @type {string} */
  get name() { return this.uniqueEffect.name; }

  /** @type {string} */
  get uniqueEffectId() { return this.uniqueEffect.uniqueEffectId; }

  /** @type {boolean} */
  get isLocal() { return this.token.flags?.[MODULE_ID]?.[FLAGS.UNIQUE_EFFECT.IS_LOCAL] === "local" || false; }

  /** @type {boolean} */
  get displayStatusIcon() {
    return this.token.document.disposition !== CONST.TOKEN_DISPOSITIONS.SECRET
      && this.uniqueEffect.displayStatusIcon;
  }

  /** @type {string} */
  get type() { return this.uniqueEffect.type; }

  /**
   * Get flag data from the token or if not present, the base effect.
   */
  getFlag(scope, key) {
    const tokenFlag = this.token.document.getFlag(scope, key);
    if ( typeof tokenFlag !== "undefined" ) return tokenFlag;
    return this.uniqueEffect.document.getFlag(scope, key);
  }

  /**
   * Set flag data on the token.
   */
  async setFlag(scope, key, value) {
    return this.uniqueEffect.document.setFlag(scope, key, value);
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

    for ( const [id, effect] of CONFIG[MODULE_ID].UniqueEffect._instances.entries() ) {
      if ( Object.hasOwn(flags, id) ) m.set(id, new this(token, effect));
    }
    return m;
  }

  /**
   * Add reference to this effect to a token.
   * @param {Token} token
   */
  async addToToken() {
    log(`UniqueFlagEffect#addToToken|Adding ${this.name} to ${this.token.name}`);
    await this.token.document.setFlag(MODULE_ID, this.uniqueEffectId, true);
    if ( this.displayStatusIcon ) this.token[MODULE_ID].addIcon({
      id: this.uniqueEffectId,
      category: this.type,
      src: this.img });
  }

  /**
   * Add locally a reference to this effect to a token.
   * @param {Token} token
   */
  addToTokenLocally() {
    log(`UniqueFlagEffect#addToTokenLocally|Adding ${this.name} to ${this.token.name}`);
    // UpdateSource will not work with periods. Simpler actually to stop using periods in the id.
    this.token.document.flags[MODULE_ID] ??= {};
    this.token.document.flags[MODULE_ID][this.uniqueEffectId] = "local";

    // This.token.document.updateSource({
    //       flags: {
    //         [MODULE_ID]: {
    //           [this.uniqueEffectId]: "local"
    //         }
    //       }
    //     });
    if ( this.displayStatusIcon ) this.token[MODULE_ID].addIcon({
      id: this.uniqueEffectId,
      category: this.type,
      src: this.img });
  }

  /**
   * Remove reference to this effect from a token.
   * @param {Token} token
   */
  async removeFromToken() {
    log(`UniqueFlagEffect#removeFromToken|Removing ${this.name} from ${this.token.name}`);
    this.token.document.unsetFlag(MODULE_ID, this.uniqueEffectId);
    this.token[MODULE_ID].removeIcon({
      id: this.uniqueEffectId,
      category: this.type,
      src: this.img });
  }

  /**
   * Remove locally a reference to this effect from a token.
   * @param {Token} token
   */
  removeFromTokenLocally() {
    log(`UniqueFlagEffect#removeFromTokenLocally|Removing ${this.name} from ${this.token.name}`);
    const flags = this.token.document.flags?.[MODULE_ID];
    if ( !flags ) return;
    delete flags[`${this.uniqueEffectId}`];
    this.token[MODULE_ID].removeIcon({
      id: this.uniqueEffectId,
      category: this.type,
      src: this.img });
  }
}


