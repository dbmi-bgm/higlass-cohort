import { format } from 'd3-format';
import {
  capitalizeFirstLetter
} from './misc-utils';

export const getMouseoverHtmlMSA = (variants, trackOptions) => {

  let mouseOverHtml = ``;
  for (const variant of variants) {
    let variantHtml = ``;
    let mostSevereConsequenceHtml = ``;
    let consequenceLevelHtml = ``;
    let positionHtml = ``;

    let vRef = variant.ref.match(/.{1,15}/g).join('<br>');
    let vAlt = variant.alt.match(/.{1,15}/g).join('<br>');

    if (variant.category === 'SNV') {
      positionHtml += `${variant.chrName}:${format(',')(
        variant.from - variant.chrOffset,
      )}`;
      mostSevereConsequenceHtml += `Most severe consequence: <strong>${variant.most_severe_consequence}</strong>`;
      consequenceLevelHtml += `Consequence level: <strong>${capitalizeFirstLetter(
        variant.level_most_severe_consequence.toLowerCase(),
      )}</strong>`;

      const yValueField = trackOptions['yValue']['field'];
      const yValue = variant[yValueField];
      const fisherHtml = `Fisher test p-value (-log10): <strong>${yValue}</strong>`;

      //const fisherORHtml = `Fisher test odds ratio: <strong>${fisher_odds}</strong>`;
      variantHtml += `<td colspan='4' style="background-color:#ececec;text-align: left !important;">
          ${mostSevereConsequenceHtml} <br/>
          ${consequenceLevelHtml} <br/>
          ${fisherHtml}
        </td>`;
    }

    const borderCss = 'border: 1px solid #333333;';
    mouseOverHtml +=
      `<table style="margin-top:3px;${borderCss}">` +
      `<tr style="background-color:#ececec;margin-top:3px;${borderCss}"><td colspan='4' style="text-align: left !important;">
      Variant: <strong>${vRef} &rarr; ${vAlt}</strong> (${positionHtml})</td></tr>` +
      `<tr style="margin-top:3px;${borderCss}">${variantHtml}</tr>` +
      `<tr style="margin-top:3px;${borderCss}"><td colspan='4' style="text-align: left !important; font-size: 11px">
      <i>Click to see more information.</i></td></tr>` +
      `</table>`;
  
  }
  return mouseOverHtml;
}

export const getMouseoverHtmlUDN = (variants, trackOptions) => {
  let mouseOverHtml = ``;
  for (const variant of variants) {
    let variantHtml = ``;
    let mostSevereConsequenceHtml = ``;
    let consequenceLevelHtml = ``;
    let positionHtml = ``;

    let vRef = variant.ref.match(/.{1,15}/g).join('<br>');
    let vAlt = variant.alt.match(/.{1,15}/g).join('<br>');

    positionHtml += `${variant.chrName}:${format(',')(
      variant.from - variant.chrOffset,
    )}`;
    mostSevereConsequenceHtml += `Most severe consequence: <strong>${variant.most_severe_consequence}</strong>`;
    consequenceLevelHtml += `Consequence level: <strong>${capitalizeFirstLetter(
      variant.level_most_severe_consequence.toLowerCase(),
    )}</strong>`;

    const yValueField = trackOptions['yValue']['field'];
    const yValue = variant[yValueField];
    const caddHtml = `CADD Score: <strong>${yValue}</strong>`;

    variantHtml += `<td colspan='4' style="background-color:#ececec;text-align: left !important;">
        ${mostSevereConsequenceHtml} <br/>
        ${consequenceLevelHtml} <br/>
        ${caddHtml}
      </td>`;

    const borderCss = 'border: 1px solid #333333;';
    mouseOverHtml +=
      `<table style="margin-top:3px;${borderCss}">` +
      `<tr style="background-color:#ececec;margin-top:3px;${borderCss}"><td colspan='4' style="text-align: left !important;">
      Variant: <strong>${vRef} &rarr; ${vAlt}</strong> (${positionHtml})</td></tr>` +
      `<tr style="margin-top:3px;${borderCss}">${variantHtml}</tr>` +
      `<tr style="margin-top:3px;${borderCss}"><td colspan='4' style="text-align: left !important; font-size: 11px">
      <i>Click to see more information.</i></td></tr>` +
      `</table>`;
  
  }
  return mouseOverHtml;
}

export const getMouseoverHtmlGeneric = (variants, trackOptions) => {
  return "";
}




