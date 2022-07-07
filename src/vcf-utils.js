export const COLORS = {
  GREY: [0.3, 0.3, 0.3, 0.6], // gray for the variant background
  LIGHTGREY: [0.4, 0.4, 0.4, 0.6],
  LINE: [0.9, 0.9, 0.9, 1], // gray for the variant background
  INSERTION: [0.6, 0.6, 0.0, 0.7],
  DELETION: [1, 0.0, 0.0, 0.55],
  INVERSION: [0.68, 0.23, 0.87, 0.8],
  DUPLICATION: [0.27, 0.64, 0.09, 0.8],
  BLACK: [0, 0, 0, 1],
  BLACK_05: [0, 0, 0, 0.5],
  WHITE: [1, 1, 1, 1],
  DARKGREEN: [0.0, 0.5, 0, 0.8],
};

export const COLOR_IXS = {};
Object.keys(COLORS).map((x, i) => {
  COLOR_IXS[x] = i;
  return null;
});

export const extractColumnFromVcfInfo = (info, index) => {
  const col = {};
  Object.keys(info).forEach((key) => {
    col[key] = info[key][index];
  });
  return col;
};
