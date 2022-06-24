import React from 'react';
import PropTypes from 'prop-types';

class VariantDetails extends React.Component {
  constructor(props) {
    super(props);

    this.dataFetcher = props.dataFetcher;
    this.chr = props.chr;
    this.pos = props.pos;

    this.state = {
      loading: true,
      variantNotFound: false,
      variantInfo : null
    };

    this.variantInfo = null;

    this.loadData();
  }

  loadData() {
    this.dataFetcher.getVariantDetails(this.chr, this.pos).then((records) => {
      if (!records.length) {
        this.setState({ loading: false, variantNotFound: true });
      } 
      console.log(records[0])
      this.setState({ loading: false, variantInfo: records[0] });
    });
  }

  render() {
    
    if (this.state.loading) {
      return <div className="text-center">Loading...</div>;
    } else if (this.state.variantNotFound) {
      return <div className="text-center">No data found for this variant</div>;
    } else if (!this.state.variantInfo) {
      return <div className="text-center">Variant details are not available</div>;
    } else {
      const samples = this.state.variantInfo["INFO"]["samples"];
      return (
         <div>
          <strong>Affected Individuals</strong><br/>
          {samples.map((sample, i) => <div><a href="#">{sample}</a></div>)}
        </div>
      );
    }
  }
}

VariantDetails.defaultProps = {
  //position: 'top',
};

VariantDetails.propTypes = {};

export default VariantDetails;
