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

  }

}

export default LegendUtils;
