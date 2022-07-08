import { getTilePosAndDimensions } from './misc-utils';

const BaseTrack = (HGC, ...args) => {
  class BaseTrackClass extends HGC.tracks.Tiled1DPixiTrack {
    constructor(context, options) {
      super(context, options);
    }

    initTile(tile) {}

    getBoundsOfTile(tile) {
      // get the bounds of the tile
      const tileId = +tile.tileId.split('.')[1];
      const zoomLevel = +tile.tileId.split('.')[0]; //track.zoomLevel does not always seem to be up to date
      const tileWidth = +this.tilesetInfo.max_width / 2 ** zoomLevel;
      const tileMinX = this.tilesetInfo.min_pos[0] + tileId * tileWidth; // abs coordinates
      const tileMaxX = this.tilesetInfo.min_pos[0] + (tileId + 1) * tileWidth;
      this.zoomLevel = zoomLevel;
      return [tileMinX, tileMaxX];
    }

    draw() {
      this.trackNotFoundText.text = 'Track not found.';
      this.trackNotFoundText.visible = true;
    }

    calculateZoomLevel() {
      if (!this.tilesetInfo) return 0;

      return HGC.utils.trackUtils.calculate1DZoomLevel(
        this.tilesetInfo,
        this._xScale,
        this.maxZoom,
      );
    }

    calculateVisibleTiles() {
      const tiles = HGC.utils.trackUtils.calculate1DVisibleTiles(
        this.tilesetInfo,
        this._xScale,
      );

      for (const tile of tiles) {
        const { tileX, tileWidth } = getTilePosAndDimensions(
          tile[0],
          [tile[1]],
          this.tilesetInfo.tile_size,
          this.tilesetInfo,
        );
      }

      this.setVisibleTiles(tiles);
    }

    setPosition(newPosition) {
      super.setPosition(newPosition);
      [this.pMain.position.x, this.pMain.position.y] = this.position;
      [this.pMouseOver.position.x, this.pMouseOver.position.y] = this.position;
    }

    draw() {
      this.trackNotFoundText.text = 'Track not found.';
      this.trackNotFoundText.visible = true;
    }

    updateLoadingText() {
      this.loadingText.visible = true;
      this.loadingText.text = '';

      if (!this.tilesetInfo) {
        this.loadingText.text = 'Fetching tileset info...';
        return;
      }

      if (this.fetching.size) {
        this.loadingText.text = 'Fetching data...';
      }

      if (this.rendering.size) {
        this.loadingText.text = 'Rendering data...';
      }

      if (!this.fetching.size && !this.rendering.size) {
        this.loadingText.visible = false;
      }
    }

    exportSVG() {
      let track = null;
      let base = null;

      if (super.exportSVG) {
        [base, track] = super.exportSVG();
      } else {
        base = document.createElement('g');
        track = base;
      }

      const output = document.createElement('g');
      track.appendChild(output);

      output.setAttribute(
        'transform',
        `translate(${this.pMain.position.x},${this.pMain.position.y}) scale(${this.pMain.scale.x},${this.pMain.scale.y})`,
      );

      const gSegment = document.createElement('g');
      output.appendChild(gSegment);

      const b64string = HGC.services.pixiRenderer.plugins.extract.base64(
        this.pMain.parent.parent,
      );

      const gImage = document.createElement('g');

      gImage.setAttribute('transform', `translate(0,0)`);

      const image = document.createElement('image');
      image.setAttributeNS(
        'http://www.w3.org/1999/xlink',
        'xlink:href',
        b64string,
      );
      gImage.appendChild(image);
      gSegment.appendChild(gImage);

      return [base, base];
    }
  }

  return BaseTrackClass;
};

export default BaseTrack;
