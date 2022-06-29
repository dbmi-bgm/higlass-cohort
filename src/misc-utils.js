import sanitizeHtml from 'sanitize-html';

export const sanitizeMouseOverHtml = (html) => {
  return sanitizeHtml(html, {
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

export const setCursor = (style) => {
  document.body.style.cursor = style;
}

export const restoreCursor = () => {
  document.body.style.cursor = 'default';
}

export const capitalizeFirstLetter = (string) => {
  return string.charAt(0).toUpperCase() + string.slice(1);
}

export const scaleScalableGraphics = (graphics, xScale, drawnAtScale) => {
  const tileK =
    (drawnAtScale.domain()[1] - drawnAtScale.domain()[0]) /
    (xScale.domain()[1] - xScale.domain()[0]);
  const newRange = xScale.domain().map(drawnAtScale);

  const posOffset = newRange[0];
  graphics.scale.x = tileK;
  graphics.position.x = -posOffset * tileK;
};

export const getTilePosAndDimensions = (
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

export const invY = (p, t) => {
  return (p - t.y) / t.k;
}

export const eqSet = (as, bs) => {
  return as.size === bs.size && all(isIn(bs), as);
}

export const all = (pred, as) => {
  for (var a of as) if (!pred(a)) return false;
  return true;
}

export const isIn = (as) => {
  return function (a) {
    return as.has(a);
  };
}



