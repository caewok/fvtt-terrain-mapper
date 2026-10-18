/* globals
CONST,
foundry,
game,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID, FLAGS } from "../const.js";
import { log } from "../util.js";

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
export class HillTerrainRegionBehaviorType extends foundry.data.regionBehaviors.RegionBehaviorType {
  static defineSchema() {
    return {
      type: new foundry.data.fields.StringField({
        label: `${MODULE_ID}.region-config.hillType.name`,
        hint: `${MODULE_ID}.region-config.hillType.hint`,
        required: true,
        initial: "linear",
        choices: FLAGS.REGION.HILL.LABELS,
      }),

      dialog: new foundry.data.fields.BooleanField({
        label: `${MODULE_ID}.region-config.terrain.dialog.name`,
        hint: `${MODULE_ID}.region-config.terrain.dialog.hint`,
        initial: false
      }),
    };
  }

  /** @override */
  static events = {
    [CONST.REGION_EVENTS.TOKEN_MOVE_IN]: this.#onTokenMoveIn,
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
    log(`onTokenMoveIn: ${event.data.token.name}`);
    if ( !this.dialog ) return;
    if ( event.user !== game.user ) return;
    const tokenD = event.data.token;

    // Pause movement while we await the user dialog.
    const resumeMovement = tokenD.pauseMovement();

    // Await movement animation
    if ( tokenD.rendered ) await tokenD.object?.movementAnimationPromise;

    const content = game.i18n.localize(`${MODULE_ID}.phrases.terrain-onto`);
    const moveOntoTerrain = await foundry.applications.api.DialogV2.confirm({ content, rejectClose: false, modal: true });
    if ( moveOntoTerrain ) return resumeMovement ? resumeMovement() : undefined;
    tokenD.stopMovement();
  }
}