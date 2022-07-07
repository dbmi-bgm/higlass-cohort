import { expose, Transfer } from 'threads/worker';
import { scaleLinear } from 'd3-scale';
import LRU from 'lru-cache';
import slugid from 'slugid';
import {
  fetchTilesDebouncedBase,
  tilesetInfoBase,
  initBase,
} from './tileset-utils';
import { COLOR_IXS } from './vcf-utils';

function currTime() {
  const d = new Date();
  return d.getTime();
}

const MAX_VISIBLE_GENES = 500;

const vcfRecordToJson = (vcfRecord, chrName, options, chrOffset) => {
  const info = vcfRecord['INFO'];
  const segment = {
    id: vcfRecord.ID[0],
    geneId: vcfRecord.ID[0],
    geneName: info.NAME[0],
    chrName,
    chrOffset,
    from: vcfRecord.POS + chrOffset,
    to: info.END[0] + chrOffset,
  };
  options.availableStatistics.forEach((t) => {
    segment[t] = info[t][0];
  });

  return segment;
};

// promises indexed by urls
const vcfFiles = {};
const vcfHeaders = {};
const tbiVCFParsers = {};

const MAX_TILES = 20;

// promises indexed by url
const chromSizes = {};
const chromInfos = {};
const tileValues = new LRU({ max: MAX_TILES });
const tilesetInfos = {};
let trackOptions = {};

// indexed by uuid
const dataConfs = {};

const init = (uid, vcfUrl, tbiUrl, chromSizesUrl, tOptions) => {
  initBase(
    uid,
    vcfUrl,
    tbiUrl,
    chromSizesUrl,
    vcfFiles, // passed and filled by reference
    vcfHeaders, // passed and filled by reference
    chromSizes, // passed and filled by reference
    dataConfs, // passed and filled by reference
  );
  trackOptions = tOptions;
};

const tilesetInfo = (uid) => {
  return tilesetInfoBase(
    uid,
    dataConfs,
    chromSizes,
    vcfHeaders,
    tbiVCFParsers,
    chromInfos, // passed and filled by reference
    tilesetInfos, // passed and filled by reference
  );
};

const tile = async (uid, z, x) => {
  const { vcfUrl, chromSizesUrl } = dataConfs[uid];
  const vcfFile = vcfFiles[vcfUrl];

  return tilesetInfo(uid).then((tsInfo) => {
    const tileWidth = +tsInfo.max_width / 2 ** +z;
    const recordPromises = [];

    // get the bounds of the tile
    let minX = tsInfo.min_pos[0] + x * tileWidth;
    const maxX = tsInfo.min_pos[0] + (x + 1) * tileWidth;

    const chromInfo = chromInfos[chromSizesUrl];
    const { chromLengths, cumPositions } = chromInfo;
    const variants = [];

    for (let i = 0; i < cumPositions.length; i++) {
      const chromName = cumPositions[i].chr;
      //const multires_chromName = chromName + '_' + (tsInfo.max_zoom - z);
      const chromStart = cumPositions[i].pos;
      const chromEnd = cumPositions[i].pos + chromLengths[chromName];
      tileValues.set(`${uid}.${z}.${x}`, []);

      if (chromStart <= minX && minX < chromEnd) {
        // start of the visible region is within this chromosome

        if (maxX > chromEnd) {
          // the visible region extends beyond the end of this chromosome
          // fetch from the start until the end of the chromosome
          const startPos = minX - chromStart;
          const endPos = chromEnd - chromStart;
          recordPromises.push(
            vcfFile.getLines(chromName, startPos, endPos, (line) => {
              const vcfRecord = tbiVCFParsers[vcfUrl].parseLine(line);
              const vcfJson = vcfRecordToJson(
                vcfRecord,
                chromName,
                trackOptions,
                cumPositions[i].pos,
              );
              variants.push(vcfJson);
            }),
          );
          minX = chromEnd;
        } else {
          const endPos = Math.ceil(maxX - chromStart);
          const startPos = Math.floor(minX - chromStart);
          recordPromises.push(
            vcfFile.getLines(chromName, startPos, endPos, (line) => {
              const vcfRecord = tbiVCFParsers[vcfUrl].parseLine(line);
              const vcfJson = vcfRecordToJson(
                vcfRecord,
                chromName,
                trackOptions,
                cumPositions[i].pos,
              );
              variants.push(vcfJson);
            }),
          );
          // end the loop because we've retrieved the last chromosome
          break;
        }
      }
    }

    // flatten the array of promises so that it looks like we're
    // getting one long list of value
    return Promise.all(recordPromises).then(() => {
      tileValues.set(`${uid}.${z}.${x}`, variants);
      return variants;
    });
  });
};

const fetchTilesDebounced = async (uid, tileIds) => {
  return fetchTilesDebouncedBase(uid, tileIds, tile);
};

///////////////////////////////////////////////////
/// Render and Retrieval Functions
///////////////////////////////////////////////////

const STARTING_POSITIONS_ARRAY_LENGTH = 2 ** 20;
const STARTING_COLORS_ARRAY_LENGTH = 2 ** 21;
const STARTING_INDEXES_LENGTH = 2 ** 21;

let allPositionsLength = STARTING_POSITIONS_ARRAY_LENGTH;
let allColorsLength = STARTING_COLORS_ARRAY_LENGTH;
let allIndexesLength = STARTING_INDEXES_LENGTH;

let allPositions = new Float32Array(allPositionsLength);
let allColors = new Float32Array(allColorsLength);
let allIndexes = new Int32Array(allIndexesLength);

const renderSegments = (
  uid,
  tileIds,
  domain,
  scaleRange,
  trackOptions,
  legendLevels,
) => {
  const allSegments = {};

  const yLevelMin = Math.min(...legendLevels);
  const yLevelMax = Math.max(...legendLevels);

  for (const tileId of tileIds) {
    const tileValue = tileValues.get(`${uid}.${tileId}`);

    if (!tileValue) continue;
    if (tileValue.error) {
      throw new Error(tileValue.error);
    }

    for (const segment of tileValue) {
      allSegments[segment.id] = segment;
    }
  }

  let currPosition = 0;
  let currColor = 0;
  let currIdx = 0;

  const addPosition = (x1, y1) => {
    if (currPosition > allPositionsLength - 2) {
      allPositionsLength *= 2;
      const prevAllPositions = allPositions;

      allPositions = new Float32Array(allPositionsLength);
      allPositions.set(prevAllPositions);
    }
    allPositions[currPosition++] = x1;
    allPositions[currPosition++] = y1;

    return currPosition / 2 - 1;
  };

  const addColor = (colorIdx, n) => {
    if (currColor >= allColorsLength - n) {
      allColorsLength *= 2;
      const prevAllColors = allColors;

      allColors = new Float32Array(allColorsLength);
      allColors.set(prevAllColors);
    }

    for (let k = 0; k < n; k++) {
      //console.log(colorIdx)
      allColors[currColor++] = colorIdx;
    }
  };

  const addTriangleIxs = (ix1, ix2, ix3) => {
    if (currIdx >= allIndexesLength - 3) {
      allIndexesLength *= 2;
      const prevAllIndexes = allIndexes;

      allIndexes = new Int32Array(allIndexesLength);
      allIndexes.set(prevAllIndexes);
    }

    allIndexes[currIdx++] = ix1;
    allIndexes[currIdx++] = ix2;
    allIndexes[currIdx++] = ix3;
  };

  const addRect = (x, y, width, height, colorIdx) => {
    const xLeft = x;
    const xRight = xLeft + width;
    const yTop = y;
    const yBottom = y + height;

    const ulIx = addPosition(xLeft, yTop);
    const urIx = addPosition(xRight, yTop);
    const llIx = addPosition(xLeft, yBottom);
    const lrIx = addPosition(xRight, yBottom);
    addColor(colorIdx, 4);

    addTriangleIxs(ulIx, urIx, llIx);
    addTriangleIxs(llIx, lrIx, urIx);
  };

  const xScale = scaleLinear().domain(domain).range(scaleRange);

  let xLeft;
  let xRight;
  let yTop;

  let segmentList = Object.values(allSegments);
  let lastSegment = null;

  const defaultStat = trackOptions.defaultStatistic;

  // We are "indexing" the genes by id for faster filtering later
  const includedGenes = {};
  if(trackOptions.includedGenes){
    trackOptions.includedGenes.forEach((geneId, j) => {
      includedGenes[geneId] = true;
    });
    // Filtering
    segmentList = segmentList.filter((segment) => includedGenes.hasOwnProperty(segment.geneId));
  }

  if (segmentList.length > MAX_VISIBLE_GENES) {
    segmentList = segmentList
      .sort((a, b) => b[defaultStat] - a[defaultStat])
      .slice(0, MAX_VISIBLE_GENES);
  }

  let defaultStatMax = 0.0;
  segmentList.forEach((segment, j) => {
    const defaultStatVal = segment[defaultStat];
    defaultStatMax = Math.max(defaultStatMax, defaultStatVal);
  });

  const yPosScale = scaleLinear()
      .domain([0, defaultStatMax])
      .range([yLevelMax, yLevelMin]);

  segmentList.forEach((segment, j) => {
    // Ignore duplicates - can happen when variants span more than one tile
    if (lastSegment && segment.id === lastSegment.id) {
      return;
    }
    //console.log(segment);
    lastSegment = segment;
    const defaultStatVal = segment[defaultStat];

    const from = xScale(segment.from);
    const to = xScale(segment.to);

    const width = Math.max(1, to - from);

    const padding = 0;

    xLeft = from + padding;
    xRight = to - padding;

    segment["isSignificant"] = false;
    let colorToUse = COLOR_IXS.LIGHTGREY;
    if(defaultStatVal > 1.3){ // -log10(0.05)
      colorToUse = COLOR_IXS.DARKGREEN;
      segment["isSignificant"] = true;
    }

    yTop = yPosScale(defaultStatVal) - trackOptions.segmentHeight/2;

    // used in Mouseover
    segment["fromY"] = yTop;
    segment["toY"] = yTop + trackOptions.segmentHeight;
    segment["fromX"] = from;
    segment["toX"] = to;
    //console.log(segment);

    addRect(
      xLeft,
      yTop,
      width, //xRight - xLeft,
      trackOptions.segmentHeight,
      colorToUse,
    );
  });

  // // if it is 0, then there is no gene in view
  if (defaultStatMax === 0.0) {
    defaultStatMax = 1.0;
  }

  const positionsBuffer = allPositions.slice(0, currPosition).buffer;
  const colorsBuffer = allColors.slice(0, currColor).buffer;
  const ixBuffer = allIndexes.slice(0, currIdx).buffer;

  const objData = {
    segments: segmentList,
    positionsBuffer,
    colorsBuffer,
    ixBuffer,
    xScaleDomain: domain,
    xScaleRange: scaleRange,
    defaultStatMax,
  };

  return Transfer(objData, [positionsBuffer, colorsBuffer, ixBuffer]);
};

const tileFunctions = {
  init,
  tilesetInfo,
  fetchTilesDebounced,
  tile,
  renderSegments,
};

expose(tileFunctions);
