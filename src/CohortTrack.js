import VCFDataFetcher from './vcf-fetcher';
import MyWorkerWeb from 'raw-loader!../dist/worker.js';
import { spawn, BlobWorker } from 'threads';
import { PILEUP_COLORS } from './vcf-utils';
import LegendUtils from './legend-utils';
import sanitizeHtml from 'sanitize-html';
import { format } from 'd3-format';
import { scaleLinear, scaleLog } from 'd3-scale';

const createColorTexture = (PIXI, colors) => {
  const colorTexRes = Math.max(2, Math.ceil(Math.sqrt(colors.length)));
  const rgba = new Float32Array(colorTexRes ** 2 * 4);
  colors.forEach((color, i) => {
    // eslint-disable-next-line prefer-destructuring
    rgba[i * 4] = color[0]; // r
    // eslint-disable-next-line prefer-destructuring
    rgba[i * 4 + 1] = color[1]; // g
    // eslint-disable-next-line prefer-destructuring
    rgba[i * 4 + 2] = color[2]; // b
    // eslint-disable-next-line prefer-destructuring
    rgba[i * 4 + 3] = color[3]; // a
  });

  return [PIXI.Texture.fromBuffer(rgba, colorTexRes, colorTexRes), colorTexRes];
};

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
  if (!new.target) {
    throw new Error(
      'Uncaught TypeError: Class constructor cannot be invoked without "new"',
    );
  }

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

      this.subTracks = [];

      this.subTracks.push({
        legendUtils: new LegendUtils(HGC, 40, 200),
        legendGraphics: new HGC.libraries.PIXI.Graphics(),
        infoGraphics: new HGC.libraries.PIXI.Graphics(),
        bgGraphics: new HGC.libraries.PIXI.Graphics(),
        afGraphics: new HGC.libraries.PIXI.Graphics(),
        height: 200,
        yOffset: 5,
        baseLineLevel: 106,
        numLabels: 4
      });

      this.subTracks.push({
        legendUtils: new LegendUtils(HGC, 40, 50),
        legendGraphics: new HGC.libraries.PIXI.Graphics(),
        infoGraphics: new HGC.libraries.PIXI.Graphics(),
        bgGraphics: new HGC.libraries.PIXI.Graphics(),
        afGraphics: new HGC.libraries.PIXI.Graphics(),
        height: 50,
        yOffset: 225,
        baseLineLevel: 0,
        numLabels: 2
      });

      this.subTracks.forEach(subTrack => {
        subTrack.legendGraphics.position.y = subTrack.yOffset;
        subTrack.infoGraphics.position.y = subTrack.yOffset;
        subTrack.afGraphics.position.y = subTrack.yOffset;
        subTrack.bgGraphics.position.y = subTrack.yOffset;
        this.pForeground.addChild(subTrack.legendGraphics);
        this.pForeground.addChild(subTrack.infoGraphics);
        this.pMain.addChild(subTrack.bgGraphics);
        this.pMain.addChild(subTrack.afGraphics);
      });

     
      this.loadingText.x = 40;
      this.loadingText.y = 0;

      this.loadingText.anchor.x = 0;
      this.loadingText.anchor.y = 0;

      this.fetching = new Set();
      this.rendering = new Set();

      this.isShowGlobalMousePosition = context.isShowGlobalMousePosition;

      if (this.options.showMousePosition && !this.hideMousePosition) {
        this.hideMousePosition = HGC.utils.showMousePosition(
          this,
          this.is2d,
          this.isShowGlobalMousePosition(),
        );
      }

      this.pForeground.addChild(this.loadingText);
      this.setUpShaderAndTextures();

    }

    initTile(tile) {
    }

    
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

    setUpShaderAndTextures() {
      const colorDict = PILEUP_COLORS;

      if (this.options && this.options.colorScale) {
        [
          colorDict.VARIANT,
          colorDict.INSERTION,
          colorDict.DELETION,
          colorDict.INVERSION,
          colorDict.DUPLICATION
        ] = this.options.colorScale.map((x) => x);
      }

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

    drawNotification(subtrack, text){
      subtrack.legendUtils.createNotification(subtrack.infoGraphics, this.dimensions[0], text);
    }

    clearNotification(subtrack){
      subtrack.legendUtils.clearNotification(subtrack.infoGraphics);
    }

    createLegendGraphics() {

      const mainTrack = this.subTracks[0];
      mainTrack.legendUtils.resetLegend(mainTrack.legendGraphics);
      mainTrack.legendUtils.createLegend(mainTrack.legendGraphics, 1, mainTrack.numLabels, 0, mainTrack.height/2);
      mainTrack.legendUtils.createLegend(mainTrack.legendGraphics, 1, mainTrack.numLabels, 100, mainTrack.height/2, true);
      mainTrack.legendUtils.setBaseLineLevel(mainTrack.baseLineLevel);
      

      this.subTracks.forEach((subTrack,i) => {
        if(i === 0){
          return;
        }
        subTrack.legendUtils.resetLegend(subTrack.legendGraphics);
        subTrack.legendUtils.createLegend(subTrack.legendGraphics, 1, subTrack.numLabels, 0, subTrack.height);
      });

      this.subTracks.forEach(subTrack => {
        subTrack.legendUtils.drawHorizontalLines(subTrack.bgGraphics, 0, this.dimensions[0]);
      });

    }

    updateVariantsInView(){
      this.variantsInView = [];
      this.variantList.forEach((variant) =>{
        const xPos = this._xScale(variant.from);
        if(xPos > 0 && xPos < this.dimensions[0]){
          this.variantsInView.push(variant);
        }
      });
    }

    drawLollipops(){

      const mainTrack = this.subTracks[0];
      mainTrack.afGraphics.clear();

      this.updateVariantsInView();

      let maxAF = 0;
      //console.log(this.variantsInView)
      this.variantsInView.forEach((variant) =>{
        maxAF = Math.max(maxAF, variant.deltaAfAbs);
      });
      // round to closes decimal for legend
      if(maxAF === 0){
        maxAF = 1e-1;
      }else{
        //console.log(maxAF)
        const m = -Math.floor( Math.log10(maxAF) + 1) + 1;
        const mm = 10 ** m;
        maxAF = Math.ceil(maxAF * mm) / mm
        //console.log(maxAF)
      }
      
      //maxAF = parseFloat(maxAF.toExponential(0));
      
      mainTrack.legendUtils.resetLegend(mainTrack.legendGraphics);

      mainTrack.legendUtils.createLegend(mainTrack.legendGraphics, maxAF, mainTrack.numLabels, 0, mainTrack.height/2);
      mainTrack.legendUtils.createLegend(mainTrack.legendGraphics, maxAF, mainTrack.numLabels, 100, mainTrack.height/2, true);

      //console.log("LegenLevels:", mainTrack.legendUtils.currentLegendLevels);
      const cll = mainTrack.legendUtils.currentLegendLevels;
      const numLabels = mainTrack.legendUtils.numLabels;

      const rangePos = [cll[0], cll[numLabels]];
      const rangePosLargeScale = [cll[0], cll[numLabels-1]];
      const rangePosSmallScale = [cll[numLabels-1], cll[numLabels]];

      const rangeNeg = [cll[numLabels+1], cll[cll.length - 1]];
      const rangeNegLargeScale = [cll[numLabels+2], cll[cll.length - 1]];
      const rangeNegSmallScale = [cll[numLabels+1], cll[numLabels+2]];
      //console.log("RagePos:", rangePos, rangePosLargeScale, rangePosSmallScale)
      //console.log("RageNeg:", rangeNeg, rangeNegLargeScale, rangeNegSmallScale)

      // Attach scales that map from value to lollipop height in display
      let domainFromLargeScale = maxAF / (10 ** (mainTrack.numLabels-1));
      let domainToLargeScale = maxAF;
      mainTrack.logYScalePosLargeScale = scaleLog().domain([domainFromLargeScale, domainToLargeScale]).range([rangePosLargeScale[1], rangePosLargeScale[0]]);
      let domainFromSmallScale = domainFromLargeScale / 1000;
      let domainToSmallScale = domainFromLargeScale;
      mainTrack.logYScalePosSmallScale = scaleLog().domain([domainFromSmallScale, domainToSmallScale]).range([rangePosSmallScale[1], rangePosSmallScale[0]]);

      mainTrack.logYScaleNegLargeScale = scaleLog().domain([-domainFromLargeScale, -domainToLargeScale]).range([rangeNegLargeScale[0], rangeNegLargeScale[1]]);
      mainTrack.logYScaleNegSmallScale = scaleLog().domain([-domainFromSmallScale, -domainToSmallScale]).range([rangeNegSmallScale[0], rangeNegSmallScale[1]]);

      this.variantsInView.forEach((variant) =>{
        const xPos = this._xScale(variant.from+0.5);
        let yPos = 0;
        mainTrack.afGraphics.beginFill(HGC.utils.colorToHex('#ff0000'));
        if(variant.deltaAf >= 0){
          yPos = rangePosSmallScale[1];
          if(variant.deltaAf >= domainFromLargeScale){
            yPos = mainTrack.logYScalePosLargeScale(variant.deltaAf);
          }else if(variant.deltaAf >= domainFromSmallScale){
            yPos = mainTrack.logYScalePosSmallScale(variant.deltaAf);
          }else{
            mainTrack.afGraphics.beginFill(HGC.utils.colorToHex('#000000'));
            yPos = rangePosSmallScale[1]; // corresponds to 0
          }
          // used for mouseover
          variant.xPosLollipop = xPos;
          variant.yPosLollipop = yPos;

          this.drawLollipop(mainTrack.afGraphics, xPos, mainTrack.baseLineLevel, mainTrack.baseLineLevel - yPos);
        }
        else{
          yPos = rangeNegSmallScale[0];
          mainTrack.afGraphics.beginFill(HGC.utils.colorToHex('#0000ff'));
          //console.log(variant.from, variant.deltaAf, -domainFromSmallScale, -domainFromLargeScale)
          if(variant.deltaAf <= -domainFromLargeScale){
            yPos = mainTrack.logYScaleNegLargeScale(variant.deltaAf);
          }else if(variant.deltaAf <= -domainFromSmallScale){
            yPos = mainTrack.logYScaleNegSmallScale(variant.deltaAf);
          }else{
            mainTrack.afGraphics.beginFill(HGC.utils.colorToHex('#00ff00'));
            yPos = rangeNegSmallScale[0]; // corresponds to 0
          }

          // used for mouseover
          variant.xPosLollipop = xPos;
          variant.yPosLollipop = yPos + 1 + this.lollipopRadius;
          
          // We are adding 1 to the baseline to account for the thickness of the zero line
          this.drawLollipop(mainTrack.afGraphics, xPos, mainTrack.baseLineLevel+1, mainTrack.baseLineLevel - yPos);
        }

      })


    }

    drawLollipop(graphics, xPos, baseLine, height){
      const yPos = baseLine - height;
      graphics.drawRect(xPos, yPos, 1, height);
      graphics.drawCircle(xPos, yPos, this.lollipopRadius);
    }

    updateExistingGraphics() {
      this.loadingText.text = 'Rendering...';

      this.createLegendGraphics();
     
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

            // this.positions = new Float32Array(toRender.positionsBuffer);
            // this.colors = new Float32Array(toRender.colorsBuffer);
            // this.ixs = new Int32Array(toRender.ixBuffer);



            this.variantList = toRender.variants;


            this.pMain.x = this.position[0];

            this.drawLollipops();

            if(this.variantList && this.variantList.length > 0){
              if(!this.variantList[0]['multiresChrName'].endsWith("_0")){
                this.drawNotification(this.subTracks[0], "Zoom in to see all variants");
              }else{
                this.clearNotification(this.subTracks[0]);
              }
            }
            

            

            //console.log(this.variantList, this.zoomLevel)

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
        // this.loadingText.text = `Fetching... ${[...this.fetching]
        //   .map((x) => x.split('|')[0])
        //   .join(' ')}`;
      }

      if (this.rendering.size) {
        this.loadingText.text = 'Rendering data...';
        //this.loadingText.text = `Rendering... ${[...this.rendering].join(' ')}`;
      }

      if (!this.fetching.size && !this.rendering.size) {
        this.loadingText.visible = false;
      }
    }

    draw() {
      this.trackNotFoundText.text = 'Track not found.';
      this.trackNotFoundText.visible = true;
    }

    getMouseOverHtml(trackX, trackYIn) {

      this.mouseOverGraphics.clear();
      // Prevents 'stuck' read outlines when hovering quickly
      requestAnimationFrame(this.animate);
      const trackY = invY(trackYIn, this.valueScaleTransform);
      //const vHeight = this.options.variantHeight * this.valueScaleTransform.k;

      const padding = 2;

      const filteredList = this.variantsInView.filter(
        (variant) =>
          variant.xPosLollipop - this.lollipopRadius - padding <= trackX &&
          trackX <= variant.xPosLollipop + this.lollipopRadius + padding &&
          trackY >= variant.yPosLollipop - padding &&
          trackY <= variant.yPosLollipop + 2*this.lollipopRadius + padding,
      );
      // console.log(trackX);
      // console.log(this.variantsInView);
      // console.log(filteredList);

      
      let mouseOverHtml = ``;
  
      for (const variant of filteredList) {

        let variantHtml = ``;
        let positionHtml = ``;
        let alleleCountHtml = ``;
        let alleleFrequencyHtml = ``;
        let alleleNumberHtml = ``;
        console.log(variant)

        let vRef = variant.ref.match(/.{1,15}/g).join('<br>');
        let vAlt = variant.alt.match(/.{1,15}/g).join('<br>');

        if(variant.category === "SNV"){
          positionHtml += `${variant.chrName}:${
            format(',')(variant.from - variant.chrOffset)
          }`;
          variantHtml += `<td colspan='3'>Variant: <strong>${vRef} &rarr; ${vAlt}</strong> (${positionHtml})</td>`;

        } 

        alleleCountHtml += `<td>${variant.alleleCountCases}</td><td>${variant.alleleCountControl}</td>`;
        const afCases = Number.parseFloat(variant.alleleFrequencyCases) !== 0 ? Number.parseFloat(variant.alleleFrequencyCases).toExponential(2) : 0;
        const afControl = Number.parseFloat(variant.alleleFrequencyControl) !== 0 ? Number.parseFloat(variant.alleleFrequencyControl).toExponential(2) : 0;
        alleleFrequencyHtml += `<td>${afCases}&nbsp</td><td>${afControl}&nbsp</td>`;
        alleleNumberHtml += `<td>${variant.alleleNumberCases}&nbsp</td><td>${variant.alleleNumberControl}&nbsp</td>`;

        const borderCss = 'border: 1px solid #333333;';
        mouseOverHtml +=
          `<table style="margin-top:3px;${borderCss}">` +
            `<tr style="background-color:#ececec;margin-top:3px;${borderCss}">${variantHtml}</tr>` +
            `<tr><td></td><td>Cases</td><td>Control</td></tr>` +
            `<tr><td>Allele Frequency:</td>${alleleFrequencyHtml}</tr>` +
            `<tr><td>Allele Count:</td>${alleleCountHtml}</tr>` +
            `<tr><td>Allele Number:</td>${alleleNumberHtml}</tr>` +
          `</table>`;
        
      }

      if (filteredList.length > 0) {
        
        //return mouseOverHtml;
        return sanitizeHtml(mouseOverHtml,{
          allowedTags: ['table','tr','td','strong'],
          allowedAttributes: {
            'tr': ["style"],
            'td': ["colspan"],
            'table': ["style"],
          },
          allowedStyles: {
            'tr': {
              'background-color': [/^#(0x)?[0-9a-f]+$/i, /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/],
              'border': [/^1px solid #333333$/],
            },
            'table': {
              'margin-top': [/^\d+(?:px|em|%)$/],
              'border': [/^1px solid #333333$/],
            }
          }
        });
      }

      return '';
    }

    capitalizeFirstLetter(string) {
      return string.charAt(0).toUpperCase() + string.slice(1);
    }

    calculateZoomLevel() {
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

        const DEFAULT_MAX_TILE_WIDTH = this.options.maxTileWidth || 2e5;

        if (
          tileWidth > DEFAULT_MAX_TILE_WIDTH
        ) {
          this.errorTextText = 'Zoom in to see details';
          this.drawError();
          this.animate();
          return;
        }

        this.errorTextText = null;
        this.pBorder.clear();
        this.drawError();
        this.animate();
      }

      this.setVisibleTiles(tiles);
    }

    setPosition(newPosition) {
      super.setPosition(newPosition);

      [this.pMain.position.x, this.pMain.position.y] = this.position;
      [this.pMouseOver.position.x, this.pMouseOver.position.y] = this.position;

      // [this.loadingText.x, this.loadingText.y] = newPosition;
      // this.loadingText.x += 30;
    }

    movedY(dY) {
      const vst = this.valueScaleTransform;
      const height = this.dimensions[1];

      // clamp at the bottom and top
      if (
        vst.y + dY / vst.k > -(vst.k - 1) * height &&
        vst.y + dY / vst.k < 0
      ) {
        this.valueScaleTransform = vst.translate(0, dY / vst.k);
      }

      // this.segmentGraphics may not have been initialized if the user
      // was zoomed out too far
      if (this.segmentGraphics) {
        this.segmentGraphics.position.y = this.valueScaleTransform.y;
      }

      this.animate();
    }

    zoomedY(yPos, kMultiplier) {
      const newTransform = HGC.utils.trackUtils.zoomedY(
        yPos,
        kMultiplier,
        this.valueScaleTransform,
        this.dimensions[1],
      );

      this.valueScaleTransform = newTransform;
      this.segmentGraphics.scale.y = newTransform.k;
      this.segmentGraphics.position.y = newTransform.y;

      this.mouseOverGraphics.clear();
      this.animate();
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

const icon = '<svg width="16" height="16" xmlns="http://www.w3.org/2000/svg"> <!-- Created with Method Draw - http://github.com/duopixel/Method-Draw/ --> <g> <title>background</title> <rect fill="#fff" id="canvas_background" height="18" width="18" y="-1" x="-1"/> <g display="none" overflow="visible" y="0" x="0" height="100%" width="100%" id="canvasGrid"> <rect fill="url(#gridpattern)" stroke-width="0" y="0" x="0" height="100%" width="100%"/> </g> </g> <g> <title>Layer 1</title> <rect id="svg_1" height="0.5625" width="2.99997" y="3.21586" x="1.18756" stroke-width="1.5" stroke="#999999" fill="#000"/> <rect id="svg_3" height="0.5625" width="2.99997" y="7.71582" x="6.06252" stroke-width="1.5" stroke="#999999" fill="#000"/> <rect id="svg_4" height="0.5625" width="2.99997" y="3.21586" x="1.18756" stroke-width="1.5" stroke="#999999" fill="#000"/> <rect id="svg_5" height="0.5625" width="2.99997" y="3.90336" x="11.49997" stroke-width="1.5" stroke="#f73500" fill="#000"/> <rect id="svg_6" height="0.5625" width="2.99997" y="7.40333" x="11.62497" stroke-width="1.5" stroke="#999999" fill="#000"/> <rect id="svg_7" height="0.5625" width="2.99997" y="13.90327" x="5.93752" stroke-width="1.5" stroke="#f4f40e" fill="#000"/> </g> </svg>';

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
    'maxTileWidth'
    // 'minZoom'
  ],
  defaultOptions: {
    colorScale: [
      // Variant, Insertion, Deletion, Inversion, Duplication
      [0.3, 0.3, 0.3, 0.6],
      [0.6, 0.6, 0.0, 0.7],
      [1, 0.0, 0.0, 0.55],
      [0.68, 0.23, 0.87, 0.8],
      [0.27, 0.64, 0.09, 0.8]
    ],
    showMousePosition: false,
    variantHeight: 12,
    maxTileWidth: 2e5
  },
  optionsInfo: {
    
    colorScale: {
      name: 'Color scheme',
      inlineOptions: {
        default: {
          value: [
            // Variant, Insertion, Deletion, Inversion, Duplication
            [0.3, 0.3, 0.3, 0.6],
            [0.6, 0.6, 0.0, 0.7],
            [1, 0.0, 0.0, 0.55],
            [0.68, 0.23, 0.87, 0.8],
            [0.27, 0.64, 0.09, 0.8]
          ],
          name: 'Default',
        },
      },
    },
  },
};

export default CohortTrack;
