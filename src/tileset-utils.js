import VCF from '@gmod/vcf';
import { TabixIndexedFile } from '@gmod/tabix';
import { RemoteFile } from 'generic-filehandle';
import { ChromosomeInfo } from './chrom-utils';

export const initBase = (
  uid,
  vcfUrl,
  tbiUrl,
  chromSizesUrl,
  vcfFiles,
  vcfHeaders,
  chromSizes,
  dataConfs,
) => {

  if (!vcfFiles[vcfUrl]) {
    vcfFiles[vcfUrl] = new TabixIndexedFile({
      filehandle: new RemoteFile(vcfUrl),
      tbiFilehandle: new RemoteFile(tbiUrl),
    });
    vcfHeaders[vcfUrl] = vcfFiles[vcfUrl].getHeader();
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
  };

};

export const fetchTilesDebouncedBase = (uid, tileIds, tile) => {
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

export const tilesetInfoBase = (
  uid,
  dataConfs,
  chromSizes,
  vcfHeaders,
  tbiVCFParsers,
  chromInfos,
  tilesetInfos,
) => {
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
