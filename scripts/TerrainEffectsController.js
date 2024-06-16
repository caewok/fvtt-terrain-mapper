/* globals
CONFIG,
CONST,
Dialog,
game,
SearchFilter
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// Much of this is from
// https://github.com/DFreds/dfreds-convenient-effects/blob/main/scripts/app/convenient-effects-controller.js

import { Settings } from "./settings.js";
import { log } from "./util.js";
import { MODULE_ID } from "./const.js";

/**
 * Controller class to handle app events and manipulate underlying Foundry data.
 */
export class TerrainEffectsController {
  /**
   * Initializes the controller and its dependencies
   * @param {TerrainEffectsApp} viewMvc - the app that the controller can interact with
   */
  constructor(viewMvc) {
    this._viewMvc = viewMvc;

    //  Unused:
    //     this._customEffectsHandler = new CustomEffectsHandler();
    //     this._dynamicEffectsAdder = new DynamicEffectsAdder();
    //     this._foundryHelpers = new FoundryHelpers();
  }

  /**
   * Configures and returns the data that the app will send to the template
   * @returns {Object} the data to pass to the template
   */
  get data() {
    const terrains = [...CONFIG[MODULE_ID].Terrain._instances.values()];
    this._sortTerrains(terrains);

    return {
      // Folders:
      // - Favorites: Smart folder; displays any item that is favorited.
      // - Scene: Smart folder; displays any terrain in the scene.
      // - All: Smart folder; displays all defined terrains.
      folders: [
        {
          id: "favorites",
          name: "Favorites",
          effects: this._fetchFavorites(terrains).map(e => {
            return {
              name: e.name,
              icon: e.img,
              id: e.uniqueEffectId,
              description: e.document.description
            };
          })
        },
        {
          id: "all",
          name: "All",
          effects: terrains.map(e => {
            return {
              name: e.name,
              icon: e.img,
              id: e.uniqueEffectId,
              description: e.document.description
            };
          })
        }
      ],

      isGM: game.user.isGM
    };
  }

  _fetchFavorites(terrains) {
    log("TerrainEffectsController|_fetchFavorites");
    const favorites = new Set(Settings.get(Settings.KEYS.CONTROL_APP.FAVORITES));
    console.debug("_fetchFavorites", { favorites });
    return terrains.filter(t => favorites.has(t.uniqueEffectId));
  }


  _sortTerrains(terrains) {
    terrains.sort((a, b) => {
      const nameA = a.name.toLowerCase();
      const nameB = b.name.toLowerCase();
      if ( nameA < nameB ) return -1;
      if ( nameA > nameB ) return 1;
      return 0;
    });
    return terrains;
  }

  /**
   * Remove the collapsed class from all saved, expanded folders
   */
  expandSavedFolders() {
    Settings.expandedFolders.forEach(folderId => {
      this._viewMvc.expandFolder(folderId);
    });
  }

  /**
   * Handles clicks on the create effect button
   * @param {MouseEvent} event
   */
  async onCreateEffectClick(_event) {
    log("TerrainEffectsController|onCreateEffectClick");
    const terrain = await CONFIG[MODULE_ID].Terrain.create();
    this._viewMvc.render();
    terrain.activeEffect.sheet.render(true);
  }

  /**
   * Handle editing the custom effect
   * @param {jQuery} effectItem - jQuery element representing the effect list item
   */
  async onEditEffectClick(_effectItem) {
    log("TerrainEffectsController|onEditEffectClick");
    const effectId = this._findNearestEffectId(event);
    const terrain = CONFIG[MODULE_ID].Terrain._instances.get(effectId);
    terrain.document.sheet.render(true);
  }

  /**
   * Handle deleting the custom effect
   * @param {jQuery} effectItem - jQuery element representing the effect list item
   */
  async onDeleteEffectClick(_effectItem) {
    log("TerrainEffectsController|onDeleteEffectClick");
    const effectId = this._findNearestEffectId(event);
    const view = this._viewMvc;

    return Dialog.confirm({
      title: "Remove Terrain",
      content:
        "<h4>Are You Sure?</h4><p>This will remove the terrain from all scenes.",
      yes: async () => {
        log("TerrainEffectsController|onDeleteEffectClick yes");
        const terrain = CONFIG[MODULE_ID].Terrain._instances.get(effectId);
        await terrain.destroy();
        view.render();
      }
    });

    // Unused:
    //     const effectName = effectItem.data().effectName;
    //     const customEffect = this._customEffectsHandler
    //       .getCustomEffects()
    //       .find((effect) => effect.name == effectName);
    //
    //     await this._customEffectsHandler.deleteCustomEffect(customEffect);
    //     this._viewMvc.render();
  }

  /**
   * Handles clicks on the reset status effects button
   * @param {MouseEvent} event
   */
  async onResetStatusEffectsClick(_event) {
    return Dialog.confirm({
      title: "Reset Terrain",
      content:
        "<h4>Are You Sure?</h4><p>This will reset all configured terrain effects to the module defaults and reload Foundry.",
      yes: async () => {
        log("TerrainEffectsController|onResetStatusEffectsClick");
        // await this._settings.resetStatusEffects();
        window.location.reload();
      }
    });
  }

  /**
   * Handles clicks on the collapse all button
   * @param {MouseEvent} event - event that corresponds to clicking the collapse all
   */
  async onCollapseAllClick(_event) {
    this._viewMvc.collapseAllFolders();
    await Settings.clearExpandedFolders();
  }

  /**
   * Handles clicks on folders by collapsing or expanding them
   * @param {MouseEvent} event - event that corresponds to clicking on the folder
   */
  async onFolderClick(event) {
    let folderId = event.currentTarget.parentElement.dataset.folderId;

    if (this._viewMvc.isFolderCollapsed(folderId)) {
      this._viewMvc.expandFolder(folderId);
    } else {
      this._viewMvc.collapseFolder(folderId);
    }

    if (Settings.isFolderExpanded(folderId)) {
      await Settings.removeExpandedFolder(folderId);
    } else {
      await Settings.addExpandedFolder(folderId);
    }
  }

  /**
   * Handles clicks on effect items by toggling them on or off on selected tokens
   * @param {MouseEvent} event - event that corresponds to clicking an effect item
   */
  async onEffectClick(event) {
    log("TerrainEffectsController|onEffectClick");
    await this.onEditEffectClick(event);
  }

  /**
   * Handle adding the effect to the favorites settings and to the favorites folder
   * @param {jQuery} effectItem - jQuery element representing the effect list item
   */
  async onAddFavorite(effectItem) {
    log("TerrainEffectsController|onAddFavorite");
    const effectId = effectItem.data().effectId;
    await Settings.addToFavorites(effectId);
    this._viewMvc.render();
  }

  /**
   * Handle removing the effect from the favorites settings and from the favorites folder
   * @param {jQuery} effectItem - jQuery element representing the effect list item
   */
  async onRemoveFavorite(effectItem) {
    log("TerrainEffectsController|onRemoveFavorite");
    const effectId = effectItem.data().effectId;
    await Settings.removeFromFavorites(effectId);
    this._viewMvc.render();
  }

  /**
   * Checks if the provided effect is favorited
   * @param {jQuery} effectItem - jQuery element representing the effect list item
   * @returns true if the effect is favorited
   */
  isFavoritedEffect(effectItem) {
    log("TerrainEffectsController|isFavoritedEffect");
    const effectId = effectItem.data().effectId;
    return Settings.isFavorite(effectId);
  }

  /**
   * Handle clicks on the import terrain menu item.
   * @param {jQuery} effectItem - jQuery element representing the effect list item
   */
  async onImportTerrain(effectItem) {
    log("TerrainEffectsController|onImportTerrain");
    const effectId = effectItem.data().effectId;
    const terrain = CONFIG[MODULE_ID].Terrain._instances.get(effectId);
    await terrain.importFromJSONDialog();
    this._viewMvc.render();
  }

  /**
   * Handle clicks on the export terrain menu item.
   * @param {jQuery} effectItem - jQuery element representing the effect list item
   */
  onExportTerrain(effectItem) {
    log("TerrainEffectsController|onExportTerrain");
    const effectId = effectItem.data().effectId;
    const terrain = CONFIG[MODULE_ID].Terrain._instances.get(effectId);
    terrain.toJSON();
  }

  /**
   * Handle duplicating an effect.
   * @param {jQuery} effectItem - jQuery element representing the effect list item
   */
  async onDuplicate(effectItem) {
    log("TerrainEffectsController|onDuplicate");
    const effectId = effectItem.data().effectId;
    const terrain = CONFIG[MODULE_ID].Terrain._instances.get(effectId);
    await terrain.duplicate();
    this._viewMvc.render();
  }

  /**
   * Handles starting the drag for effect items
   * For non-nested effects, populates the dataTransfer with Foundry's expected
   * ActiveEffect type and data to make non-nested effects behave as core does
   * @param {DragEvent} event - event that corresponds to the drag start
   */
  onEffectDragStart(_event) {
    log(`TerrainEffectsController|onEffectDragStart for ${event.target.dataset.effectName}`);
    const terrain = CONFIG[MODULE_ID].Terrain._instances.get(event.target.dataset.effectId);
    event.dataTransfer.setData(
      "text/plain",
      JSON.stringify(terrain.dragData)
    );
  }

  canDragStart() {
    return game.user.role >= CONST.USER_ROLES.ASSISTANT;
  }

  /**
   * Handles search text changes
   * @param {KeyboardEvent} event - event that corresponds to the key press
   * @param {string} query - string representation of the entered search text
   * @param {RegExp} regex - the regex representation of the entered search text
   * @param {HTML} html - the html the SearchFilter is being applied to
   */
  onSearchTextChange(event, query, regex, html) {
    const isSearch = !!query;

    let matchingItems = {};

    if (isSearch) {
      matchingItems = this._getMatchingItems(regex);
    }

    for (let el of html.querySelectorAll(".directory-item")) {
      let isEntity = el.classList.contains("entity");
      let isFolder = el.classList.contains("folder");

      if (isEntity) {
        let match =
          isSearch && matchingItems.effectNames.has(el.dataset.effectName);
        el.style.display = !isSearch || match ? "flex" : "none";
      } else if (isFolder) {
        let match =
          isSearch && matchingItems.folderIds.has(el.dataset.folderId);
        el.style.display = !isSearch || match ? "flex" : "none";

        // Expand folders with matches
        if (match) el.classList.remove("collapsed");
        else el.classList.toggle(
          "collapsed",
          !Settings.isFolderExpanded(el.dataset.folderId)
        );
      }
    }
  }

  _getMatchingItems(regex) {
    let effectNames = new Set();
    let folderIds = new Set();

    for (let folder of this.data.folders) {
      for (let effect of folder.effects) {
        if (regex.test(SearchFilter.cleanQuery(effect.name))) {
          effectNames.add(effect.name);
          folderIds.add(folder.id);
        }
      }
    }

    return {
      effectNames,
      folderIds
    };
  }

  _findNearestEffectId(event) {
    return $(event.target)
      .closest("[data-effect-id], .terrainmapper-effect")
      .data()?.effectId;
  }
}
