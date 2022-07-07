class LegendUtils {
  constructor(HGC, legendWidth, legendHeight) {
    
    this.HGC = HGC;
    this.generateFonts();
    this.currentLegendLevels = [];
    this.baseLineLevel = 0;
    this.legendWidth = legendWidth;
    this.legendHeight = legendHeight;
  }

  resetLegend(legendGraphics){
    legendGraphics.removeChildren();
    legendGraphics.clear();
    legendGraphics.beginFill(this.HGC.utils.colorToHex('#ffffff'));
    legendGraphics.drawRect(0, 0, this.legendWidth, this.legendHeight+5);
    this.currentLegendLevels = [];
  }

  setLegendWidth(legendWidth){
    this.legendWidth = legendWidth;
  }
  setLegendHeight(legendHeight){
    this.legendHeight = legendHeight;
  }

  drawHorizontalLines(tileGraphics, from, to){

    tileGraphics.removeChildren();
    tileGraphics.clear();
    tileGraphics.beginFill(this.HGC.utils.colorToHex('#ebebeb'));

    this.currentLegendLevels.forEach((yLevel,ind) => {
      tileGraphics.drawRect(from, yLevel, to - from, 1);
    });

    if(this.baseLineLevel > 0){
      tileGraphics.beginFill(this.HGC.utils.colorToHex('#555555'));
      tileGraphics.drawRect(from, this.baseLineLevel, to - from, 1);
    }
    

  }

  setBaseLineLevel(baseLineLevel){
    this.baseLineLevel = baseLineLevel;
  }

  drawLabel(labelGraphics, trackwidth, subTrackId, colorScaleHex, consequenceLevels){

    labelGraphics.clear();
    labelGraphics.removeChildren();

    if(subTrackId.includes('main')){
      const boxWidth = 140;
      const boxHeight = consequenceLevels.length > 2 ? 73 : 53;
      const marginTop = 10;
      labelGraphics.beginFill(this.HGC.utils.colorToHex('#ffffff'));
      labelGraphics.drawRect(trackwidth - boxWidth, marginTop, boxWidth, boxHeight);
      labelGraphics.beginFill(this.HGC.utils.colorToHex('#cfcfcf'));
      labelGraphics.drawRect(trackwidth - boxWidth, marginTop, boxWidth, 1);
      labelGraphics.drawRect(trackwidth - boxWidth, marginTop + boxHeight, boxWidth, 1);
      labelGraphics.drawRect(trackwidth - boxWidth, marginTop, 1, boxHeight);
      labelGraphics.drawRect(trackwidth-1, marginTop, 1, boxHeight);
      
      const btext = new this.HGC.libraries.PIXI.BitmapText("Consequence level:", {
        fontName: 'LabelText',
      });
      btext.width = btext.width / 2;
      btext.height = btext.height / 2;
      btext.position.y = 2*marginTop;
      btext.position.x = trackwidth - 130;
      labelGraphics.addChild(btext);


      const paddingLR = 5;
      const paddingTB = 3;
      let offsetTop = btext.position.y + btext.height + paddingTB;
      let marginLeft = 115;
      consequenceLevels.forEach((level, index) => {
        //const level = cs["level"];
        const cs = colorScaleHex.filter(cs => cs["level"] === level)
        const colorHex = cs[0]["colorHex"];
        const btext = new this.HGC.libraries.PIXI.BitmapText(this.capitalizeFirstLetter(level.toLowerCase()), {
          fontName: 'LabelText',
        });
        btext.width = btext.width / 2;
        btext.height = btext.height / 2;
        if(index % 2 === 0){
          btext.position.y = offsetTop;
          btext.position.x = trackwidth - marginLeft;
        } else {
          btext.position.y = offsetTop;
          btext.position.x = trackwidth - marginLeft + 50;
          offsetTop = offsetTop + btext.height + paddingTB;
        }
        
        labelGraphics.addChild(btext);
        labelGraphics.beginFill(colorHex, 0.6);
        labelGraphics.drawCircle(btext.position.x - 2*paddingLR, btext.position.y + btext.height/2, 4);
        
      });

    }else{
      const paddingLR = 5;
      const paddingTB = 0;
      labelGraphics.beginFill(this.HGC.utils.colorToHex('#ebebeb'));
      const level = subTrackId.split('_')[0];
      const group = this.capitalizeFirstLetter(subTrackId.split('_')[1]); 
      const btext = new this.HGC.libraries.PIXI.BitmapText(`${group} AF (${level.toLowerCase()})`, {
        fontName: 'LabelText',
      });
      btext.width = btext.width / 2;
      btext.height = btext.height / 2;
      btext.position.y = this.currentLegendLevels[0] - 1*paddingTB;
      btext.position.x = trackwidth - btext.width - paddingLR;
      labelGraphics.drawRect(btext.position.x - paddingLR, btext.position.y - paddingTB, btext.width + 2* paddingLR, btext.height + 2*paddingTB);
      labelGraphics.addChild(btext);
      
    }
  }


  createLegend(legendGraphics, maxValue, numLabels, yOffset, height, inverted=false, linear=false){
    const legendTexts = this.generateLabelTexts(maxValue, numLabels, inverted, linear);
    this.numLabels = numLabels;

    const distBetweenLabels = height / legendTexts.length;
    const paddingTop = 5;
    const paddingRight = 10;
    legendGraphics.beginFill(this.HGC.utils.colorToHex('#999999'));

    legendTexts.forEach((lt,ind) => {
      const btext = new this.HGC.libraries.PIXI.BitmapText(lt, {
        fontName: 'LegendText',
      });
      btext.width = btext.width / 2;
      btext.height = btext.height / 2;
      btext.position.y = distBetweenLabels * ind + paddingTop + yOffset;
      btext.position.x = this.legendWidth - btext.width - paddingRight - 3;
      legendGraphics.drawRect(this.legendWidth - paddingRight, btext.position.y + btext.height/2 - 1, 5, 1);
      this.currentLegendLevels.push(btext.position.y + btext.height/2 - 1);
      if(ind < legendTexts.length - 1){
        legendGraphics.drawRect(this.legendWidth - paddingRight + 5, btext.position.y + btext.height/2 - 1, 1, distBetweenLabels+1);
      }
      
      legendGraphics.addChild(btext);
    });

  }

  drawAxisLabel(legendGraphics, labelText){
    legendGraphics.beginFill(this.HGC.utils.colorToHex('#999999'));
    const btext = new this.HGC.libraries.PIXI.BitmapText(labelText, {
      fontName: 'LegendText',
    });
    btext.width = btext.width / 2;
    btext.height = btext.height / 2;
    btext.position.y = 10;
    const yLevelMin = Math.min(...this.currentLegendLevels);
    const yLevelMax = Math.max(...this.currentLegendLevels);
    btext.position.y = (yLevelMin+yLevelMax)/2;
    btext.position.x = 2;
    btext.angle = -90;
    btext.anchor.y = 0.0;
    btext.anchor.x = 0.5;
    legendGraphics.addChild(btext);
  }

  capitalizeFirstLetter(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
  }
  

  generateLabelTexts(maxValue, numLabels, inverted, linear){
    const texts = [];
    if(linear){
      for (let step = 0; step < numLabels; step++) {
        const num = maxValue * (numLabels-step)/(numLabels);
        texts.push(num.toLocaleString(
          'en-us', {minimumFractionDigits: 2, maximumFractionDigits: 2}
        ));
      }
    }else{
      for (let step = 0; step < numLabels; step++) {
        const num = maxValue/(10 ** step);
        texts.push(num.toExponential(0).toLocaleString());
      }
    }
    
    texts.push("0");
    if(inverted){
      return texts.reverse();
    }
    return texts;
  }

  createNotification(notificationGraphics, trackwidth, text){
    const btext = new this.HGC.libraries.PIXI.BitmapText(text, {
      fontName: 'LegendText',
    });
    btext.width = btext.width / 2;
    btext.height = btext.height / 2;
    btext.position.y = -10;
    btext.anchor.x = 0.5;
    btext.position.x = trackwidth / 2;
    const paddingX = 5;
    const paddingY = 3;
    notificationGraphics.beginFill(this.HGC.utils.colorToHex('#ececec'));
    notificationGraphics.drawRect(btext.position.x - btext.width/2 - paddingX, btext.position.y - paddingY -1 , btext.width + 2*paddingX , btext.height + 2*paddingY);
    notificationGraphics.addChild(btext);
  }

  clearNotification(notificationGraphics){
    notificationGraphics.removeChildren();
    notificationGraphics.clear();
  }

  generateFonts(){

    let labelColor = '#333333';
    let fontSize = 12*2;
    
    // Install BitmapFont, used by BitmapText later
    this.HGC.libraries.PIXI.BitmapFont.from(
      'LegendText',
      {
        fontFamily: 'Arial',
        fontSize: fontSize,
        fontWeight: 500,
        strokeThickness: 0,
        fill: labelColor,
      },
      { chars: this.HGC.libraries.PIXI.BitmapFont.ASCII },
    );

    labelColor = '#555555';
    fontSize = 13*2;
    
    // Install BitmapFont, used by BitmapText later
    this.HGC.libraries.PIXI.BitmapFont.from(
      'LabelText',
      {
        fontFamily: 'Arial',
        fontSize: fontSize,
        fontWeight: 500,
        strokeThickness: 0,
        fill: labelColor,
      },
      { chars: this.HGC.libraries.PIXI.BitmapFont.ASCII },
    );

  }

}

export default LegendUtils;
