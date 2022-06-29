import { text } from 'd3-request';
import { bisector } from 'd3-array';
import { tsvParseRows } from 'd3-dsv';
import { scaleLinear, scaleLog } from 'd3-scale';
import { expose, Transfer } from 'threads/worker';
import { TabixIndexedFile } from '@gmod/tabix';
import VCF from '@gmod/vcf';
import { RemoteFile } from 'generic-filehandle';
import LRU from 'lru-cache';
import slugid from 'slugid';
import { PILEUP_COLOR_IXS } from './vcf-utils';

function currTime() {
  const d = new Date();
  return d.getTime();
}
/////////////////////////////////////////////////
/// ChromInfo
/////////////////////////////////////////////////

const chromInfoBisector = bisector((d) => d.pos).left;

const chrToAbs = (chrom, chromPos, chromInfo) =>
  chromInfo.chrPositions[chrom].pos + chromPos;

const absToChr = (absPosition, chromInfo) => {
  if (!chromInfo || !chromInfo.cumPositions || !chromInfo.cumPositions.length) {
    return null;
  }

  let insertPoint = chromInfoBisector(chromInfo.cumPositions, absPosition);
  const lastChr = chromInfo.cumPositions[chromInfo.cumPositions.length - 1].chr;
  const lastLength = chromInfo.chromLengths[lastChr];

  insertPoint -= insertPoint > 0 && 1;

  let chrPosition = Math.floor(
    absPosition - chromInfo.cumPositions[insertPoint].pos,
  );
  let offset = 0;

  if (chrPosition < 0) {
    // before the start of the genome
    offset = chrPosition - 1;
    chrPosition = 1;
  }

  if (
    insertPoint === chromInfo.cumPositions.length - 1 &&
    chrPosition > lastLength
  ) {
    // beyond the last chromosome
    offset = chrPosition - lastLength;
    chrPosition = lastLength;
  }

  return [
    chromInfo.cumPositions[insertPoint].chr,
    chrPosition,
    offset,
    insertPoint,
  ];
};

function parseChromsizesRows(data) {
  const cumValues = [];
  const chromLengths = {};
  const chrPositions = {};

  let totalLength = 0;

  for (let i = 0; i < data.length; i++) {
    const length = Number(data[i][1]);
    totalLength += length;

    const newValue = {
      id: i,
      chr: data[i][0],
      pos: totalLength - length,
    };

    cumValues.push(newValue);
    chrPositions[newValue.chr] = newValue;
    chromLengths[data[i][0]] = length;
  }

  return {
    cumPositions: cumValues,
    chrPositions,
    totalLength,
    chromLengths,
  };
}

function ChromosomeInfo(filepath, success) {
  const ret = {};

  ret.absToChr = (absPos) => (ret.chrPositions ? absToChr(absPos, ret) : null);

  ret.chrToAbs = ([chrName, chrPos] = []) =>
    ret.chrPositions ? chrToAbs(chrName, chrPos, ret) : null;

  return text(filepath, (error, chrInfoText) => {
    if (error) {
      // console.warn('Chromosome info not found at:', filepath);
      if (success) success(null);
    } else {
      const data = tsvParseRows(chrInfoText);
      const chromInfo = parseChromsizesRows(data);

      Object.keys(chromInfo).forEach((key) => {
        ret[key] = chromInfo[key];
      });
      if (success) success(ret);
    }
  });
}

/////////////////////////////////////////////////////
/// End Chrominfo
/////////////////////////////////////////////////////

const extractColumnFromVcfInfo = (info, index) => {
  const col = {};
  Object.keys(info).forEach((key) => {
    col[key] = info[key][index];
  })
  return col;
}

const vcfRecordToJson = (vcfRecord, chrName, multires_chromName, chrOffset) => {
  const segments = [];
  const info = vcfRecord['INFO'];
 
  // VCF records can have multiple ALT. We create a segment for each of them
  vcfRecord['ALT'].forEach((alt, index) => {

    // If the control AF is NA, we are setting it to 0
    const deltaAfGnomad2 = info.gnomADe2_AF[index] !== "NA"
      ? info.AF_proband[index] - info.gnomADe2_AF[index]
      : info.AF_proband[index];

    const deltaAfGnomad3 = info.gnomADg_AF[index]  !== "NA"
      ? info.AF_proband[index] - info.gnomADg_AF[index]
      : info.AF_proband[index];

    const segment = {
      id: slugid.nice(),
      alt: alt,
      ref: vcfRecord.REF,
      from: vcfRecord.POS + chrOffset,
      to: chrOffset,
      chrName,
      multiresChrName: multires_chromName,
      chrOffset,
      alleleCountCases: info.AC_proband[index],
      alleleCountGnomad2: info.gnomADe2_AC[index],
      alleleCountGnomad3: info.gnomADg_AC[index],
      alleleFrequencyCases: info.AF_proband[index],
      alleleFrequencyGnomad2: info.gnomADe2_AF[index],
      alleleFrequencyGnomad3: info.gnomADg_AF[index],
      deltaAfAbsGnomad2: Math.abs(deltaAfGnomad2),
      deltaAfGnomad2: deltaAfGnomad2,
      deltaAfAbsGnomad3: Math.abs(deltaAfGnomad3),
      deltaAfGnomad3: deltaAfGnomad3,
      alleleNumberCases: info.AN_proband[index],
      alleleNumberGnomad2: info.gnomADe2_AN[index],
      alleleNumberGnomad3: info.gnomADg_AN[index],
      fisherGnomad2OR: info.fisher_gnomADv2_OR[index],
      fisherGnomad3OR: info.fisher_gnomADv3_OR[index],
      fisherGnomad2logp: info.fisher_gnomADv2_minuslog10p[index],
      fisherGnomad3logp: info.fisher_gnomADv3_minuslog10p[index],
      consequenceLevel: info.level_most_severe_consequence[index],
      mostSevereConsequence: info.most_severe_consequence[index],
      //info: extractColumnFromVcfInfo(info, index),
      //row: null,
      type: 'variant',
      category: 'SNV'
    };


    segments.push(segment);
  });

  return segments;
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

// indexed by uuid
const dataConfs = {};

const init = (uid, vcfUrl, tbiUrl, chromSizesUrl, maxTileWidth) => {
  if (!vcfFiles[vcfUrl]) {
    vcfFiles[vcfUrl] = new TabixIndexedFile({
      filehandle: new RemoteFile(vcfUrl),
      tbiFilehandle: new RemoteFile(tbiUrl),
    });

    vcfHeaders[vcfUrl] = vcfFiles[vcfUrl].getHeader();
    // vcfFiles[vcfUrl].getHeader().then(headerText => {
    //   vcfHeaders[vcfUrl] = headerText;
    //   tbiVCFParsers[vcfUrl] = new VCF({ header: headerText });

    // });
  }

  if (chromSizesUrl) {
    chromSizes[chromSizesUrl] =
      chromSizes[chromSizesUrl] ||
      new Promise((resolve) => {
        ChromosomeInfo(chromSizesUrl, resolve);
      });
  }

  dataConfs[uid] = {
    vcfUrl,
    chromSizesUrl,
    maxTileWidth
  };
};

const tilesetInfo = (uid) => {
  const { chromSizesUrl, vcfUrl } = dataConfs[uid];
  const promises = [vcfHeaders[vcfUrl], chromSizes[chromSizesUrl]];

  return Promise.all(promises).then((values) => {
    if (!tbiVCFParsers[vcfUrl]) {
      tbiVCFParsers[vcfUrl] = new VCF({ header: values[0] });
    }

    const TILE_SIZE = 1024;
    const chromInfo = values[1];
    chromInfos[chromSizesUrl] = chromInfo;

    const retVal = {
      tile_size: TILE_SIZE,
      bins_per_dimension: TILE_SIZE,
      max_zoom: Math.ceil(
        Math.log(chromInfo.totalLength / TILE_SIZE) / Math.log(2),
      ),
      max_width: chromInfo.totalLength,
      min_pos: [0],
      max_pos: [chromInfo.totalLength],
    };

    tilesetInfos[uid] = retVal;
    return retVal;
  });
};

const tile = async (uid, z, x) => {

  const { vcfUrl, chromSizesUrl, maxTileWidth } = dataConfs[uid];
  const vcfFile = vcfFiles[vcfUrl];

  return tilesetInfo(uid).then((tsInfo) => {
    const tileWidth = +tsInfo.max_width / 2 ** +z;
    const recordPromises = [];

    // if (tileWidth > maxTileWidth) {
    //   return new Promise((resolve) => resolve([]));
    // }

    // get the bounds of the tile
    let minX = tsInfo.min_pos[0] + x * tileWidth;
    const maxX = tsInfo.min_pos[0] + (x + 1) * tileWidth;
    

    const chromInfo = chromInfos[chromSizesUrl];

    const { chromLengths, cumPositions } = chromInfo;

    const variants = [];

    for (let i = 0; i < cumPositions.length; i++) {
      const chromName = cumPositions[i].chr;
      const multires_chromName = chromName + "_" + (tsInfo.max_zoom - z);
      //const multires_chromName = chromName + "_0"
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
            vcfFile.getLines(multires_chromName, startPos, endPos, (line) => {
              const vcfRecord = tbiVCFParsers[vcfUrl].parseLine(line);
              
              const vcfJson = vcfRecordToJson(
                vcfRecord,
                chromName,
                multires_chromName,
                cumPositions[i].pos,
              );
              vcfJson.forEach((variant) => variants.push(variant));
            }),
          );
          minX = chromEnd;
        } else {
          const endPos = Math.ceil(maxX - chromStart);
          const startPos = Math.floor(minX - chromStart);

          recordPromises.push(
            vcfFile.getLines(multires_chromName, startPos, endPos, (line) => {
              //console.log(line)
              const vcfRecord = tbiVCFParsers[vcfUrl].parseLine(line);
              //console.log(vcfRecord)
              const vcfJson = vcfRecordToJson(
                vcfRecord,
                chromName,
                multires_chromName,
                cumPositions[i].pos,
              );
              vcfJson.forEach((variant) => variants.push(variant));
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
      //console.log(variants);
      tileValues.set(`${uid}.${z}.${x}`, variants);
      return variants;
    });
  });
};

const fetchTilesDebounced = async (uid, tileIds) => {
  const tiles = {};

  const validTileIds = [];
  const tilePromises = [];

  for (const tileId of tileIds) {
    const parts = tileId.split('.');
    const z = parseInt(parts[0], 10);
    const x = parseInt(parts[1], 10);

    if (Number.isNaN(x) || Number.isNaN(z)) {
      console.warn('Invalid tile zoom or position:', z, x);
      continue;
    }

    validTileIds.push(tileId);
    tilePromises.push(tile(uid, z, x));
  }

  return Promise.all(tilePromises).then((values) => {
    for (let i = 0; i < values.length; i++) {
      const validTileId = validTileIds[i];
      tiles[validTileId] = values[i];
      tiles[validTileId].tilePositionId = validTileId;
    }

    return tiles;
  });
};

///////////////////////////////////////////////////
/// Render Functions
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
) => {
  //const t1 = currTime();
  const allSegments = {};

  for (const tileId of tileIds) {
    const tileValue = tileValues.get(`${uid}.${tileId}`);

    if(!tileValue) continue

    if (tileValue.error) {
      throw new Error(tileValue.error);
    }

    for (const segment of tileValue) {
      allSegments[segment.id] = segment;
    }
  }

  const segmentList = Object.values(allSegments);

  // let [minPos, maxPos] = [Number.MAX_VALUE, -Number.MAX_VALUE];

  // for (let i = 0; i < segmentList.length; i++) {
  //   if (segmentList[i].from < minPos) {
  //     minPos = segmentList[i].from;
  //   }

  //   if (segmentList[i].to > maxPos) {
  //     maxPos = segmentList[i].to;
  //   }
  // }

 


  //const xScale = scaleLinear().domain(domain).range(scaleRange);

  //const pos0 = labelPositions[0];
  //const pos10m5 = labelPositions[1];
  //const pos10m0 = labelPositions[labelPositions.length - 1];

  //const logYScale10m5 = scaleLog().domain([1e-5, 1]).range([pos10m5, pos10m0]);
  //const logYScale10m9 = scaleLog().domain([1e-8, 1e-5]).range([pos0, pos10m5]);



  // let xLeft;
  // let xRight;
  // let yTop;

  // Needed to check for duplicates
  //segmentList.sort((a, b) => a.from - b.from);

  //let lastSegment = null;


  // segmentList.forEach((segment, j) => {
  //   // Ignore duplicates - can happen when variants span more than one tile
  //   if (
  //     lastSegment &&
  //     segment.from === lastSegment.from &&
  //     segment.ref === lastSegment.ref &&
  //     segment.alt === lastSegment.alt
  //   ) {
  //     return;
  //   }
  //   lastSegment = segment;

  //   // const from = xScale(segment.from);
  //   // const to = xScale(segment.to);

  //   // if (segment.alleleFrequency >= 1e-5) {
  //   //   yTop =
  //   //     logYScale10m5(segment.alleleFrequency) - trackOptions.variantHeight / 2;
  //   // } else if (segment.alleleFrequency >= 1e-8) {
  //   //   yTop =
  //   //     logYScale10m9(segment.alleleFrequency) - trackOptions.variantHeight / 2;
  //   // } else {
  //   //   yTop = 0;
  //   // }
  //   // // Shift everything by one, since the graphics starts at 1
  //   // yTop += 1;


  //   //const width = to - from;
  //   // This is needed because a constant padding would be too large, if the
  //   // initial rendering is happing zoomed out
  //   //const padding = Math.min(0.5, 0.01 * width);

  //   //xLeft = from + padding;
  //   //xRight = to - padding;

  //   // let colorToUse = PILEUP_COLOR_IXS.VARIANT;
  //   // if (segment.type === 'deletion') {
  //   //   colorToUse = PILEUP_COLOR_IXS.DELETION;
  //   // } else if (segment.type === 'insertion') {
  //   //   colorToUse = PILEUP_COLOR_IXS.INSERTION;
  //   // } else if (segment.type === 'duplication') {
  //   //   colorToUse = PILEUP_COLOR_IXS.DUPLICATION;
  //   // } else if (segment.type === 'inversion') {
  //   //   colorToUse = PILEUP_COLOR_IXS.INVERSION;
  //   // }
  //   //segment['yTop'] = yTop;
  //   // addRect(
  //   //   xLeft,
  //   //   yTop,
  //   //   xRight - xLeft,
  //   //   trackOptions.variantHeight,
  //   //   colorToUse,
  //   // );
  // });

  const objData = {
    variants: segmentList,
    xScaleDomain: domain,
    xScaleRange: scaleRange,
  };

  //const t2 = currTime();
  //console.log('renderSegments time:', t2 - t1, 'ms');

  return Transfer(objData, []);

};

const tileFunctions = {
  init,
  tilesetInfo,
  fetchTilesDebounced,
  tile,
  renderSegments,
};

expose(tileFunctions);
