import VCFDataFetcher from './vcf-fetcher';
import MyWorkerWeb from 'raw-loader!../dist/cohort-worker.js';
import { spawn, BlobWorker } from 'threads';
import { COLORS } from './vcf-utils';
import LegendUtils from './legend-utils';
import VariantDetailsMSA from './VariantDetailsMSA';
import VariantDetailsUDN from './VariantDetailsUDN';
import VariantDetailFetcher from './variant-detail-fetcher';
import { format } from 'd3-format';
import { scaleLinear, scaleLog } from 'd3-scale';
import { SUPPORTED_PROJECTS } from './config';
import {
  setCursor,
  restoreCursor,
  invY,
  eqSet,
  sanitizeMouseOverHtml,
} from './misc-utils';
import {
  getMouseoverHtmlMSA,
  getMouseoverHtmlUDN,
  getMouseoverHtmlGeneric,
} from './mouseover-utils';
import { applyValueTransform } from './vcf-utils';
import BaseTrack from './BaseTrack';

//const CohortTrack = (HGC, ...args) => {
function CohortTrack(HGC, ...args) {
  class CohortTrackClass extends BaseTrack(HGC, ...args) {
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

      this.loadingText.x = 40;
      this.loadingText.y = 0;

      this.loadingText.anchor.x = 0;
      this.loadingText.anchor.y = 0;

      this.fetching = new Set();
      this.rendering = new Set();

      this.mouseClickData = null;

      this.isShowGlobalMousePosition = context.isShowGlobalMousePosition;

      this.initSubTracks();

      this.colorScaleHex = {};
      this.options.colorScale.scale.forEach((cs) => {
        this.colorScaleHex[cs['value']] = HGC.utils.colorToHex(cs['color']);
      });

      this.variantDetailFetcher = null;
      if (this.options.variantDetailSource) {
        this.variantDetailFetcher = new VariantDetailFetcher(
          this.options.variantDetailSource,
        );
      }

      this.geneSegmentHoveredHandlerBound =
        this.geneSegmentHoveredHandler.bind(this);
      this.pubSub.subscribe(
        'geneSegmentHovered',
        this.geneSegmentHoveredHandlerBound,
      );
      this.highlightedSnps = [];

      this.prevOptions = Object.assign({}, options);
    }

    initSubTracks() {
      this.subTracks = [];
      this.pForeground.removeChildren();
      this.pForeground.clear();
      this.pForeground.addChild(this.loadingText);
      this.pMain.removeChildren();
      this.pMain.clear();

      const mainTrackHeight = 100;
      this.subTracks.push({
        legendUtils: new LegendUtils(this.HGC, 70, mainTrackHeight),
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

      // this.pubSub.publish('trackDimensionsModified', {
      //   height: curYOffset + 20,
      //   resizeParentDiv: true,
      //   trackId: this.trackId,
      //   viewId: this.viewId,
      // });
    }

    rerender(options) {
      super.rerender(options);
      this.options = options;
      
      this.createLabelGraphics();
      this.updateExistingGraphics();
      this.prevOptions = Object.assign({}, options);
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
      this.options.colorScale.scale.forEach((cs) => {
        colorScaleHex.push({
          level: cs['value'],
          colorHex: HGC.utils.colorToHex(cs['color']),
        });
      });

      this.subTracks.forEach((subTrack) => {
        subTrack.legendUtils.drawLabel(
          subTrack.labelGraphics,
          this.dimensions[0],
          subTrack.id,
          colorScaleHex,
          this.options.colorScaleLegend,
        );
      });

      if(this.options["yAxisLabel"] && this.options["yAxisLabel"]["visible"]){
        const mainTrack = this.subTracks[0];
        mainTrack.legendUtils.drawAxisLabel(
          mainTrack.labelGraphics,
          this.options["yAxisLabel"]["text"],
        );
      }
      
    }

    drawHorizontalLines() {
      const mainTrack = this.subTracks[0];
      mainTrack.legendUtils.setBaseLineLevel(mainTrack.baseLineLevel);

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
        if (
          xPos > 0 &&
          xPos < this.dimensions[0]
        ) {
          this.variantsInView.push(variant);
        }
      });
    }


    drawLollipops() {
      const mainTrack = this.subTracks[0];
      mainTrack.afGraphics.clear();
      this.updateVariantsInView();
      this.drawLollipopsFisher(mainTrack);
    }

    drawLollipopsFisher(mainTrack) {
      let maxAF = 0;
      const yValueField = this.options['yValue']['field'];
      const valueTransform = this.options['yValue']['transform'];
      const colorField = this.options['colorScale']['field'];

      this.variantsInView.forEach((variant) => {
        const transValue = applyValueTransform(variant[yValueField], valueTransform);
        maxAF = Math.max(maxAF, transValue);
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
        let yValue = applyValueTransform(variant[yValueField], valueTransform);

        mainTrack.afGraphics.beginFill(
          this.colorScaleHex[variant[colorField]],
        );
        yPos = mainTrack.linearYScalePos(yValue);
        // used for mouseover
        variant.xPosLollipop = xPos;
        variant.yPosLollipop = yPos + mainTrack.yOffset - 2;

        let alphaLevel = 0.5;
        if(this.highlightedSnps.length > 0){
          alphaLevel = 0.1;
          if(this.highlightedSnps.includes(variant.id)){
            alphaLevel = 0.9;
          }
        }
        
        this.drawLollipop(
          mainTrack.afGraphics,
          this.colorScaleHex[variant[colorField]],
          alphaLevel,
          xPos,
          mainTrack.baseLineLevel,
          mainTrack.baseLineLevel - yPos,
        );
      });
    }

    drawLollipop(graphics, color, alphaLevel, xPos, baseLine, height) {
      const yPos = baseLine - height;
      graphics.beginFill(color, alphaLevel);
      graphics.drawRect(xPos, yPos, 1, height);
      graphics.beginFill(color, alphaLevel + 0.1);
      graphics.drawCircle(xPos, yPos, this.lollipopRadius);
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
          .retrieveSegments(
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
            this.drawHorizontalLines();

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

    clickDialog() {
      if (!this.mouseClickData) return;
      const chr = this.mouseClickData.chrName;
      const pos = this.mouseClickData.from - this.mouseClickData.chrOffset;

      const props = {
        chr: chr,
        pos: pos,
        variantInfo: this.mouseClickData,
        dataFetcher: this.variantDetailFetcher || null,
      };

      restoreCursor();
      if(this.options.project === "MSA"){
        return {
          title: `Variant ${chr}:${format(',')(pos)}`,
          bodyComponent: VariantDetailsMSA,
          bodyProps: props,
        };
      }else if(this.options.project === "UDN"){
        return {
          title: `Variant ${chr}:${format(',')(pos)}`,
          bodyComponent: VariantDetailsUDN,
          bodyProps: props,
        };
      }
      return "";
    }

    getMouseOverHtml(trackX, trackYIn) {
      this.mouseOverGraphics.clear();
      //requestAnimationFrame(this.animate);
      const trackY = invY(trackYIn, this.valueScaleTransform);
      //const vHeight = this.options.variantHeight * this.valueScaleTransform.k;

      const padding = 2;

      let filteredList = [];
      filteredList = this.variantsInView.filter(
        (variant) =>
          variant.xPosLollipop - this.lollipopRadius - padding <= trackX &&
          trackX <= variant.xPosLollipop + this.lollipopRadius + padding &&
          trackY >= variant.yPosLollipop - padding &&
          trackY <= variant.yPosLollipop + 2 * this.lollipopRadius + padding,
      );

      if(filteredList.length === 0){
        restoreCursor();
        this.mouseClickData = null;
        return '';
      }

      let mouseOverHtml = ``;

      if(this.options.project === "MSA"){
        mouseOverHtml = getMouseoverHtmlMSA(filteredList, this.options);
        setCursor('pointer');
        this.mouseClickData = filteredList[0];
      }else if(this.options.project === "UDN"){
        mouseOverHtml = getMouseoverHtmlUDN(filteredList, this.options);
        setCursor('pointer');
        this.mouseClickData = filteredList[0];
      }else{
        mouseOverHtml = getMouseoverHtmlGeneric(filteredList, this.options);
      }

      return sanitizeMouseOverHtml(mouseOverHtml);
    }

    geneSegmentHoveredHandler(settings) {
      const includedSnps = settings.includedSnps;
      const newSnps = includedSnps || [];
      if(newSnps.length !== this.highlightedSnps.length){
        this.highlightedSnps = newSnps;
        this.drawLollipops();
      }
    }

    zoomed(newXScale, newYScale) {
      super.zoomed(newXScale, newYScale);
      this.drawLollipops();
      this.mouseOverGraphics.clear();
      this.animate();
    }
  }

  return new CohortTrackClass(...args);
}

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
    'colorScaleLegend',
    'showMousePosition',
    'variantHeight',
    'variantDetailSource',
    'colorScaleLegend',
    'infoFields',
    'filter',
    'yAxisLabel',
    'project'
    // 'minZoom'
  ],
  defaultOptions: {
    showMousePosition: false,
    variantHeight: 12,
    infoFields: [],
    filter: [],
    yAxisLabel: {
      "visible": true,
      "text": "-log10 (p-value)",
    },
  },
  optionsInfo: {
  },
};

export default CohortTrack;
