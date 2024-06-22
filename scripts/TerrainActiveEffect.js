/* globals
ActiveEffect,
ActiveEffectConfig,
CONFIG,
CONST,
DocumentSheetConfig,
game,
foundry,
Hooks
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID, TEMPLATES, FLAGS } from "./const.js";


/**
 * Create the data definition for the TerrainActiveEffect.
 */
export function buildTerrainActiveEffectDataClass() {
  return class TerrainAE extends CONFIG.ActiveEffect.documentClass {
    /**
     * Handle duplicates: If the terrain already exists on the actor, don't add it again.
     * @param {object} data                         The initial data object provided to the document creation request
     * @param {object} options                      Additional options which modify the creation request
     * @param {documents.BaseUser} user             The User requesting the document creation
     * @returns {Promise<boolean|void>}             Return false to exclude this Document from the creation operation
     */
    async _preCreate(data, options, user) {
      const actor = this.parent;
      if ( !this.allowDuplicates
        && actor
        && actor instanceof Actor
        && actor.effects.some(e => e instanceof TerrainActiveEffect
                                && e.uniqueEffectId === this.uniqueEffectId)) return false;


      data.flags[MODULE_ID] ??= {};
      data.flags[MODULE_ID][FLAGS.UNIQUE_EFFECT.ID] ??= `Terrain_${foundry.utils.randomID()}`;
      data.flags[MODULE_ID][FLAGS.UNIQUE_EFFECT.TYPE] ??= "Terrain";

      return super._preCreate(data, options, user);
    }

    /**
     * Add this effect's icon to statuses on creation, dependent on token disposition.
     * @param {object} data                         The initial data object provided to the document creation request
     * @param {object} options                      Additional options which modify the creation request
     * @param {string} userId                       The id of the User requesting the document update
     */
    _onCreate(data, options, userId) {
      super._onCreate(data, options, userId);
      if ( !this.displayIcon ) return;
      const tokenD = this.parent?.token;
      if ( tokenD && tokenD.disposition !== CONST.TOKEN_DISPOSITIONS.SECRET ) this.statuses.set(this.img);
    }

    /**
     * Add this effect's icon to statuses on update, dependent on token disposition.
     * @param {object} changed            The differential data that was changed relative to the documents prior values
     * @param {object} options            Additional options which modify the update request
     * @param {string} userId             The id of the User requesting the document update
     */
    _onUpdate(data, options, userId) {
      super._onCreate(data, options, userId);
      const tokenD = this.parent?.token;
      if ( !tokenD ) return;
      if ( this.displayIcon && tokenD.disposition !== CONST.TOKEN_DISPOSITIONS.SECRET ) this.statuses.add(this.img);
      else if ( !this.displayIcon || tokenD.disposition === CONST.TOKEN_DISPOSITIONS.SECRET ) this.statuses.delete(this.img);
    }

    /**
     * Update this effect's icon based on changes its token disposition.
     */
    async refreshStatuses() {
      const tokenD = this.parent?.token;
      if ( !tokenD ) return;
      if ( this.displayIcon && tokenD.disposition !== CONST.TOKEN_DISPOSITIONS.SECRET ) this.statuses.add(this.img);
      else if ( !this.displayIcon || tokenD.disposition === CONST.TOKEN_DISPOSITIONS.SECRET ) this.statuses.delete(this.img);
      const change = { statuses: [...this.statuses] };
      return this.update(change);
    }
  }
}