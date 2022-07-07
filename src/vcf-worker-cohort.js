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

const vcfRecordToJson = (vcfRecord, chrName, multires_chromName, chrOffset) => {
  const segments = [];
  const info = vcfRecord['INFO'];

  // VCF records can have multiple ALT. We create a segment for each of them
  vcfRecord['ALT'].forEach((alt, index) => {
    // If the control AF is NA, we are setting it to 0
    const deltaAfGnomad2 =
      info.gnomADe2_AF[index] !== 'NA'
        ? info.AF_proband[index] - info.gnomADe2_AF[index]
        : info.AF_proband[index];

    const deltaAfGnomad3 =
      info.gnomADg_AF[index] !== 'NA'
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
      category: 'SNV',
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

const retrieveSegments = (uid, tileIds, domain, scaleRange) => {
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

  const segmentList = Object.values(allSegments);

  const objData = {
    variants: segmentList,
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
