/* globals
CONST,
foundry,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "../const.js";

export const PATCHES = {};
PATCHES.REGIONS = {};


/**
 * Region behavior to set token to specific top/bottom elevation.
 * @property {number} elevation       The elevation at which to set the token
 * @property {number} floor           The elevation at which to reset the token when leaving the region
 *                                    Defaults to scene elevation
 * @property {number} rampStepHeight  The vertical size, in grid units, of ramp elevation increments
 * @property {number} rampDirection   The direction of incline for the ramp, in degrees
 * @property {boolean} reset          When enabled, elevation will be reset to floor on exit
 * @property {FLAGS.REGION.TERRAIN.CHOICES} algorithm       How elevation change should be handled. plateau, ramp, stairs
 */
export class StepsTerrainRegionBehaviorType extends foundry.data.regionBehaviors.RegionBehaviorType {
  static defineSchema() {
    return {
      direction: new foundry.data.fields.NumberField({
        label: `${MODULE_ID}.region-config.rampDirection.name`,
        hint: `${MODULE_ID}.region-config.rampDirection.hint`,
        initial: 0,
        min: 0,
        max: 359,
        step: 1,
      }),

      stepSize: new foundry.data.fields.NumberField({
        label: `${MODULE_ID}.region-config.rampStepSize.name`,
        hint: `${MODULE_ID}.region-config.rampStepSize.hint`,
        initial: 1,
        min: 1,
        step: 1,
      }),

      dialog: new foundry.data.fields.BooleanField({
        label: `${MODULE_ID}.behavior.types.stairs.fields.dialog.name`,
        hint: `${MODULE_ID}.behavior.types.stairs.fields.dialog.hint`,
        initial: false
      }),
    };
  }

  /** @override */
  static events = {
    [CONST.REGION_EVENTS.TOKEN_MOVE_IN]: this.#onTokenMoveIn,
    [CONST.REGION_EVENTS.TOKEN_MOVE_OUT]: this.#onTokenMoveOut,
    [CONST.REGION_EVENTS.TOKEN_MOVE_WITHIN]: this.#onTokenMoveWithin,
    [CONST.REGION_EVENTS.TOKEN_ENTER]: this.#onTokenEnter,
    [CONST.REGION_EVENTS.TOKEN_EXIT]: this.#onTokenExit,
    [CONST.REGION_EVENTS.TOKEN_ANIMATE_IN]: this.#onTokenAnimateIn,
    [CONST.REGION_EVENTS.TOKEN_ANIMATE_OUT]: this.#onTokenAnimateOut,
  };


  /**
   * @type {RegionEvent} event
   *   - @prop {object} data        Data related to the event
   *     - @prop {Token} token      Token triggering the event
   *   - @prop {string} name        Name of the event type (e.g., "tokenEnter")
   *   - @prop {RegionDocument}     Region for the event
   *   - @prop {User} user          User that triggered the event
   */
  static async #onTokenMoveIn(event) {
    console.debug(`onTokenMoveIn: ${event.data.token.name}`);
  }

  /**
   * @type {RegionEvent} event
   *   - @prop {object} data        Data related to the event
   *     - @prop {Token} token      Token triggering the event
   *   - @prop {string} name        Name of the event type (e.g., "tokenEnter")
   *   - @prop {RegionDocument}     Region for the event
   *   - @prop {User} user          User that triggered the event
   */
  static async #onTokenMoveOut(event) {
    console.debug(`onTokenMoveOut: ${event.data.token.name}`);
  }

  /**
   * @type {RegionEvent} event
   *   - @prop {object} data        Data related to the event
   *     - @prop {Token} token      Token triggering the event
   *   - @prop {string} name        Name of the event type (e.g., "tokenEnter")
   *   - @prop {RegionDocument}     Region for the event
   *   - @prop {User} user          User that triggered the event
   */
  static async #onTokenMoveWithin(event) {
    console.debug(`onTokenMoveWithin: ${event.data.token.name}`);
  }

  /**
   * @type {RegionEvent} event
   *   - @prop {object} data        Data related to the event
   *     - @prop {Token} token      Token triggering the event
   *   - @prop {string} name        Name of the event type (e.g., "tokenEnter")
   *   - @prop {RegionDocument}     Region for the event
   *   - @prop {User} user          User that triggered the event
   */
  static async #onTokenEnter(event) {
    console.debug(`onTokenEnter: ${event.data.token.name}`);
  }

  /**
   * @type {RegionEvent} event
   *   - @prop {object} data        Data related to the event
   *     - @prop {Token} token      Token triggering the event
   *   - @prop {string} name        Name of the event type (e.g., "tokenEnter")
   *   - @prop {RegionDocument}     Region for the event
   *   - @prop {User} user          User that triggered the event
   */
  static async #onTokenExit(event) {
    console.debug(`onTokenExit: ${event.data.token.name}`);
  }

  /**
   * @type {RegionEvent} event
   *   - @prop {object} data        Data related to the event
   *     - @prop {Token} token      Token triggering the event
   *   - @prop {string} name        Name of the event type (e.g., "tokenEnter")
   *   - @prop {RegionDocument}     Region for the event
   *   - @prop {User} user          User that triggered the event
   */
  static async #onTokenAnimateIn(event) {
    console.debug(`onTokenAnimateIn: ${event.data.token.name}`);
  }

  /**
   * @type {RegionEvent} event
   *   - @prop {object} data        Data related to the event
   *     - @prop {Token} token      Token triggering the event
   *   - @prop {string} name        Name of the event type (e.g., "tokenEnter")
   *   - @prop {RegionDocument}     Region for the event
   *   - @prop {User} user          User that triggered the event
   */
  static async #onTokenAnimateOut(event) {
    console.debug(`onTokenAnimateOut: ${event.data.token.name}`);
  }
}