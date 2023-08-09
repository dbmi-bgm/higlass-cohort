import React from 'react';
//import PropTypes from 'prop-types';
import { SIGNIFICANCE_THRESHOLD } from './config';
import { getMasksPerSnp } from './misc-utils';
import { format } from 'd3-format';


class GeneDetails extends React.Component {
  constructor(props) {
    super(props);

    this.segment = props.segment;
    this.trackOptions = props.trackOptions;

    this.state = {
      loading: false,
    };

  }


  render() {
    
    const statistics = [];
    this.trackOptions.availableStatistics.forEach((stat) => {
      const row = [];
      row.push(<td key={stat} className="font-weight-bold">{stat}</td>);
      this.trackOptions.availableMasks.forEach((mask) => {
        const statId = `${mask}_${stat}`;
        const statVal = this.segment[statId];
        let cssClass = "text-center px-2";
        if(statVal !== undefined && statVal > SIGNIFICANCE_THRESHOLD){
          cssClass += " bg-success";
        }
        if(this.trackOptions.activeMask === mask && this.trackOptions.activeStatistic === stat){
          cssClass += " font-weight-bold";
        }

        if(statVal !== undefined){
          row.push(<td key={statId} className={cssClass}>{format(".4f")(statVal)}</td>);
        }else{
          row.push(<td key={statId} className={cssClass}>-</td>);
        }
        
      });
      statistics.push(<tr>{row}</tr>);
    });

    const masks = [];
    masks.push(<th></th>)
    this.trackOptions.availableMasks.forEach((mask) => {
      masks.push(<th key={mask} className="text-center px-2">Mask<br/>{mask.replace("MASK_", "")}</th>)
    });

    const snps = getMasksPerSnp(this.trackOptions.availableMasks, this.segment);
    const snpList = [];
    Object.keys(snps).forEach((snp) => {
      const row = [];
      const snp_ = snp.split("_");
      const snpDisp = snp_[0] + ":" + format(',')(snp_[1])
      row.push(<td key={snp} className="">{snpDisp}</td>);
      const curSnps = snps[snp];
      this.trackOptions.availableMasks.forEach((mask) => {
        if(curSnps.includes(mask)){
          row.push(<td className="text-center">&#x2713;</td>);
        }else{
          row.push(<td className=""></td>);
        }
        
      });
      snpList.push(<tr>{row}</tr>);
    });
    //console.log(snps);

    return(
    <div>
      <div className='py-2'>Gene-based association test results (-log10 p)</div>
      <table className="table table-sm table-hover text-left">
        <thead>
          <tr>{masks}</tr>
        </thead>
        <tbody>
          {statistics}
        </tbody>
      </table>

      <div className='pt-2 pb-1'>Variants included in each mask</div>
      <table className="table table-sm table-hover text-left">
        <thead>
          <tr>{masks}</tr>
        </thead>
        <tbody>
          {snpList}
        </tbody>
      </table>
    </div>)

  }
}

GeneDetails.defaultProps = {
  //position: 'top',
};

GeneDetails.propTypes = {};

export default GeneDetails;
