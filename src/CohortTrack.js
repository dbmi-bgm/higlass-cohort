import VCFDataFetcher from './vcf-fetcher';
import MyWorkerWeb from 'raw-loader!../dist/worker.js';
import { spawn, BlobWorker } from 'threads';
import { PILEUP_COLORS } from './vcf-utils';
import LegendUtils from './legend-utils';
import sanitizeHtml from 'sanitize-html';
import VariantDetails from './VariantDetails';
import VariantDetailFetcher from './variant-detail-fetcher';
import { format } from 'd3-format';
import { scaleLinear, scaleLog } from 'd3-scale';

// const createColorTexture = (PIXI, colors) => {
//   const colorTexRes = Math.max(2, Math.ceil(Math.sqrt(colors.length)));
//   const rgba = new Float32Array(colorTexRes ** 2 * 4);
//   colors.forEach((color, i) => {
//     // eslint-disable-next-line prefer-destructuring
//     rgba[i * 4] = color[0]; // r
//     // eslint-disable-next-line prefer-destructuring
//     rgba[i * 4 + 1] = color[1]; // g
//     // eslint-disable-next-line prefer-destructuring
//     rgba[i * 4 + 2] = color[2]; // b
//     // eslint-disable-next-line prefer-destructuring
//     rgba[i * 4 + 3] = color[3]; // a
//   });

//   return [PIXI.Texture.fromBuffer(rgba, colorTexRes, colorTexRes), colorTexRes];
// };

function invY(p, t) {
  return (p - t.y) / t.k;
}

const scaleScalableGraphics = (graphics, xScale, drawnAtScale) => {
  const tileK =
    (drawnAtScale.domain()[1] - drawnAtScale.domain()[0]) /
    (xScale.domain()[1] - xScale.domain()[0]);
  const newRange = xScale.domain().map(drawnAtScale);

  const posOffset = newRange[0];
  graphics.scale.x = tileK;
  graphics.position.x = -posOffset * tileK;
};

const getTilePosAndDimensions = (
  zoomLevel,
  tilePos,
  binsPerTileIn,
  tilesetInfo,
) => {
  /**
   * Get the tile's position in its coordinate system.
   *
   * TODO: Replace this function with one imported from
   * HGC.utils.trackUtils
   */
  const xTilePos = tilePos[0];
  const yTilePos = tilePos[1];

  if (tilesetInfo.resolutions) {
    // the default bins per tile which should
    // not be used because the right value should be in the tileset info

    const binsPerTile = binsPerTileIn;

    const sortedResolutions = tilesetInfo.resolutions
      .map((x) => +x)
      .sort((a, b) => b - a);

    const chosenResolution = sortedResolutions[zoomLevel];

    const tileWidth = chosenResolution * binsPerTile;
    const tileHeight = tileWidth;

    const tileX = chosenResolution * binsPerTile * tilePos[0];
    const tileY = chosenResolution * binsPerTile * tilePos[1];

    return {
      tileX,
      tileY,
      tileWidth,
      tileHeight,
    };
  }

  // max_width should be substitutable with 2 ** tilesetInfo.max_zoom
  const totalWidth = tilesetInfo.max_width;
  const totalHeight = tilesetInfo.max_width;

  const minX = tilesetInfo.min_pos[0];
  const minY = tilesetInfo.min_pos[1];

  const tileWidth = totalWidth / 2 ** zoomLevel;
  const tileHeight = totalHeight / 2 ** zoomLevel;

  const tileX = minX + xTilePos * tileWidth;
  const tileY = minY + yTilePos * tileHeight;

  return {
    tileX,
    tileY,
    tileWidth,
    tileHeight,
  };
};

function eqSet(as, bs) {
  return as.size === bs.size && all(isIn(bs), as);
}

function all(pred, as) {
  for (var a of as) if (!pred(a)) return false;
  return true;
}

function isIn(as) {
  return function (a) {
    return as.has(a);
  };
}

const CohortTrack = (HGC, ...args) => {

  class CohortTrackClass extends HGC.tracks.Tiled1DPixiTrack {
    constructor(context, options) {
      const worker = spawn(BlobWorker.fromText(MyWorkerWeb));
      // this is where the threaded tile fetcher is called
      context.dataConfig['maxTileWidth'] = options.maxTileWidth;
      context.dataFetcher = new VCFDataFetcher(context.dataConfig, worker, HGC);
      super(context, options);
      context.dataFetcher.track = this;

      this.worker = worker;
      this.valueScaleTransform = HGC.libraries.d3Zoom.zoomIdentity;
      this.HGC = HGC;

      this.trackId = this.id;
      this.viewId = context.viewUid;

      this.lollipopRadius = 4;

      // we scale the entire view up until a certain point
      // at which point we redraw everything to get rid of
      // artifacts
      // this.drawnAtScale keeps track of the scale at which
      // we last rendered everything
      this.drawnAtScale = HGC.libraries.d3Scale.scaleLinear();
      this.variantList = [];

      // graphics for highliting reads under the cursor
      this.mouseOverGraphics = new HGC.libraries.PIXI.Graphics();
      this.loadingText = new HGC.libraries.PIXI.Text('Initializing...', {
        fontSize: '12px',
        fontFamily: 'Arial',
        fill: 'grey',
      });

      this.initSubTracks();

      this.loadingText.x = 40;
      this.loadingText.y = 0;

      this.loadingText.anchor.x = 0;
      this.loadingText.anchor.y = 0;

      this.fetching = new Set();
      this.rendering = new Set();

      this.mouseClickData = null;

      this.isShowGlobalMousePosition = context.isShowGlobalMousePosition;

      if (this.options.showMousePosition && !this.hideMousePosition) {
        this.hideMousePosition = HGC.utils.showMousePosition(
          this,
          this.is2d,
          this.isShowGlobalMousePosition(),
        );
      }

      this.pForeground.addChild(this.loadingText);

      this.colorScaleHex = {};
      this.options.colorScale.forEach((cs) => {
        this.colorScaleHex[cs['level']] = HGC.utils.colorToHex(cs['color']);
      });

      if (this.options.variantDetailSource) {
        this.variantDetailFetcher = new VariantDetailFetcher(
          this.options.variantDetailSource,
        );
      }
    }

    initSubTracks() {
      this.subTracks = [];

      const mainTrackHeight =
        this.options.mainDisplay === 'deltaAF' ? 200 : 100;
      this.subTracks.push({
        legendUtils: new LegendUtils(this.HGC, 50, mainTrackHeight),
        legendGraphics: new this.HGC.libraries.PIXI.Graphics(),
        labelGraphics: new this.HGC.libraries.PIXI.Graphics(),
        infoGraphics: new this.HGC.libraries.PIXI.Graphics(),
        bgGraphics: new this.HGC.libraries.PIXI.Graphics(),
        afGraphics: new this.HGC.libraries.PIXI.Graphics(),
        height: mainTrackHeight,
        yOffset: 15,
        baseLineLevel: 101,
        numLabels: 4,
        id: 'main',
      });

      let curYOffset = mainTrackHeight + 25;

      this.options.colorScale.forEach((cs) => {
        const height = 30;
        const padding = 5;
        this.subTracks.push({
          legendUtils: new LegendUtils(this.HGC, 50, 50),
          legendGraphics: new this.HGC.libraries.PIXI.Graphics(),
          labelGraphics: new this.HGC.libraries.PIXI.Graphics(),
          infoGraphics: new this.HGC.libraries.PIXI.Graphics(),
          bgGraphics: new this.HGC.libraries.PIXI.Graphics(),
          afGraphics: new this.HGC.libraries.PIXI.Graphics(),
          height: height,
          yOffset: curYOffset,
          baseLineLevel: 0,
          numLabels: 1,
          id: cs['level'] + '_case',
        });

        curYOffset += height + padding;

        this.subTracks.push({
          legendUtils: new LegendUtils(this.HGC, 50, 50),
          legendGraphics: new this.HGC.libraries.PIXI.Graphics(),
          labelGraphics: new this.HGC.libraries.PIXI.Graphics(),
          infoGraphics: new this.HGC.libraries.PIXI.Graphics(),
          bgGraphics: new this.HGC.libraries.PIXI.Graphics(),
          afGraphics: new this.HGC.libraries.PIXI.Graphics(),
          height: height,
          yOffset: curYOffset,
          baseLineLevel: 0,
          numLabels: 1,
          id: cs['level'] + '_control',
        });

        curYOffset += height + padding;
      });

      this.subTracks.forEach((subTrack) => {
        subTrack.legendGraphics.position.y = subTrack.yOffset;
        subTrack.labelGraphics.position.y = subTrack.yOffset;
        subTrack.infoGraphics.position.y = subTrack.yOffset;
        subTrack.afGraphics.position.y = subTrack.yOffset;
        subTrack.bgGraphics.position.y = subTrack.yOffset;
        this.pForeground.addChild(subTrack.legendGraphics);
        this.pForeground.addChild(subTrack.labelGraphics);
        this.pForeground.addChild(subTrack.infoGraphics);
        this.pMain.addChild(subTrack.bgGraphics);
        this.pMain.addChild(subTrack.afGraphics);
      });
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

    setUpShaderAndTextures() {}

    rerender(options) {
      super.rerender(options);

      this.options = options;

      if (this.options.showMousePosition && !this.hideMousePosition) {
        this.hideMousePosition = HGC.utils.showMousePosition(
          this,
          this.is2d,
          this.isShowGlobalMousePosition(),
        );
      }

      if (!this.options.showMousePosition && this.hideMousePosition) {
        this.hideMousePosition();
        this.hideMousePosition = undefined;
      }

      this.setUpShaderAndTextures();
      this.updateExistingGraphics();
    }

    drawNotification(subtrack, text) {
      subtrack.legendUtils.createNotification(
        subtrack.infoGraphics,
        this.dimensions[0],
        text,
      );
    }

    clearNotification(subtrack) {
      subtrack.legendUtils.clearNotification(subtrack.infoGraphics);
    }

    createLabelGraphics() {
      const colorScaleHex = [];
      this.options.colorScale.forEach((cs) => {
        colorScaleHex.push({
          level: cs['level'],
          colorHex: HGC.utils.colorToHex(cs['color']),
        });
      });

      this.subTracks.forEach((subTrack) => {
        subTrack.legendUtils.drawLabel(
          subTrack.labelGraphics,
          this.dimensions[0],
          subTrack.id,
          colorScaleHex,
        );
      });
    }

    createLegendGraphics() {
      const mainTrack = this.subTracks[0];
      mainTrack.legendUtils.resetLegend(mainTrack.legendGraphics);
      if (this.options.mainDisplay === 'deltaAF') {
        mainTrack.legendUtils.createLegend(
          mainTrack.legendGraphics,
          1,
          mainTrack.numLabels,
          0,
          mainTrack.height / 2,
        );
        mainTrack.legendUtils.createLegend(
          mainTrack.legendGraphics,
          1,
          mainTrack.numLabels,
          mainTrack.height / 2,
          mainTrack.height / 2,
          true,
        );
      } else {
        mainTrack.legendUtils.createLegend(
          mainTrack.legendGraphics,
          1,
          mainTrack.numLabels,
          0,
          mainTrack.height,
        );
      }
      mainTrack.legendUtils.setBaseLineLevel(mainTrack.baseLineLevel);

      this.subTracks.forEach((subTrack, i) => {
        if (i === 0) {
          return;
        }
        subTrack.legendUtils.resetLegend(subTrack.legendGraphics);
        subTrack.legendUtils.createLegend(
          subTrack.legendGraphics,
          1,
          subTrack.numLabels,
          0,
          subTrack.height,
        );
      });

      this.subTracks.forEach((subTrack) => {
        subTrack.legendUtils.drawHorizontalLines(
          subTrack.bgGraphics,
          0,
          this.dimensions[0],
        );
      });
    }

    updateVariantsInView() {
      this.variantsInView = [];
      this.variantList.forEach((variant) => {
        const xPos = this._xScale(variant.from);
        if (xPos > 0 && xPos < this.dimensions[0]) {
          this.variantsInView.push(variant);
        }
      });
    }

    drawBarCharts() {
      let maxAF = 0;
      let minAF = 1;

      this.variantsInView.forEach((variant) => {
        maxAF = Math.max(maxAF, variant.alleleFrequencyCases);
        minAF =
          variant.alleleFrequencyCases > 0
            ? Math.min(minAF, variant.alleleFrequencyCases)
            : minAF;
        if (this.options.controlGroup === 'gnomad2') {
          maxAF =
            variant.alleleFrequencyGnomad2 !== 'NA'
              ? Math.max(maxAF, variant.alleleFrequencyGnomad2)
              : maxAF;
          minAF =
            variant.alleleFrequencyGnomad2 !== 'NA' &&
            variant.alleleFrequencyGnomad2 > 0
              ? Math.min(minAF, variant.alleleFrequencyGnomad2)
              : minAF;
        } else {
          maxAF =
            variant.alleleFrequencyGnomad3 !== 'NA'
              ? Math.max(maxAF, variant.alleleFrequencyGnomad3)
              : maxAF;
          minAF =
            variant.alleleFrequencyGnomad3 !== 'NA' &&
            variant.alleleFrequencyGnomad3 > 0
              ? Math.min(minAF, variant.alleleFrequencyGnomad3)
              : minAF;
        }
      });

      if (maxAF === 0) {
        maxAF = 1e-1;
      } else {
        const m = -Math.floor(Math.log10(maxAF) + 1) + 1;
        const mm = 10 ** m;
        maxAF = Math.ceil(maxAF * mm) / mm;
      }

      this.subTracks.forEach((subTrack, i) => {
        if (i === 0) {
          return;
        }
        subTrack.afGraphics.clear();
        subTrack.legendUtils.resetLegend(subTrack.legendGraphics);
        subTrack.legendUtils.createLegend(
          subTrack.legendGraphics,
          maxAF,
          subTrack.numLabels,
          0,
          subTrack.height,
        );

        const cll = subTrack.legendUtils.currentLegendLevels;
        const numLabels = subTrack.legendUtils.numLabels;

        const rangePos = [cll[0], cll[numLabels]];

        // Attach scales that map from value to lollipop height in display
        const domainFrom = Math.max(minAF / 5, 1e-6);
        const domainTo = maxAF;

        subTrack['logYScalePos'] = scaleLog()
          .domain([domainFrom, domainTo])
          .range([0, rangePos[1] - rangePos[0]]);

        this.variantsInView.forEach((variant) => {
          if (!subTrack.id.includes(variant.colorCategory)) {
            return;
          }

          let valueToPlot = variant.alleleFrequencyCases;
          if (subTrack.id.includes('control')) {
            valueToPlot =
              this.options.controlGroup === 'gnomad2'
                ? variant.alleleFrequencyGnomad2
                : variant.alleleFrequencyGnomad3;
            variant.yRangeRect2 = [
              cll[0] + subTrack.yOffset,
              cll[numLabels] + subTrack.yOffset,
            ]; // mouse over
          } else {
            variant.yRangeRect1 = [
              cll[0] + subTrack.yOffset,
              cll[numLabels] + subTrack.yOffset,
            ]; // mouse over
          }

          if (valueToPlot >= domainFrom) {
            const xPos = this._xScale(variant.from);
            const rectWidth = Math.max(
              this._xScale(variant.from + 1) - xPos,
              1,
            );
            const rectHeight = subTrack.logYScalePos(valueToPlot);
            const yPos = rangePos[1] - rectHeight + 1;
            subTrack.afGraphics.beginFill(
              this.colorScaleHex[variant.colorCategory],
            );
            subTrack.afGraphics.drawRect(xPos, yPos, rectWidth, rectHeight);
          } else if (valueToPlot >= 0) {
            const xPos = this._xScale(variant.from);
            const rectWidth = Math.max(
              this._xScale(variant.from + 1) - xPos,
              1,
            );
            const rectHeight = subTrack.logYScalePos(valueToPlot);
            const yPos = rangePos[1] - rectHeight + 1;
            subTrack.afGraphics.beginFill(
              this.colorScaleHex[variant.colorCategory],
            );
            subTrack.afGraphics.drawRect(xPos, yPos, rectWidth, 1);
          }
        });
      });
    }

    drawLollipops() {
      const mainTrack = this.subTracks[0];
      mainTrack.afGraphics.clear();

      this.updateVariantsInView();

      if (this.options.mainDisplay === 'deltaAF') {
        this.drawLollipopsDeltaAF(mainTrack);
      } else {
        this.drawLollipopsFisher(mainTrack);
      }
    }

    drawLollipopsDeltaAF(mainTrack) {
      let maxAF = 0;

      this.variantsInView.forEach((variant) => {
        if (this.options.controlGroup === 'gnomad2') {
          maxAF = Math.max(maxAF, variant.deltaAfAbsGnomad2);
        } else {
          maxAF = Math.max(maxAF, variant.deltaAfAbsGnomad3);
        }
      });
      // round to closes decimal for legend

      if (maxAF === 0) {
        maxAF = 1e-1;
      } else {
        const m = -Math.floor(Math.log10(maxAF) + 1) + 1;
        const mm = 10 ** m;
        maxAF = Math.ceil(maxAF * mm) / mm;
      }

      //maxAF = parseFloat(maxAF.toExponential(0));

      mainTrack.legendUtils.resetLegend(mainTrack.legendGraphics);

      mainTrack.legendUtils.createLegend(
        mainTrack.legendGraphics,
        maxAF,
        mainTrack.numLabels,
        0,
        mainTrack.height / 2,
      );
      mainTrack.legendUtils.createLegend(
        mainTrack.legendGraphics,
        maxAF,
        mainTrack.numLabels,
        mainTrack.height / 2,
        mainTrack.height / 2,
        true,
      );

      //console.log("LegenLevels:", mainTrack.legendUtils.currentLegendLevels);
      const cll = mainTrack.legendUtils.currentLegendLevels;
      const numLabels = mainTrack.legendUtils.numLabels;

      const rangePos = [cll[0], cll[numLabels]];
      const rangePosLargeScale = [cll[0], cll[numLabels - 1]];
      const rangePosSmallScale = [cll[numLabels - 1], cll[numLabels]];

      const rangeNeg = [cll[numLabels + 1], cll[cll.length - 1]];
      const rangeNegLargeScale = [cll[numLabels + 2], cll[cll.length - 1]];
      const rangeNegSmallScale = [cll[numLabels + 1], cll[numLabels + 2]];

      // Attach scales that map from value to lollipop height in display
      let domainFromLargeScale = maxAF / 10 ** (mainTrack.numLabels - 1);
      let domainToLargeScale = maxAF;
      mainTrack.logYScalePosLargeScale = scaleLog()
        .domain([domainFromLargeScale, domainToLargeScale])
        .range([rangePosLargeScale[1], rangePosLargeScale[0]]);
      let domainFromSmallScale = domainFromLargeScale / 1000;
      let domainToSmallScale = domainFromLargeScale;
      mainTrack.logYScalePosSmallScale = scaleLog()
        .domain([domainFromSmallScale, domainToSmallScale])
        .range([rangePosSmallScale[1], rangePosSmallScale[0]]);

      mainTrack.logYScaleNegLargeScale = scaleLog()
        .domain([-domainFromLargeScale, -domainToLargeScale])
        .range([rangeNegLargeScale[0], rangeNegLargeScale[1]]);
      mainTrack.logYScaleNegSmallScale = scaleLog()
        .domain([-domainFromSmallScale, -domainToSmallScale])
        .range([rangeNegSmallScale[0], rangeNegSmallScale[1]]);

      this.variantsInView.forEach((variant) => {
        const xPos = this._xScale(variant.from + 0.5);
        let yPos = 0;
        const deltaAF =
          this.options.controlGroup === 'gnomad2'
            ? variant.deltaAfGnomad2
            : variant.deltaAfGnomad3;
        mainTrack.afGraphics.beginFill(
          this.colorScaleHex[variant.colorCategory],
        );
        if (deltaAF >= 0) {
          yPos = rangePosSmallScale[1];
          if (deltaAF >= domainFromLargeScale) {
            yPos = mainTrack.logYScalePosLargeScale(deltaAF);
          } else if (deltaAF >= domainFromSmallScale) {
            yPos = mainTrack.logYScalePosSmallScale(deltaAF);
          } else {
            yPos = rangePosSmallScale[1]; // corresponds to 0
          }
          // used for mouseover
          variant.xPosLollipop = xPos;
          variant.yPosLollipop = yPos + mainTrack.yOffset - 2;

          this.drawLollipop(
            mainTrack.afGraphics,
            this.colorScaleHex[variant.colorCategory],
            xPos,
            mainTrack.baseLineLevel,
            mainTrack.baseLineLevel - yPos,
          );
        } else {
          yPos = rangeNegSmallScale[0];
          //console.log(variant.from, variant.deltaAf, -domainFromSmallScale, -domainFromLargeScale)
          if (deltaAF <= -domainFromLargeScale) {
            yPos = mainTrack.logYScaleNegLargeScale(deltaAF);
          } else if (deltaAF <= -domainFromSmallScale) {
            yPos = mainTrack.logYScaleNegSmallScale(deltaAF);
          } else {
            yPos = rangeNegSmallScale[0]; // corresponds to 0
          }

          // used for mouseover
          variant.xPosLollipop = xPos;
          variant.yPosLollipop = yPos + mainTrack.yOffset - 2;

          // We are adding 1 to the baseline to account for the thickness of the zero line
          this.drawLollipop(
            mainTrack.afGraphics,
            this.colorScaleHex[variant.colorCategory],
            xPos,
            mainTrack.baseLineLevel + 1,
            mainTrack.baseLineLevel - yPos,
          );
        }
      });
    }

    drawLollipopsFisher(mainTrack) {
      let maxAF = 0;

      this.variantsInView.forEach((variant) => {
        if (this.options.controlGroup === 'gnomad2') {
          if (variant.fisherGnomad2logp !== 'NA') {
            maxAF = Math.max(maxAF, variant.fisherGnomad2logp);
          }
        } else {
          if (variant.fisherGnomad3logp !== 'NA') {
            maxAF = Math.max(maxAF, variant.fisherGnomad3logp);
          }
        }
      });
      // round to closes decimal for legend

      if (maxAF === 0) {
        maxAF = 1;
      } else {
        maxAF = Math.ceil(maxAF);
      }

      mainTrack.legendUtils.resetLegend(mainTrack.legendGraphics);
      mainTrack.legendUtils.createLegend(
        mainTrack.legendGraphics,
        maxAF,
        mainTrack.numLabels,
        0,
        mainTrack.height,
        false,
        true,
      );

      const cll = mainTrack.legendUtils.currentLegendLevels;
      const numLabels = mainTrack.legendUtils.numLabels;
      const rangePos = [cll[0], cll[numLabels]];

      mainTrack.linearYScalePos = scaleLinear()
        .domain([0, maxAF])
        .range([rangePos[1], rangePos[0]]);

      this.variantsInView.forEach((variant) => {
        const xPos = this._xScale(variant.from + 0.5);
        let yPos = mainTrack.baseLineLevel;
        let fisher = -1;
        if (this.options.controlGroup === 'gnomad2') {
          if (variant.fisherGnomad2logp !== 'NA') {
            fisher = variant.fisherGnomad2logp;
          }
        } else {
          if (variant.fisherGnomad3logp !== 'NA') {
            fisher = variant.fisherGnomad3logp;
          }
        }

        mainTrack.afGraphics.beginFill(
          this.colorScaleHex[variant.colorCategory],
        );
        if (fisher >= 0) {
          yPos = mainTrack.linearYScalePos(fisher);
        }
        // used for mouseover
        variant.xPosLollipop = xPos;
        variant.yPosLollipop = yPos + mainTrack.yOffset - 2;

        this.drawLollipop(
          mainTrack.afGraphics,
          this.colorScaleHex[variant.colorCategory],
          xPos,
          mainTrack.baseLineLevel,
          mainTrack.baseLineLevel - yPos,
        );
      });
    }

    drawLollipop(graphics, color, xPos, baseLine, height) {
      const yPos = baseLine - height;
      graphics.beginFill(color, 0.5);
      graphics.drawRect(xPos, yPos, 1, height);
      graphics.beginFill(color, 0.6);
      graphics.drawCircle(xPos, yPos, this.lollipopRadius);
    }

    updateExistingGraphics() {
      this.loadingText.text = 'Rendering...';

      this.createLegendGraphics();
      this.createLabelGraphics();

      if (
        !eqSet(this.visibleTileIds, new Set(Object.keys(this.fetchedTiles)))
      ) {
        this.updateLoadingText();
        return;
      }

      const fetchedTileKeys = Object.keys(this.fetchedTiles);
      fetchedTileKeys.forEach((x) => {
        this.fetching.delete(x);
        this.rendering.add(x);
      });
      this.updateLoadingText();

      this.worker.then((tileFunctions) => {
        tileFunctions
          .renderSegments(
            this.dataFetcher.uid,
            Object.values(this.fetchedTiles).map((x) => x.remoteId),
            this._xScale.domain(),
            this._xScale.range(),
            this.options,
          )
          .then((toRender) => {
            this.loadingText.visible = false;
            fetchedTileKeys.forEach((x) => {
              this.rendering.delete(x);
            });
            this.updateLoadingText();

            this.errorTextText = null;
            this.pBorder.clear();
            this.drawError();
            this.animate();

            this.variantList = toRender.variants;
            this.pMain.x = this.position[0];

            this.drawLollipops();
            this.drawBarCharts();

            this.clearNotification(this.subTracks[0]);
            if (this.maxZoom !== this.calculateZoomLevel()) {
              this.drawNotification(
                this.subTracks[0],
                'Zoom in to see all variants',
              );
            }

            // remove and add again to place on top
            this.pMain.removeChild(this.mouseOverGraphics);
            this.pMain.addChild(this.mouseOverGraphics);

            this.drawnAtScale = HGC.libraries.d3Scale
              .scaleLinear()
              .domain(toRender.xScaleDomain)
              .range(toRender.xScaleRange);

            this.draw();
            this.animate();
          });
      });
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

    draw() {
      this.trackNotFoundText.text = 'Track not found.';
      this.trackNotFoundText.visible = true;
    }

    // HIGLASS CORE NEEDS TO SUPPORT THIS
    onMouseClick() {
      if (!this.mouseClickData) return;

      const chr = this.mouseClickData.chrName;
      const pos = this.mouseClickData.from - this.mouseClickData.chrOffset;

      const props = {
        chr: chr,
        pos: pos,
        dataFetcher: this.variantDetailFetcher,
      };

      const data = {
        title: `Variant ${chr}:${format(',')(pos)}`,
        bodyComponent: VariantDetails,
        bodyProps: props,
      };
      this.showCustomTrackDialog(data);
      this.restoreCursor();
    }

    getMouseOverHtml(trackX, trackYIn) {
      this.mouseOverGraphics.clear();
      requestAnimationFrame(this.animate);
      const trackY = invY(trackYIn, this.valueScaleTransform);
      //const vHeight = this.options.variantHeight * this.valueScaleTransform.k;

      const padding = 2;

      const filteredList = this.variantsInView.filter(
        (variant) =>
          variant.xPosLollipop - this.lollipopRadius - padding <= trackX &&
          trackX <= variant.xPosLollipop + this.lollipopRadius + padding &&
          ((trackY >= variant.yPosLollipop - padding &&
            trackY <=
              variant.yPosLollipop + 2 * this.lollipopRadius + padding) ||
            (trackY >= variant.yRangeRect1[0] &&
              trackY <= variant.yRangeRect1[1]) ||
            (trackY >= variant.yRangeRect2[0] &&
              trackY <= variant.yRangeRect2[1])),
      );

      let mouseOverHtml = ``;

      for (const variant of filteredList) {
        let variantHtml = ``;
        let mostSevereConsequenceHtml = ``;
        let consequenceLevelHtml = ``;
        let positionHtml = ``;
        let alleleCountHtml = ``;
        let alleleFrequencyHtml = ``;
        let alleleNumberHtml = ``;
        const al = 'style="text-align: left !important;"';

        let vRef = variant.ref.match(/.{1,15}/g).join('<br>');
        let vAlt = variant.alt.match(/.{1,15}/g).join('<br>');

        if (variant.category === 'SNV') {
          positionHtml += `${variant.chrName}:${format(',')(
            variant.from - variant.chrOffset,
          )}`;
          mostSevereConsequenceHtml += `Most severe consequence: <strong>${variant.mostSevereConsequence}</strong>`;
          consequenceLevelHtml += `Consequence level: <strong>${this.capitalizeFirstLetter(
            variant.colorCategory.toLowerCase(),
          )}</strong>`;
          const fisherHtml = `Fisher test p-value (-log10): <strong>${
            this.options.controlGroup === 'gnomad2'
              ? variant.fisherGnomad2logp
              : variant.fisherGnomad3logp
          }</strong>`;
          const fisherORHtml = `Fisher test odds ratio: <strong>${
            this.options.controlGroup === 'gnomad2'
              ? variant.fisherGnomad2OR
              : variant.fisherGnomad3OR
          }</strong>`;
          variantHtml += `<td colspan='4' style="text-align: left !important;">
              Variant: <strong>${vRef} &rarr; ${vAlt}</strong> (${positionHtml}) <br/>
              ${mostSevereConsequenceHtml} <br/>
              ${consequenceLevelHtml} <br/>
              ${fisherHtml} <br/>
              ${fisherORHtml}
            </td>`;
        }

        const acGnomad2 =
          variant.alleleCountGnomad2 !== 'NA'
            ? variant.alleleCountGnomad2
            : '-';
        const acGnomad3 =
          variant.alleleCountGnomad3 !== 'NA'
            ? variant.alleleCountGnomad3
            : '-';
        alleleCountHtml += `<td ${al}>${variant.alleleCountCases}</td><td ${al}>${acGnomad2}</td><td ${al}>${acGnomad3}</td>`;
        const afCases =
          Number.parseFloat(variant.alleleFrequencyCases) !== 0
            ? Number.parseFloat(variant.alleleFrequencyCases).toExponential(2)
            : 0;
        let afGnomad2 = '-';
        if (variant.alleleFrequencyGnomad2 !== 'NA') {
          afGnomad2 =
            Number.parseFloat(variant.alleleFrequencyGnomad2) !== 0
              ? Number.parseFloat(variant.alleleFrequencyGnomad2).toExponential(
                  2,
                )
              : 0;
        }
        let afGnomad3 = '-';
        if (variant.alleleFrequencyGnomad3 !== 'NA') {
          afGnomad3 =
            Number.parseFloat(variant.alleleFrequencyGnomad3) !== 0
              ? Number.parseFloat(variant.alleleFrequencyGnomad3).toExponential(
                  2,
                )
              : 0;
        }
        alleleFrequencyHtml += `<td ${al}>${afCases}&nbsp</td><td ${al}>${afGnomad2}&nbsp</td><td ${al}>${afGnomad3}&nbsp</td>`;

        const anGnomad2 =
          variant.alleleNumberGnomad2 !== 'NA'
            ? variant.alleleNumberGnomad2
            : '-';
        const anGnomad3 =
          variant.alleleNumberGnomad3 !== 'NA'
            ? variant.alleleNumberGnomad3
            : '-';
        alleleNumberHtml += `<td ${al}>${variant.alleleNumberCases}&nbsp</td><td ${al}>${anGnomad2}&nbsp</td><td ${al}>${anGnomad3}&nbsp</td>`;

        const borderCss = 'border: 1px solid #333333;';
        mouseOverHtml +=
          `<table style="margin-top:3px;${borderCss}">` +
          `<tr style="background-color:#ececec;margin-top:3px;${borderCss}">${variantHtml}</tr>` +
          `<tr><td ${al}></td><td ${al}>Cases</td><td ${al}>gnomAD v2&nbsp</td><td ${al}>gnomAD v3&nbsp</td></tr>` +
          `<tr><td ${al}>Allele Frequency:</td>${alleleFrequencyHtml}</tr>` +
          `<tr><td ${al}>Allele Count:</td>${alleleCountHtml}</tr>` +
          `<tr><td ${al}>Allele Number:</td>${alleleNumberHtml}</tr>` +
          `</table>`;
      }

      if (filteredList.length > 0) {
        this.setCursor('pointer');
        this.mouseClickData = filteredList[0];

        //return mouseOverHtml;
        return sanitizeHtml(mouseOverHtml, {
          allowedTags: ['table', 'tr', 'td', 'strong', 'br'],
          allowedAttributes: {
            tr: ['style'],
            td: ['colspan', 'style'],
            table: ['style'],
          },
          allowedStyles: {
            tr: {
              'background-color': [
                /^#(0x)?[0-9a-f]+$/i,
                /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/,
              ],
              border: [/^1px solid #333333$/],
            },
            td: {
              'text-align': [/^left$/, /^right$/, /^center$/],
            },
            table: {
              'margin-top': [/^\d+(?:px|em|%)$/],
              border: [/^1px solid #333333$/],
            },
          },
        });
      }

      this.restoreCursor();
      this.mouseClickData = null;
      return '';
    }

    setCursor(style) {
      document.body.style.cursor = style;
    }

    restoreCursor() {
      document.body.style.cursor = 'default';
    }

    capitalizeFirstLetter(string) {
      return string.charAt(0).toUpperCase() + string.slice(1);
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

    zoomed(newXScale, newYScale) {
      super.zoomed(newXScale, newYScale);

      if (this.segmentGraphics) {
        scaleScalableGraphics(
          this.segmentGraphics,
          newXScale,
          this.drawnAtScale,
        );
      }

      this.drawLollipops();
      this.drawBarCharts();

      this.mouseOverGraphics.clear();
      this.animate();
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

      gSegment.setAttribute(
        'transform',
        `translate(${this.segmentGraphics.position.x},${this.segmentGraphics.position.y})` +
          `scale(${this.segmentGraphics.scale.x},${this.segmentGraphics.scale.y})`,
      );

      output.appendChild(gSegment);

      if (this.segmentGraphics) {
        const b64string = HGC.services.pixiRenderer.plugins.extract.base64(
          // this.segmentGraphics, 'image/png', 1,
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

        // gSegment.appendChild(image);
      }

      return [base, base];
    }
  }

  return new CohortTrackClass(...args);
};

const icon =
  '<svg width="16" height="16" xmlns="http://www.w3.org/2000/svg"> <!-- Created with Method Draw - http://github.com/duopixel/Method-Draw/ --> <g> <title>background</title> <rect fill="#fff" id="canvas_background" height="18" width="18" y="-1" x="-1"/> <g display="none" overflow="visible" y="0" x="0" height="100%" width="100%" id="canvasGrid"> <rect fill="url(#gridpattern)" stroke-width="0" y="0" x="0" height="100%" width="100%"/> </g> </g> <g> <title>Layer 1</title> <rect id="svg_1" height="0.5625" width="2.99997" y="3.21586" x="1.18756" stroke-width="1.5" stroke="#999999" fill="#000"/> <rect id="svg_3" height="0.5625" width="2.99997" y="7.71582" x="6.06252" stroke-width="1.5" stroke="#999999" fill="#000"/> <rect id="svg_4" height="0.5625" width="2.99997" y="3.21586" x="1.18756" stroke-width="1.5" stroke="#999999" fill="#000"/> <rect id="svg_5" height="0.5625" width="2.99997" y="3.90336" x="11.49997" stroke-width="1.5" stroke="#f73500" fill="#000"/> <rect id="svg_6" height="0.5625" width="2.99997" y="7.40333" x="11.62497" stroke-width="1.5" stroke="#999999" fill="#000"/> <rect id="svg_7" height="0.5625" width="2.99997" y="13.90327" x="5.93752" stroke-width="1.5" stroke="#f4f40e" fill="#000"/> </g> </svg>';

CohortTrack.config = {
  type: 'cohort',
  datatype: ['vcf'],
  orientation: '1d-horizontal',
  name: 'Cohort Track',
  thumbnail: new DOMParser().parseFromString(icon, 'text/xml').documentElement,
  availableOptions: [
    'colorScale',
    'showMousePosition',
    'variantHeight',
    'maxTileWidth',
    'controlGroup',
    'mainDisplay',
    'variantDetailSource',
    // 'minZoom'
  ],
  defaultOptions: {
    colorScale: [
      {
        level: 'HIGH',
        color: '#ff0000',
      },
      {
        level: 'MODERATE',
        color: '#bf9c00',
      },
      {
        level: 'LOW',
        color: '#51abf5',
      },
      {
        level: 'MODIFIER',
        color: '#db4dff',
      },
    ],
    showMousePosition: false,
    variantHeight: 12,
    maxTileWidth: 2e5,
    controlGroup: 'gnomad2',
    mainDisplay: 'fisher', // 'fisher', 'deltaAF'
  },
  optionsInfo: {},
};

export default CohortTrack;
