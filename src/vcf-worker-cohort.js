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

const vcfRecordToJson = (vcfRecord, chrName, multires_chromName, chrOffset) => {
  const segments = [];
  const info = vcfRecord['INFO'];
  //console.log(vcfRecord, chrName, multires_chromName, chrOffset);

  // VCF records can have multiple ALT. We create a segment for each of them
  vcfRecord['ALT'].forEach((alt, index) => {
    const transcript = parseStringInfo(info.transcript, index);
    const case_AC = parseIntInfo(info.case_AC, index);
    const case_AN = parseIntInfo(info.case_AN, index);
    const case_AF = parseFloatInfo(info.case_AF, index);
    const control_AC = parseIntInfo(info.control_AC, index);
    const control_AN = parseIntInfo(info.control_AN, index);
    const control_AF = parseFloatInfo(info.control_AF, index);
    const gnomADg_AC = parseIntInfo(info.gnomADg_AC, index);
    const gnomADg_AN = parseIntInfo(info.gnomADg_AN, index);
    const gnomADg_AF = parseFloatInfo(info.gnomADg_AF, index);
    const gnomADe2_AC = parseIntInfo(info.gnomADe2_AC, index);
    const gnomADe2_AN = parseIntInfo(info.gnomADe2_AN, index);
    const gnomADe2_AF = parseFloatInfo(info.gnomADe2_AF, index);
    const most_severe_consequence = parseStringInfo(
      info.most_severe_consequence,
      index,
    );
    const level_most_severe_consequence = parseStringInfo(
      info.level_most_severe_consequence,
      index,
    );
    const cadd_raw_rs = parseFloatInfo(info.cadd_raw_rs, index);
    const cadd_phred = parseFloatInfo(info.cadd_phred, index);
    const polyphen_pred = parseStringInfo(info.polyphen_pred, index);
    const polyphen_rankscore = parseFloatInfo(info.polyphen_rankscore, index);
    const polyphen_score = parseFloatInfo(info.polyphen_score, index);
    const gerp_score = parseFloatInfo(info.gerp_score, index);
    const gerp_rankscore = parseFloatInfo(info.gerp_rankscore, index);
    const sift_rankscore = parseFloatInfo(info.sift_rankscore, index);
    const sift_pred = parseStringInfo(info.sift_pred, index);
    const sift_score = parseFloatInfo(info.sift_score, index);
    const spliceai_score_max = parseFloatInfo(info.spliceai_score_max, index);
    const fisher_or_gnomADg = parseFloatInfo(info.fisher_or_gnomADg, index);
    const fisher_ml10p_gnomADg = parseFloatInfo(
      info.fisher_ml10p_gnomADg,
      index,
    );
    const fisher_or_gnomADe2 = parseFloatInfo(info.fisher_or_gnomADe2, index);
    const fisher_ml10p_gnomADe2 = parseFloatInfo(
      info.fisher_ml10p_gnomADe2,
      index,
    );
    const fisher_or_control = parseFloatInfo(info.fisher_or_control, index);
    const fisher_ml10p_control = parseFloatInfo(
      info.fisher_ml10p_control,
      index,
    );
    const regenie_ml10p = parseFloatInfo(info.regenie_ml10p, index);
    const regenie_beta = parseStringInfo(info.regenie_beta, index);
    const regenie_chisq = parseStringInfo(info.regenie_chisq, index);
    const regenie_se = parseStringInfo(info.regenie_se, index);

    // If the control AF is not available, we are setting it to 0
    const deltaAfControl = case_AF - control_AF;
    const deltaAfGnomad2 = gnomADe2_AF ? case_AF - gnomADe2_AF : case_AF;
    const deltaAfGnomad3 = gnomADg_AF ? case_AF - gnomADg_AF : case_AF;

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
      case_AC,
      case_AN,
      case_AF,
      control_AC,
      control_AN,
      control_AF,
      gnomADg_AC,
      gnomADg_AN,
      gnomADg_AF,
      gnomADe2_AC,
      gnomADe2_AN,
      gnomADe2_AF,
      most_severe_consequence,
      level_most_severe_consequence,
      cadd_raw_rs,
      cadd_phred,
      polyphen_pred,
      polyphen_rankscore,
      polyphen_score,
      gerp_score,
      gerp_rankscore,
      sift_rankscore,
      sift_pred,
      sift_score,
      spliceai_score_max,
      fisher_or_gnomADg,
      fisher_ml10p_gnomADg,
      fisher_or_gnomADe2,
      fisher_ml10p_gnomADe2,
      fisher_or_control,
      fisher_ml10p_control,
      regenie_ml10p,
      regenie_beta,
      regenie_chisq,
      regenie_se,
      transcript,
      deltaAfAbsControl: Math.abs(deltaAfControl),
      deltaAfControl,
      deltaAfAbsGnomad2: Math.abs(deltaAfGnomad2),
      deltaAfGnomad2: deltaAfGnomad2,
      deltaAfAbsGnomad3: Math.abs(deltaAfGnomad3),
      deltaAfGnomad3: deltaAfGnomad3,

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

  const segmentList = Object.values(allSegments);
  const segmentListFiltered = segmentList.filter((segment) =>
    trackOptions.consequenceLevels.includes(
      segment.level_most_severe_consequence,
    ) && segment.cadd_phred >= trackOptions.minCadd && segment.cadd_phred <= trackOptions.maxCadd,
  );

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
