import VCFDataFetcher from './vcf-fetcher';
import MyWorkerWeb from 'raw-loader!../dist/genelist-worker.js';
import { spawn, BlobWorker } from 'threads';
import { COLORS } from './vcf-utils';
import LegendUtils from './legend-utils';
import VariantDetails from './VariantDetails';
import VariantDetailFetcher from './variant-detail-fetcher';
import { format } from 'd3-format';
import { scaleLinear, scaleLog } from 'd3-scale';
import {
  setCursor,
  restoreCursor,
  capitalizeFirstLetter,
  scaleScalableGraphics,
  getTilePosAndDimensions,
  invY,
  eqSet,
  all,
  isIn,
  sanitizeMouseOverHtml,
  createColorTexture
} from './misc-utils';
import BaseTrack from './BaseTrack';



const GeneListTrack = (HGC, ...args) => {
  class GeneListTrackClass extends BaseTrack(HGC, ...args) {
    constructor(context, options) {
      const worker = spawn(BlobWorker.fromText(MyWorkerWeb));
      // this is where the threaded tile fetcher is called
      context.dataFetcher = new VCFDataFetcher(
        context.dataConfig,
        worker,
        HGC,
        options,
      );
      super(context, options);
      context.dataFetcher.track = this;

      this.worker = worker;
      this.valueScaleTransform = HGC.libraries.d3Zoom.zoomIdentity;
      this.HGC = HGC;

      this.trackId = this.id;
      this.viewId = context.viewUid;

      // we scale the entire view up until a certain point
      // at which point we redraw everything to get rid of
      // artifacts
      // this.drawnAtScale keeps track of the scale at which
      // we last rendered everything
      this.drawnAtScale = HGC.libraries.d3Scale.scaleLinear();
      this.visibleSegments = [];

      // graphics for highliting reads under the cursor
      this.mouseOverGraphics = new HGC.libraries.PIXI.Graphics();
      this.loadingText = new HGC.libraries.PIXI.Text('Initializing...', {
        fontSize: '12px',
        fontFamily: 'Arial',
        fill: 'grey',
      });

      this.loadingText.x = 70;
      this.loadingText.y = 0;
      this.loadingText.anchor.x = 0;
      this.loadingText.anchor.y = 0;

      this.fetching = new Set();
      this.rendering = new Set();

      this.initTrack();
      this.setUpShaderAndTextures();

      this.prevOptions = Object.assign({}, options);
    }

    initTrack() {
      this.pForeground.removeChildren();
      this.pForeground.clear();
      this.pForeground.addChild(this.loadingText);
      this.pMain.removeChildren();
      this.pMain.clear();

      this.legendGraphics = new this.HGC.libraries.PIXI.Graphics();
      this.segmentGraphics = new this.HGC.libraries.PIXI.Graphics();
      this.bgGraphics = new this.HGC.libraries.PIXI.Graphics();
      this.pForeground.addChild(this.legendGraphics);
      this.pMain.addChild(this.bgGraphics);
      this.pMain.addChild(this.segmentGraphics);

      this.legendUtils = new LegendUtils(this.HGC, 70, 1);
    }

    setUpShaderAndTextures() {
      const colorDict = COLORS;

      // if (this.options && this.options.colorScale) {
      //   [
      //     colorDict.INSERTION,
      //     colorDict.DELETION,
      //     colorDict.INVERSION,
      //     colorDict.TRANSLOCATION,
      //     colorDict.DUPLICATION,
      //   ] = this.options.colorScale.map((x) => x);
      // }

      const colors = Object.values(colorDict);

      const [colorMapTex, colorMapTexRes] = createColorTexture(
        HGC.libraries.PIXI,
        colors,
      );
      const uniforms = new HGC.libraries.PIXI.UniformGroup({
        uColorMapTex: colorMapTex,
        uColorMapTexRes: colorMapTexRes,
      });
      this.shader = HGC.libraries.PIXI.Shader.from(
        `
    attribute vec2 position;
    attribute float aColorIdx;

    uniform mat3 projectionMatrix;
    uniform mat3 translationMatrix;

    uniform sampler2D uColorMapTex;
    uniform float uColorMapTexRes;

    varying vec4 vColor;

    void main(void)
    {
        // Half a texel (i.e., pixel in texture coordinates)
        float eps = 0.5 / uColorMapTexRes;
        float colorRowIndex = floor((aColorIdx + eps) / uColorMapTexRes);
        vec2 colorTexIndex = vec2(
          (aColorIdx / uColorMapTexRes) - colorRowIndex + eps,
          (colorRowIndex / uColorMapTexRes) + eps
        );
        vColor = texture2D(uColorMapTex, colorTexIndex);

        gl_Position = vec4((projectionMatrix * translationMatrix * vec3(position, 1.0)).xy, 0.0, 1.0);
    }

`,
        `
varying vec4 vColor;

    void main(void) {
        gl_FragColor = vColor;
    }
`,
        uniforms,
      );
    }

    rerender(options) {
      super.rerender(options);
      this.options = options;
      this.setUpShaderAndTextures();
      this.updateExistingGraphics();
      this.prevOptions = Object.assign({}, options);
    }

    createLegendGraphics(maxValue) {
      this.legendHeight = this.dimensions[1] - 10;
      this.legendVerticalOffset = 0;
      const trackWidth = this.dimensions[0];
      this.legendUtils.setLegendHeight(this.legendHeight);
      this.legendUtils.resetLegend(this.legendGraphics);
      this.legendUtils.createLegend(
        this.legendGraphics,
        maxValue,
        4,
        this.legendVerticalOffset,
        this.legendHeight,
        false,
        true,
      );
      const labelText = this.options.defaultStatistic + " (-log10 p)";
      this.legendUtils.drawAxisLabel(this.legendGraphics, labelText);
      this.legendUtils.drawHorizontalLines(this.bgGraphics, 0, trackWidth);
    }

    updateExistingGraphics() {
      this.loadingText.text = 'Rendering...';

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
            this.legendUtils.currentLegendLevels // needed do that we draw the rects at the appropriate yLevels
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

            this.createLegendGraphics(toRender.defaultStatMax);

            this.positions = new Float32Array(toRender.positionsBuffer);
            this.colors = new Float32Array(toRender.colorsBuffer);
            this.ixs = new Int32Array(toRender.ixBuffer);

            const newGraphics = new HGC.libraries.PIXI.Graphics();

            const geometry = new HGC.libraries.PIXI.Geometry().addAttribute(
              'position',
              this.positions,
              2,
            ); // x,y
            geometry.addAttribute('aColorIdx', this.colors, 1);
            geometry.addIndex(this.ixs);

            if (this.positions.length) {
              const state = new HGC.libraries.PIXI.State();
              const mesh = new HGC.libraries.PIXI.Mesh(
                geometry,
                this.shader,
                state,
              );

              newGraphics.addChild(mesh);
            }

            this.visibleSegments = toRender.segments;
            this.pMain.x = this.position[0];

            if (this.segmentGraphics) {
              this.pMain.removeChild(this.segmentGraphics);
            }

            this.pMain.addChild(newGraphics);
            this.segmentGraphics = newGraphics;

            // remove and add again to place on top
            this.pMain.removeChild(this.mouseOverGraphics);
            this.pMain.addChild(this.mouseOverGraphics);

            this.drawnAtScale = HGC.libraries.d3Scale
              .scaleLinear()
              .domain(toRender.xScaleDomain)
              .range(toRender.xScaleRange);

            scaleScalableGraphics(
              this.segmentGraphics,
              this._xScale,
              this.drawnAtScale,
            );

            this.animate();
          });
      });
    }

    getMouseOverHtml(trackX, trackY) {

      this.mouseOverGraphics.clear();
      requestAnimationFrame(this.animate);

      const padding = 2;
      let filteredList = [];
      const fromX = this.drawnAtScale()
      filteredList = this.visibleSegments.filter(
        (variant) =>
          trackY >= variant.fromY &&
          trackY <= variant.toY &&
          this._xScale(variant.from) <= trackX + padding &&
          trackX <= this._xScale(variant.to) + padding,
      );

      if(filteredList.length === 0){
        return;
      }

      let mouseOverHtml = ``;

      for (const segment of filteredList) {
        let statHtml = ``;

        const al = 'style="text-align: left !important;"';
        this.options.availableStatistics.forEach(stat => {
          statHtml += `<tr><td ${al}>${stat}</td><td ${al}>${segment[stat]}</td></tr>`;
        });

        const borderCss = 'border: 1px solid #333333;';

        let isSignificantHtml = ``;
        if(segment.isSignificant){
          isSignificantHtml = `<tr><td style="color:#027a02;padding-top:5px;text-align: left !important;" colspan="2"><strong>Statistically significant</strong></td></tr>`
        }

        mouseOverHtml +=
          `<table style="margin-top:3px;${borderCss}">` +
          `<tr style="background-color:#ececec;margin-top:3px;${borderCss}"><td ${al} colspan="2"><strong>Gene:</strong> ${segment.geneName} (${segment.geneId})</td></tr>` +
          `<tr><td ${al} colspan="2"><strong>Association tests (-log10 p):</td></tr>` +
          statHtml +
          isSignificantHtml +
          `</table>`;
      }

      if (filteredList.length > 0) {
        //setCursor('pointer');
        //this.mouseClickData = filteredList[0];
        return sanitizeMouseOverHtml(mouseOverHtml);
      }

      restoreCursor();
      this.mouseClickData = null;
      return '';
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

      this.mouseOverGraphics.clear();
      this.animate();
    }
  }

  return new GeneListTrackClass(...args);
};

const icon =
  '<svg width="16" height="16" xmlns="http://www.w3.org/2000/svg"> <!-- Created with Method Draw - http://github.com/duopixel/Method-Draw/ --> <g> <title>background</title> <rect fill="#fff" id="canvas_background" height="18" width="18" y="-1" x="-1"/> <g display="none" overflow="visible" y="0" x="0" height="100%" width="100%" id="canvasGrid"> <rect fill="url(#gridpattern)" stroke-width="0" y="0" x="0" height="100%" width="100%"/> </g> </g> <g> <title>Layer 1</title> <rect id="svg_1" height="0.5625" width="2.99997" y="3.21586" x="1.18756" stroke-width="1.5" stroke="#999999" fill="#000"/> <rect id="svg_3" height="0.5625" width="2.99997" y="7.71582" x="6.06252" stroke-width="1.5" stroke="#999999" fill="#000"/> <rect id="svg_4" height="0.5625" width="2.99997" y="3.21586" x="1.18756" stroke-width="1.5" stroke="#999999" fill="#000"/> <rect id="svg_5" height="0.5625" width="2.99997" y="3.90336" x="11.49997" stroke-width="1.5" stroke="#f73500" fill="#000"/> <rect id="svg_6" height="0.5625" width="2.99997" y="7.40333" x="11.62497" stroke-width="1.5" stroke="#999999" fill="#000"/> <rect id="svg_7" height="0.5625" width="2.99997" y="13.90327" x="5.93752" stroke-width="1.5" stroke="#f4f40e" fill="#000"/> </g> </svg>';

GeneListTrack.config = {
  type: 'geneList',
  datatype: ['vcf'],
  orientation: '1d-horizontal',
  name: 'Gene list Track',
  thumbnail: new DOMParser().parseFromString(icon, 'text/xml').documentElement,
  availableOptions: [
    'showMousePosition',
    'segmentHeight',
    'availableStatistics',
    'defaultStatistic',
    'includedGenes'
  ],
  defaultOptions: {
    showMousePosition: false,
    segmentHeight: 12,
    availableStatistics: ['CMC', 'MB', 'VT', 'SKATO'],
    defaultStatistic: 'CMC'
  },
  optionsInfo: {},
};

export default GeneListTrack;
