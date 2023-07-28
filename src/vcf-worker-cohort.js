import { expose, Transfer } from 'threads/worker';
import LRU from 'lru-cache';
import slugid from 'slugid';
import {
  fetchTilesDebouncedBase,
  tilesetInfoBase,
  initBase,
} from './tileset-utils';

function currTime() {
  const d = new Date();
  return d.getTime();
}

function parseIntInfo(infoProp, index) {
  let infoVal = infoProp ? parseInt(infoProp[index], 10) : null;
  return !isNaN(infoVal) ? infoVal : null;
}

function parseFloatInfo(infoProp, index) {
  let infoVal = infoProp ? parseFloat(infoProp[index]) : null;
  return !isNaN(infoVal) ? infoVal : null;
}

function parseStringInfo(infoProp, index) {
  return infoProp ? infoProp[index] : '';
}

function parseStringListInfo(infoProp, index) {
  return infoProp ? infoProp[index].split('|') : [];
}

function parseInfoField(infoProp, index, infoFieldType){
  if(infoFieldType === "string"){
    return parseStringInfo(infoProp, index);
  }else if(infoFieldType === "string_list"){
    return parseStringListInfo(infoProp, index);
  }else if(infoFieldType === "int"){
    return parseIntInfo(infoProp, index);
  }else if(infoFieldType === "float"){
    return parseFloatInfo(infoProp, index);
  }
  return "";
}

const vcfRecordToJson = (vcfRecord, chrName, multires_chromName, chrOffset) => {
  const segments = [];
  const info = vcfRecord['INFO'];

  //console.log(vcfRecord, chrName, multires_chromName, chrOffset);

  // VCF records can have multiple ALT. We create a segment for each of them
  vcfRecord['ALT'].forEach((alt, index) => {
    
    const segment = {
      //id: slugid.nice(),
      id: `${chrName}_${vcfRecord.POS}_${vcfRecord.REF}_${alt}`,
      alt: alt,
      ref: vcfRecord.REF,
      from: vcfRecord.POS + chrOffset,
      to: chrOffset,
      chrName,
      multiresChrName: multires_chromName,
      chrOffset,
      type: 'variant',
      category: 'SNV',
    };

    trackOptions.infoFields.forEach((infoField) => {
      const infoFieldName = infoField["name"];
      const infoFieldType = infoField["type"];
      segment[infoFieldName] = parseInfoField(info[infoFieldName], index, infoFieldType)
    });

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

let trackOptions = {};

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
      const multires_chromName = chromName + '_' + (tsInfo.max_zoom - z);
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
                cumPositions[i].pos
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
              const vcfRecord = tbiVCFParsers[vcfUrl].parseLine(line);
              const vcfJson = vcfRecordToJson(
                vcfRecord,
                chromName,
                multires_chromName,
                cumPositions[i].pos
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

const retrieveSegments = (uid, tileIds, domain, scaleRange, trackOptions) => {
  const allSegments = {};

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

  let segmentListFiltered = Object.values(allSegments);
  trackOptions.filter.forEach((f) => {
    const field = f["field"];
    const target = f["target"];
    if(f["operator"] === "is_one_of"){
      segmentListFiltered = segmentListFiltered.filter((segment) =>
        target.includes(segment[field])
      );
    }else if(f["operator"] === "has_one_of"){
      segmentListFiltered = segmentListFiltered.filter((segment) =>{
        const segmentArr = segment[field];
        const targetArr = target;
        const intersection = segmentArr.filter(value => targetArr.includes(value));
        return intersection.length > 0;
      });
    }else if(f["operator"] === "is_between"){
      segmentListFiltered = segmentListFiltered.filter((segment) =>
        segment[field] >= target[0] && segment[field] <= target[1]
      );
    }
    else if(f["operator"] === "is_equal"){
      segmentListFiltered = segmentListFiltered.filter((segment) =>
        segment[field] === target
      );
    }
  });

  const objData = {
    variants: segmentListFiltered,
    xScaleDomain: domain,
    xScaleRange: scaleRange,
  };

  return Transfer(objData, []);
};

const tileFunctions = {
  init,
  tilesetInfo,
  fetchTilesDebounced,
  tile,
  retrieveSegments,
};

expose(tileFunctions);
